import 'dotenv/config';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { connect, type Channel, type ChannelModel, type ConfirmChannel, type GetMessage } from 'amqplib';
import { formatLogMeta, sanitizeAmqpUrl } from '../common/logging.utils';
import { buildMessageFingerprint } from './message-fingerprint.util';
import { AuditService } from '../audit/audit.service';
import {
  type InspectedMessage,
  type MessagePropertiesView,
  type PublishOptions,
  type QueueInfo,
  type QueueListItem,
  type RabbitConfig,
  type RabbitInternalConfig,
  type RabbitDeathHeader,
  type RequeueOptions,
  type RequeueResult,
} from './rabbit.types';
import { NacosService } from '../nacos/nacos.service';

function readOptionalEnv(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  const lowered = normalized.toLowerCase();
  return lowered === 'null' || lowered === 'undefined' ? undefined : normalized;
}

@Injectable()
export class RabbitService implements OnModuleDestroy {
  constructor(
    private readonly auditService: AuditService,
    private readonly nacosService: NacosService
  ) {
    console.log(this.config);
  }
  async setConnectionConfig(namespace: string, env: string, vhost?: string): Promise<void> {
    const rabbitConfig = await this.nacosService.getRabbitConfig(namespace, env, vhost);

    // cerrar conexiones actuales
    await this.close();

    // actualizar config dinámica
    this.config = {
      ...this.config,
      url: rabbitConfig.url,
      managementUrl: rabbitConfig.managementUrl,
    };

    this.logger.log(
      `Rabbit config updated -> ${rabbitConfig.url}`,
    );
  }
  private connection?: ChannelModel;
  private channel?: Channel;
  private readonly logger = new Logger(RabbitService.name);
  private config: RabbitInternalConfig = {
    url: 'amqp://user:password@localhost:5672',
    managementUrl: undefined,
    prefetch: 10,
    defaultDlq: undefined,
    defaultRequeueExchange: '',
    defaultRequeueRoutingKey: undefined,
  };



  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  async listQueues(): Promise<QueueListItem[]> {
    const managementUrl = this.getMgmtUrl();
    const credentials = this.getCredentials();

    this.writeLog('debug', 'rabbit.listQueues.start', {
      managementUrl: sanitizeAmqpUrl(managementUrl),
    });

    try {
      const response = await globalThis.fetch(`${managementUrl}/api/queues`, {
        headers: {
          Authorization: `Basic ${Buffer.from(credentials).toString('base64')}`,
        },
      });

      if (!response.ok) {
        throw new Error(`RabbitMQ Management returned status ${response.status}`);
      }

      const queues = (await response.json()) as Array<{
        name: string;
        messages: number;
      }>;
      const normalizedQueues = queues
        .map((queue) => ({
          name: queue.name,
          messageCount: queue.messages ?? 0,
          isDlq: this.isDlqQueue(queue.name),
        }))
        .sort((left, right) => {
          if (left.isDlq !== right.isDlq) {
            return Number(right.isDlq) - Number(left.isDlq);
          }

          if (left.messageCount !== right.messageCount) {
            return right.messageCount - left.messageCount;
          }

          return left.name.localeCompare(right.name);
        });

      this.writeLog('debug', 'rabbit.listQueues.completed', {
        queueCount: normalizedQueues.length,
        queuesWithMessages: normalizedQueues.filter((queue) => queue.messageCount > 0).length,
      });

      return normalizedQueues;
    } catch (error) {
      this.writeLog('error', 'rabbit.listQueues.failed', {
        managementUrl: sanitizeAmqpUrl(managementUrl),
        error: this.toErrorMetadata(error),
      });

      throw new ServiceUnavailableException({
        message: 'Could not list queues from RabbitMQ Management',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getQueueInfo(queue: string): Promise<QueueInfo> {
    this.writeLog('debug', 'rabbit.getQueueInfo.start', { queue });

    try {
      const channel = await this.getChannel();
      const result = await channel.checkQueue(queue);
      const queueInfo = {
        queue: result.queue,
        messageCount: result.messageCount,
        consumerCount: result.consumerCount,
      };

      this.writeLog('debug', 'rabbit.getQueueInfo.completed', queueInfo);

      return queueInfo;
    } catch (error) {
      this.resetChannelState();
      this.writeLog('error', 'rabbit.getQueueInfo.failed', {
        queue,
        error: this.toErrorMetadata(error),
      });
      throw this.toHttpError(error, `Queue ${queue} was not found or could not be inspected`);
    }
  }

  async inspectMessages(queue: string, limit: number): Promise<InspectedMessage[]> {
    const channel = await this.getChannel();
    const messages: InspectedMessage[] = [];
    const pendingMessages: GetMessage[] = [];

    this.writeLog('debug', 'rabbit.inspect.start', { queue, limit });

    try {
      for (let index = 0; index < limit; index += 1) {
        const message = await channel.get(queue, { noAck: false });
        if (!message) {
          break;
        }

        pendingMessages.push(message);
        messages.push(this.toInspectedMessage(message, queue));
      }

      this.assignStableMessageIds(messages);

      this.writeLog('debug', 'rabbit.inspect.completed', {
        queue,
        requested: limit,
        inspected: messages.length,
        stoppedBecauseQueueWasEmpty: messages.length < limit,
      });
      messages.reverse();
      return messages;
    } catch (error) {
      this.resetChannelState();
      this.writeLog('error', 'rabbit.inspect.failed', {
        queue,
        requested: limit,
        inspectedBeforeFailure: messages.length,
        error: this.toErrorMetadata(error),
      });
      throw this.toHttpError(error, `Queue ${queue} could not be inspected`);
    } finally {
      for (const message of pendingMessages) {
        try {
          channel.nack(message, false, true);
        } catch (nackError) {
          this.writeLog('warn', 'rabbit.inspect.nack.failed', {
            queue,
            deliveryTag: message.fields.deliveryTag,
            error: this.toErrorMetadata(nackError),
          });
        }
      }
    }
  }

  async requeueMessages(options: RequeueOptions): Promise<RequeueResult> {
    let tempConnection: ChannelModel | undefined;
    let tempChannel: ConfirmChannel | undefined;
    let sourceChannel: Channel | undefined;
    const messages: InspectedMessage[] = [];
    const targetRoutingKeys: string[] = [];
    let stoppedBecauseQueueWasEmpty = false;
    let effectiveTargetExchange = options.targetExchange?.trim() ?? '';
    const shouldInferTargetExchange = effectiveTargetExchange.length === 0;
    const startTime = Date.now();

    this.writeLog('log', 'rabbit.requeue.start', {
      sourceQueue: options.sourceQueue,
      requested: options.limit,
      requestedTargetExchange: effectiveTargetExchange || '(infer)',
      requestedTargetRoutingKey: options.targetRoutingKey?.trim() || '(infer)',
      timestamp: new Date().toISOString(),
    });

    try {
      // Create temporary connection for publishing
      tempConnection = await connect(this.config.url);
      tempChannel = await tempConnection.createConfirmChannel();
      this.writeLog('debug', 'rabbit.requeue.temp-channel-created', {
        sourceQueue: options.sourceQueue,
      });

      for (let index = 0; index < options.limit; index += 1) {
        try {
          sourceChannel = await this.getChannel();
          const message = await sourceChannel.get(options.sourceQueue, { noAck: false });

          if (!message) {
            this.writeLog('debug', 'rabbit.requeue.queue-empty-at-iteration', {
              sourceQueue: options.sourceQueue,
              iteration: index,
              processed: messages.length,
            });
            stoppedBecauseQueueWasEmpty = true;
            break;
          }

          const inspected = this.toInspectedMessage(message, options.sourceQueue);
          let targetRoutingKey = options.targetRoutingKey?.trim();

          // Infer exchange if needed
          if (shouldInferTargetExchange && !effectiveTargetExchange) {
            effectiveTargetExchange = inspected.inferredOriginalExchange ?? '';
            this.writeLog('debug', 'rabbit.requeue.inferred-exchange', {
              sourceQueue: options.sourceQueue,
              messageId: inspected.id,
              inferredExchange: effectiveTargetExchange,
            });
          }

          // Infer routing key if needed
          if (!targetRoutingKey) {
            targetRoutingKey = inspected.inferredOriginalRoutingKeys[0] ?? '';
            this.writeLog('debug', 'rabbit.requeue.inferred-routing-key', {
              sourceQueue: options.sourceQueue,
              messageId: inspected.id,
              inferredRoutingKey: targetRoutingKey,
            });
          }

          if (!targetRoutingKey) {
            sourceChannel.nack(message, false, true);
            this.writeLog('warn', 'rabbit.requeue.missing-target', {
              sourceQueue: options.sourceQueue,
              messageId: inspected.id,
              iteration: index,
              inferredOriginalExchange: inspected.inferredOriginalExchange,
              inferredOriginalRoutingKeys: inspected.inferredOriginalRoutingKeys,
              suggestedFallbackRoutingKey: this.deriveOriginalQueueName(options.sourceQueue),
            });

            await this.auditService.log({
              eventType: 'REQUEUE',
              sourceQueue: options.sourceQueue,
              messageId: inspected.id,
              messageSize: message.content.length,
              messageCount: 1,
              successCount: 0,
              status: 'FAILED',
              errorMessage: 'Missing target routing key for requeue',
              arrivedAtDlqTime: new Date(inspected.metadata.dlq.latestTime || Date.now()),
            });

            throw new BadRequestException(
              'Se requiere targetRoutingKey, o metadatos x-death, o un nombre de cola DLQ reconocible para inferirlo.',
            );
          }

          const publishOptions = this.buildPublishOptions(message, inspected);

          this.writeLog('debug', 'rabbit.requeue.publishing-message', {
            sourceQueue: options.sourceQueue,
            messageId: inspected.id,
            iteration: index,
            targetExchange: effectiveTargetExchange,
            targetRoutingKey,
            messageSize: message.content.length,
            contentType: publishOptions.contentType,
          });

          try {
            // Publish to target exchange
            await this.publishWithConfirm(
              tempChannel,
              effectiveTargetExchange,
              targetRoutingKey,
              message.content,
              publishOptions,
            );

            this.writeLog('debug', 'rabbit.requeue.message-published', {
              sourceQueue: options.sourceQueue,
              messageId: inspected.id,
              targetExchange: effectiveTargetExchange,
              targetRoutingKey,
            });

            // ACK the message from source queue only after successful publish
            sourceChannel.ack(message);

            this.writeLog('debug', 'rabbit.requeue.message-acked', {
              sourceQueue: options.sourceQueue,
              messageId: inspected.id,
              deliveryTag: message.fields.deliveryTag,
            });

            targetRoutingKeys.push(targetRoutingKey);
            messages.push(inspected);

            // Log successful requeue to audit
            try {
              await this.auditService.log({
                eventType: 'REQUEUE',
                sourceQueue: options.sourceQueue,
                targetExchange: effectiveTargetExchange,
                targetRoutingKey,
                messageId: inspected.id,
                messageSize: message.content.length,
                messageCount: 1,
                successCount: 1,
                status: 'SUCCESS',
                duration: Date.now() - startTime,
                arrivedAtDlqTime: new Date(inspected.metadata.dlq.latestTime || Date.now()),
                // Complete message data
                messageBody: inspected.body,
                messageProperties: inspected.metadata.properties as Record<string, unknown>,
                messageHeaders: inspected.metadata.headers as Record<string, unknown>,
                dlqMetadata: inspected.metadata.dlq as Record<string, unknown>,
                messageBodyEncoding: inspected.bodyEncoding,
                originalExchange: inspected.inferredOriginalExchange,
                originalRoutingKeys: inspected.inferredOriginalRoutingKeys,
              });
            } catch (auditError) {
              this.writeLog('warn', 'rabbit.requeue.audit-log.failed', {
                sourceQueue: options.sourceQueue,
                messageId: inspected.id,
                error: this.toErrorMetadata(auditError),
              });
            }
          } catch (publishError) {
            sourceChannel.nack(message, false, true);
            this.writeLog('error', 'rabbit.requeue.publish-failed', {
              sourceQueue: options.sourceQueue,
              messageId: inspected.id,
              iteration: index,
              targetExchange: effectiveTargetExchange,
              targetRoutingKey,
              deliveryTag: message.fields.deliveryTag,
              error: this.toErrorMetadata(publishError),
            });

            try {
              await this.auditService.log({
                eventType: 'REQUEUE',
                sourceQueue: options.sourceQueue,
                targetExchange: effectiveTargetExchange,
                targetRoutingKey,
                messageId: inspected.id,
                messageSize: message.content.length,
                messageCount: 1,
                successCount: 0,
                status: 'FAILED',
                errorMessage: publishError instanceof Error ? publishError.message : String(publishError),
                arrivedAtDlqTime: new Date(inspected.metadata.dlq.latestTime || Date.now()),
                // Complete message data (for failed operations too)
                messageBody: inspected.body,
                messageProperties: inspected.metadata.properties as Record<string, unknown>,
                messageHeaders: inspected.metadata.headers as Record<string, unknown>,
                dlqMetadata: inspected.metadata.dlq as Record<string, unknown>,
                messageBodyEncoding: inspected.bodyEncoding,
                originalExchange: inspected.inferredOriginalExchange,
                originalRoutingKeys: inspected.inferredOriginalRoutingKeys,
              });
            } catch (auditError) {
              this.writeLog('warn', 'rabbit.requeue.audit-log.failed', {
                sourceQueue: options.sourceQueue,
                messageId: inspected.id,
                error: this.toErrorMetadata(auditError),
              });
            }

            throw publishError;
          }
        } catch (iterationError) {
          if (iterationError instanceof BadRequestException) {
            throw iterationError;
          }
          // Log and continue with next message on non-critical errors
          this.writeLog('error', 'rabbit.requeue.iteration-error', {
            sourceQueue: options.sourceQueue,
            iteration: index,
            processedSoFar: messages.length,
            error: this.toErrorMetadata(iterationError),
          });
          throw iterationError;
        }
      }
    } catch (error) {
      const duration = Date.now() - startTime;

      if (!(error instanceof BadRequestException)) {
        this.writeLog('error', 'rabbit.requeue.failed', {
          sourceQueue: options.sourceQueue,
          requested: options.limit,
          requeuedBeforeFailure: messages.length,
          targetExchange: effectiveTargetExchange || '(unknown)',
          targetRoutingKey: options.targetRoutingKey?.trim() || '(mixed-or-inferred)',
          duration,
          error: this.toErrorMetadata(error),
        });

        // Log failure to audit
        if (messages.length > 0) {
          try {
            await this.auditService.log({
              eventType: 'REQUEUE',
              sourceQueue: options.sourceQueue,
              targetExchange: effectiveTargetExchange,
              targetRoutingKey: options.targetRoutingKey?.trim(),
              messageCount: options.limit,
              successCount: messages.length,
              status: 'PARTIAL',
              errorMessage: error instanceof Error ? error.message : String(error),
              duration,
            });
          } catch (auditError) {
            this.writeLog('warn', 'rabbit.requeue.audit-log.failed', {
              sourceQueue: options.sourceQueue,
              error: this.toErrorMetadata(auditError),
            });
          }
        }

        throw new ServiceUnavailableException({
          message: 'Could not requeue messages in RabbitMQ',
          detail: error instanceof Error ? error.message : String(error),
        });
      }

      throw error;
    } finally {
      this.writeLog('debug', 'rabbit.requeue.cleanup', {
        sourceQueue: options.sourceQueue,
        closingTempChannel: !!tempChannel,
        closingTempConnection: !!tempConnection,
      });

      await tempChannel?.close().catch((err) => {
        this.writeLog('warn', 'rabbit.requeue.temp-channel-close-error', {
          error: this.toErrorMetadata(err),
        });
      });
      await tempConnection?.close().catch((err) => {
        this.writeLog('warn', 'rabbit.requeue.temp-connection-close-error', {
          error: this.toErrorMetadata(err),
        });
      });
    }

    const duration = Date.now() - startTime;
    const result = {
      sourceQueue: options.sourceQueue,
      targetExchange: options.targetExchange?.trim() || effectiveTargetExchange,
      targetRoutingKey: options.targetRoutingKey?.trim() || targetRoutingKeys[0],
      targetRoutingKeys,
      requested: options.limit,
      requeued: messages.length,
      stoppedBecauseQueueWasEmpty,
      messages,
    };

    this.writeLog('log', 'rabbit.requeue.completed', {
      sourceQueue: result.sourceQueue,
      requested: result.requested,
      requeued: result.requeued,
      stoppedBecauseQueueWasEmpty: result.stoppedBecauseQueueWasEmpty,
      targetExchange: result.targetExchange,
      targetRoutingKeys: [...new Set(result.targetRoutingKeys)],
      duration,
      timestamp: new Date().toISOString(),
    });

    // Log overall operation
    await this.auditService.log({
      eventType: 'REQUEUE',
      sourceQueue: options.sourceQueue,
      targetExchange: effectiveTargetExchange,
      targetRoutingKey: options.targetRoutingKey?.trim() || targetRoutingKeys[0],
      messageCount: result.requested,
      successCount: result.requeued,
      status: result.requeued === result.requested ? 'SUCCESS' : result.requeued > 0 ? 'PARTIAL' : 'FAILED',
      duration,
    });

    return result;
  }

  getDefaults(): RabbitConfig {
    return {
      urlConfigured: Boolean(this.config.url),
      managementUrlConfigured: Boolean(this.config.managementUrl),
      prefetch: this.config.prefetch,
      defaultDlq: this.config.defaultDlq,
      defaultRequeueExchange: this.config.defaultRequeueExchange,
      defaultRequeueRoutingKey: this.config.defaultRequeueRoutingKey,
    };
  }

  async checkAmqpHealth(): Promise<{ status: 'up' | 'down'; detail?: string }> {
    try {
      await this.getChannel();
      return { status: 'up' };
    } catch (error) {
      return {
        status: 'down',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async checkManagementHealth(): Promise<{ status: 'up' | 'down'; detail?: string }> {
    const managementUrl = this.getMgmtUrl();
    const credentials = this.getCredentials();

    try {
      const response = await globalThis.fetch(`${managementUrl}/api/overview`, {
        headers: {
          Authorization: `Basic ${Buffer.from(credentials).toString('base64')}`,
        },
      });

      if (!response.ok) {
        throw new Error(`RabbitMQ Management returned status ${response.status}`);
      }

      return { status: 'up' };
    } catch (error) {
      return {
        status: 'down',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async getChannel(): Promise<Channel> {
    if (this.channel) {
      return this.channel;
    }

    this.writeLog('log', 'rabbit.connection.opening', {
      url: sanitizeAmqpUrl(this.config.url),
      prefetch: this.config.prefetch,
    });

    try {
      const connection = await connect(this.config.url);
      const channel = await connection.createChannel();
      await channel.prefetch(this.config.prefetch);

      connection.on('close', () => {
        this.writeLog('warn', 'rabbit.connection.closed', {
          url: sanitizeAmqpUrl(this.config.url),
        });
        this.resetChannelState();
      });

      connection.on('error', (error: Error) => {
        this.writeLog('error', 'rabbit.connection.error', {
          url: sanitizeAmqpUrl(this.config.url),
          error: this.toErrorMetadata(error),
        });
        this.resetChannelState();
      });

      this.connection = connection;
      this.channel = channel;

      this.writeLog('log', 'rabbit.connection.ready', {
        url: sanitizeAmqpUrl(this.config.url),
        prefetch: this.config.prefetch,
      });

      return channel;
    } catch (error) {
      this.writeLog('error', 'rabbit.connection.failed', {
        url: sanitizeAmqpUrl(this.config.url),
        error: this.toErrorMetadata(error),
      });
      throw new ServiceUnavailableException({
        message: 'Could not connect to RabbitMQ',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async close(): Promise<void> {
    const channel = this.channel;
    const connection = this.connection;

    this.resetChannelState();

    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);

    this.writeLog('log', 'rabbit.connection.shutdown', {
      hadChannel: Boolean(channel),
      hadConnection: Boolean(connection),
    });
  }

  private async publishWithConfirm(
    channel: ConfirmChannel,
    exchange: string,
    routingKey: string,
    content: Buffer,
    options: PublishOptions,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      channel.publish(exchange, routingKey, content, options, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private buildPublishOptions(
    message: GetMessage,
    inspected: InspectedMessage,
  ): PublishOptions {
    const headers = {
      ...(message.properties.headers ?? {}),
    } as Record<string, unknown>;

    return {
      ...message.properties,
      headers: {
        ...headers,

        'x-requeued-from-dlq': inspected.fields.routingKey,
        'x-requeued-at': new Date().toISOString(),

        // preserve first known DLQ arrival
        'x-original-dlq-time':
          headers['x-original-dlq-time']
          ?? inspected.metadata.dlq.latestTime,
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
      inferredOriginalExchange: this.inferOriginalExchange(
        death,
        message.fields.exchange,
      ),
      inferredOriginalRoutingKeys: this.inferOriginalRoutingKeys(death, sourceQueue),
      metadata: this.buildMetadata(sourceQueue, message, properties, death, bodyEncoding, inspectedAt),
      inspectedAt,
    };
  }

  private assignStableMessageIds(messages: InspectedMessage[]): void {
    const seenFingerprints = new Map<string, number>();

    messages.forEach((message) => {
      if (message.properties.messageId) {
        message.id = message.properties.messageId;
        return;
      }

      const fingerprint = this.buildMessageFingerprint(message);
      const occurrence = (seenFingerprints.get(fingerprint) ?? 0) + 1;
      seenFingerprints.set(fingerprint, occurrence);
      message.id = `msg-${fingerprint.slice(0, 10)}-${occurrence}`;
    });
  }

  private buildMessageFingerprint(message: InspectedMessage): string {
    return buildMessageFingerprint(message);
  }

  private inferOriginalExchange(
    death: RabbitDeathHeader[] | undefined,
    currentExchange?: string,
  ): string | undefined {
    if (!death?.length) {
      return currentExchange;
    }

    // Buscar exchange que NO sea retry/DLX
    for (const entry of death) {
      const exchange = entry.exchange;

      if (
        exchange &&
        !exchange.includes('.dlx') &&
        !exchange.includes('retry')
      ) {
        return exchange;
      }
    }

    // fallback al exchange actual
    return currentExchange;
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
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        return undefined;
      }
    }

    if (!Array.isArray(value)) {
      return undefined;
    }

    return value.map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return {};
      }

      const header = entry as Record<string, unknown>;
      const routingKeysRaw = header['routing-keys'];
      const routingKeys = Array.isArray(routingKeysRaw)
        ? routingKeysRaw.filter((key): key is string => typeof key === 'string')
        : typeof routingKeysRaw === 'string'
          ? [routingKeysRaw]
          : undefined;

      return {
        count: typeof header.count === 'number' ? header.count : undefined,
        reason: typeof header.reason === 'string' ? header.reason : undefined,
        queue: typeof header.queue === 'string' ? header.queue : undefined,
        time: this.normalizeHeaderTime(header.time),
        exchange: typeof header.exchange === 'string' ? header.exchange : undefined,
        'routing-keys': routingKeys,
      };
    });
  }

  private normalizeHeaderTime(value: unknown): string | undefined {
    if (!value) {
      return undefined;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'string') {
      return value;
    }

    // RabbitMQ timestamp numérico
    if (typeof value === 'number') {
      return new Date(value * 1000).toISOString();
    }

    // amqplib timestamp object
    if (
      typeof value === 'object' &&
      value !== null &&
      'value' in value
    ) {
      const timestamp = (value as { value?: unknown }).value;

      if (typeof timestamp === 'number') {
        return new Date(timestamp * 1000).toISOString();
      }
    }

    return undefined;
  }

  private headerString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private inferOriginalRoutingKeys(death: RabbitDeathHeader[] | undefined, sourceQueue: string): string[] {
    const keys = [
      ...new Set(
        (death ?? [])
          .flatMap((entry) => entry['routing-keys'] ?? [])
          .filter((routingKey) => routingKey.length > 0),
      ),
    ];

    if (keys.length > 0) {
      return keys;
    }

    const derivedQueueName = this.deriveOriginalQueueName(sourceQueue);
    return derivedQueueName ? [derivedQueueName] : [];
  }

  private deriveOriginalQueueName(sourceQueue: string): string | undefined {
    const patterns = [/\.dead-letter$/i, /[_-]dead[_-]?letter$/i, /\.dlq$/i, /[_-]dlq$/i];

    for (const pattern of patterns) {
      if (pattern.test(sourceQueue)) {
        return sourceQueue.replace(pattern, '');
      }
    }

    return undefined;
  }

  private getMgmtUrl(): string {
    if (this.config.managementUrl) {
      try {
        return new URL(this.config.managementUrl).origin;
      } catch {
        this.writeLog('warn', 'rabbit.management.invalid-url', {
          configuredValue: this.config.managementUrl,
        });
      }
    }

    const url = new URL(this.config.url);
    const isSecure = url.protocol === 'amqps:';

    url.protocol = isSecure ? 'https:' : 'http:';

    if (!url.port || url.port === '5672' || url.port === '5671') {
      url.port = isSecure ? '15671' : '15672';
    }

    return url.origin;
  }

  private getCredentials(): string {
    const url = new URL(this.config.url);
    const user = url.username || 'guest';
    const pass = url.password || 'guest';
    return `${user}:${pass}`;
  }

  private isDlqQueue(queueName: string): boolean {
    const lower = queueName.toLowerCase();
    return /(^|[._-])(dlq|dead[._-]?letter)($|[._-])/.test(lower);
  }

  private resetChannelState(): void {
    this.channel = undefined;
    this.connection = undefined;
  }

  private toHttpError(error: unknown, fallbackMessage: string): Error {
    if (error instanceof NotFoundException || error instanceof BadRequestException) {
      return error;
    }

    const errorWithCode = error as { code?: number; message?: string } | undefined;
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorWithCode?.code === 404 || errorMessage.includes('NOT_FOUND') || errorMessage.includes('no queue')) {
      return new NotFoundException({
        message: fallbackMessage,
        detail: errorMessage,
      });
    }

    return error instanceof Error ? error : new Error(errorMessage);
  }

  private writeLog(
    level: 'log' | 'warn' | 'error' | 'debug',
    event: string,
    metadata: Record<string, unknown>,
  ): void {
    const message = `${event} ${formatLogMeta(metadata)}`;

    switch (level) {
      case 'warn':
        this.logger.warn(message);
        break;
      case 'error':
        this.logger.error(message);
        break;
      case 'debug':
        this.logger.debug(message);
        break;
      default:
        this.logger.log(message);
        break;
    }
  }

  private toErrorMetadata(error: unknown): Record<string, string> {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
      };
    }

    return {
      name: 'UnknownError',
      message: String(error),
    };
  }
}
