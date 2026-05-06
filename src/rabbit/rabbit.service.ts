import 'dotenv/config';
import { BadRequestException, Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { connect, type ChannelModel, type ConfirmChannel, type GetMessage } from 'amqplib';
import {
  type InspectedMessage,
  type MessagePropertiesView,
  type PublishOptions,
  type QueueInfo,
  type RabbitConfig,
  type RabbitDeathHeader,
  type RequeueOptions,
  type RequeueResult,
} from './rabbit.types';

@Injectable()
export class RabbitService implements OnModuleDestroy {
  private connection?: ChannelModel;
  private channel?: ChannelModel;
  private readonly config: RabbitConfig = {
    url: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
    prefetch: Number(process.env.RABBITMQ_PREFETCH ?? 10),
    defaultDlq: process.env.RABBITMQ_DEFAULT_DLQ,
    defaultRequeueExchange: process.env.RABBITMQ_DEFAULT_REQUEUE_EXCHANGE ?? '',
    defaultRequeueRoutingKey: process.env.RABBITMQ_DEFAULT_REQUEUE_ROUTING_KEY,
  };

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  async getQueueInfo(queue: string): Promise<QueueInfo> {
    const channel = await this.getChannel();
    const result = await channel.checkQueue(queue);

    return {
      queue: result.queue,
      messageCount: result.messageCount,
      consumerCount: result.consumerCount,
    };
  }

  async inspectMessages(queue: string, limit: number): Promise<InspectedMessage[]> {
    const channel = await this.getChannel();
    const messages: InspectedMessage[] = [];
    const pendingMessages: GetMessage[] = [];

    try {
      for (let index = 0; index < limit; index += 1) {
        const message = await channel.get(queue, { noAck: false });
        if (!message) {
          break;
        }

        pendingMessages.push(message);
        messages.push(this.toInspectedMessage(message, queue));
      }
    } finally {
      pendingMessages.forEach((message) => channel.nack(message, false, true));
    }

    return messages;
  }

  async requeueMessages(options: RequeueOptions): Promise<RequeueResult> {
    // Crear una conexión NEW para requeue (no reutilizar canal)
    let tempConnection;
    let tempChannel;
    const messages: InspectedMessage[] = [];
    const targetRoutingKeys: string[] = [];
    let stoppedBecauseQueueWasEmpty = false;

    try {
      // Conexión temporal
      tempConnection = await connect(this.config.url);
      tempChannel = await tempConnection.createChannel();

      for (let index = 0; index < options.limit; index += 1) {
        // Obtener mensaje del canal normal
        const channel = await this.getChannel();
        const message = await channel.get(options.sourceQueue, { noAck: false });
        
        if (!message) {
          stoppedBecauseQueueWasEmpty = true;
          break;
        }

        const inspected = this.toInspectedMessage(message, options.sourceQueue);
        const publishOptions = this.buildPublishOptions(message, inspected);

        // Resolver routing key
        let targetRoutingKey = options.targetRoutingKey?.trim();
        if (!targetRoutingKey) {
          targetRoutingKey = inspected.inferredOriginalRoutingKeys[0];
        }
        
        if (!targetRoutingKey) {
          channel.nack(message, false, true);
          throw new BadRequestException(
            'Se requiere targetRoutingKey porque el mensaje no tiene metadatos x-death',
          );
        }

        targetRoutingKeys.push(targetRoutingKey);

        // Publicar usando canal temporal
        tempChannel.publish(
          options.targetExchange,
          targetRoutingKey,
          message.content,
          publishOptions,
        );

        // Confirmar que fue sacado de la DLQ
        channel.ack(message);
        messages.push(inspected);
      }
    } catch (error) {
      throw error;
    } finally {
      // Cerrar conexión temporal
      await tempChannel?.close().catch(() => undefined);
      await tempConnection?.close().catch(() => undefined);
    }

    return {
      sourceQueue: options.sourceQueue,
      targetExchange: options.targetExchange,
      targetRoutingKey: options.targetRoutingKey ?? targetRoutingKeys[0],
      targetRoutingKeys,
      requested: options.limit,
      requeued: messages.length,
      stoppedBecauseQueueWasEmpty,
      messages,
    };
  }

  getDefaults(): RabbitConfig {
    return { ...this.config };
  }

  private async getChannel(): Promise<ChannelModel> {
    if (this.channel) {
      return this.channel;
    }

    try {
      const connection = await connect(this.config.url);
      const channel = await connection.createChannel();
      await channel.prefetch(this.config.prefetch);

      connection.on('close', () => {
        this.channel = undefined;
        this.connection = undefined;
      });

      connection.on('error', () => {
        this.channel = undefined;
        this.connection = undefined;
      });

      this.connection = connection;
      this.channel = channel;

      return channel;
    } catch (error) {
      throw new ServiceUnavailableException({
        message: 'Could not connect to RabbitMQ',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async close(): Promise<void> {
    const channel = this.channel;
    const connection = this.connection;
    
    this.channel = undefined;
    this.connection = undefined;

    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
  }

  private buildPublishOptions(message: GetMessage, inspected: InspectedMessage): PublishOptions {
    return {
      ...message.properties,
      headers: {
        ...(message.properties.headers ?? {}),
        'x-requeued-from-dlq': inspected.fields.routingKey,
        'x-requeued-at': new Date().toISOString(),
      },
      persistent: message.properties.deliveryMode === 2,
    };
  }

  private toInspectedMessage(message: GetMessage, sourceQueue: string): InspectedMessage {
    const properties = this.toPropertiesView(message.properties);
    const death = this.parseDeathHeaders(properties.headers?.['x-death']);
    const bodyEncoding = this.getBodyEncoding(message.content, properties.contentType);
    const inspectedAt = new Date().toISOString();

    return {
      id: properties.messageId ?? `${message.fields.deliveryTag}`,
      body: this.parseBody(message.content, properties.contentType),
      bodyEncoding,
      sizeBytes: message.content.length,
      fields: {
        deliveryTag: message.fields.deliveryTag,
        redelivered: message.fields.redelivered,
        exchange: message.fields.exchange,
        routingKey: message.fields.routingKey,
      },
      properties,
      death,
      inferredOriginalRoutingKeys: this.inferOriginalRoutingKeys(death),
      metadata: this.buildMetadata(sourceQueue, message, properties, death, bodyEncoding, inspectedAt),
      inspectedAt,
    };
  }

  private buildMetadata(
    sourceQueue: string,
    message: GetMessage,
    properties: MessagePropertiesView,
    death: RabbitDeathHeader[] | undefined,
    bodyEncoding: InspectedMessage['bodyEncoding'],
    inspectedAt: string,
  ): InspectedMessage['metadata'] {
    const headers = properties.headers ?? {};
    const latestDeath = death?.[0];

    return {
      sourceQueue,
      inspectedAt,
      body: {
        encoding: bodyEncoding,
        sizeBytes: message.content.length,
        contentType: properties.contentType,
        contentEncoding: properties.contentEncoding,
      },
      delivery: {
        deliveryTag: message.fields.deliveryTag,
        redelivered: message.fields.redelivered,
        exchange: message.fields.exchange,
        routingKey: message.fields.routingKey,
      },
      dlq: {
        deathCount: death?.reduce((total, entry) => total + (entry.count ?? 0), 0) ?? 0,
        latestReason: latestDeath?.reason,
        latestQueue: latestDeath?.queue,
        latestExchange: latestDeath?.exchange,
        latestTime: latestDeath?.time,
        latestRoutingKeys: latestDeath?.['routing-keys'] ?? [],
        firstDeathQueue: this.headerString(headers['x-first-death-queue']),
        firstDeathExchange: this.headerString(headers['x-first-death-exchange']),
        firstDeathReason: this.headerString(headers['x-first-death-reason']),
        lastDeathQueue: this.headerString(headers['x-last-death-queue']),
        lastDeathExchange: this.headerString(headers['x-last-death-exchange']),
        lastDeathReason: this.headerString(headers['x-last-death-reason']),
      },
      properties,
      headers,
      rawDeath: death ?? [],
    };
  }

  private toPropertiesView(properties: GetMessage['properties']): MessagePropertiesView {
    return {
      contentType: properties.contentType,
      contentEncoding: properties.contentEncoding,
      headers: properties.headers,
      deliveryMode: properties.deliveryMode,
      priority: properties.priority,
      correlationId: properties.correlationId,
      replyTo: properties.replyTo,
      expiration: properties.expiration,
      messageId: properties.messageId,
      timestamp: properties.timestamp,
      type: properties.type,
      userId: properties.userId,
      appId: properties.appId,
      clusterId: properties.clusterId,
    };
  }

  private parseBody(content: Buffer, contentType?: string): unknown {
    if (content.length === 0) {
      return null;
    }

    if (!this.isLikelyUtf8(content)) {
      return content.toString('base64');
    }

    const text = content.toString('utf8');
    if (contentType?.includes('json') || this.looksLikeJson(text)) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    return text;
  }

  private getBodyEncoding(content: Buffer, contentType?: string): InspectedMessage['bodyEncoding'] {
    if (content.length === 0) {
      return 'empty';
    }

    const text = content.toString('utf8');
    if (contentType?.includes('json') || this.looksLikeJson(text)) {
      try {
        JSON.parse(text);
        return 'json';
      } catch {
        return 'utf8';
      }
    }

    return this.isLikelyUtf8(content) ? 'utf8' : 'base64';
  }

  private looksLikeJson(text: string): boolean {
    const trimmed = text.trim();
    return (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    );
  }

  private isLikelyUtf8(content: Buffer): boolean {
    return !content.includes(0);
  }

  private parseDeathHeaders(value: unknown): RabbitDeathHeader[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }

    return value.map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return {};
      }

      const header = entry as Record<string, unknown>;
      return {
        count: typeof header.count === 'number' ? header.count : undefined,
        reason: typeof header.reason === 'string' ? header.reason : undefined,
        queue: typeof header.queue === 'string' ? header.queue : undefined,
        time: this.normalizeHeaderTime(header.time),
        exchange: typeof header.exchange === 'string' ? header.exchange : undefined,
        'routing-keys': Array.isArray(header['routing-keys'])
          ? header['routing-keys'].filter((key): key is string => typeof key === 'string')
          : undefined,
      };
    });
  }

  private normalizeHeaderTime(value: unknown): string | undefined {
    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'string') {
      return value;
    }

    return undefined;
  }

  private headerString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private inferOriginalRoutingKeys(death?: RabbitDeathHeader[]): string[] {
    return [
      ...new Set(
        (death ?? [])
          .flatMap((entry) => entry['routing-keys'] ?? [])
          .filter((routingKey) => routingKey.length > 0),
      ),
    ];
  }
}
