import type { Options } from 'amqplib';

export interface RabbitConfig {
  url: string;
  prefetch: number;
  defaultDlq?: string;
  defaultRequeueExchange?: string;
  defaultRequeueRoutingKey?: string;
}

export interface QueueInfo {
  queue: string;
  messageCount: number;
  consumerCount: number;
}

export interface InspectOptions {
  queue: string;
  limit: number;
}

export interface RequeueOptions {
  sourceQueue: string;
  limit: number;
  targetExchange: string;
  targetRoutingKey?: string;
}

export interface RequeueResult {
  sourceQueue: string;
  targetExchange: string;
  targetRoutingKey?: string;
  targetRoutingKeys: string[];
  requested: number;
  requeued: number;
  stoppedBecauseQueueWasEmpty: boolean;
  messages: InspectedMessage[];
}

export interface InspectedMessage {
  id: string;
  body: unknown;
  bodyEncoding: 'json' | 'utf8' | 'base64' | 'empty';
  sizeBytes: number;
  fields: {
    deliveryTag: number;
    redelivered: boolean;
    exchange: string;
    routingKey: string;
  };
  properties: MessagePropertiesView;
  death?: RabbitDeathHeader[];
  inferredOriginalRoutingKeys: string[];
  metadata: MessageMetadataView;
  inspectedAt: string;
}

export interface MessageMetadataView {
  sourceQueue: string;
  inspectedAt: string;
  body: {
    encoding: InspectedMessage['bodyEncoding'];
    sizeBytes: number;
    contentType?: string;
    contentEncoding?: string;
  };
  delivery: {
    deliveryTag: number;
    redelivered: boolean;
    exchange: string;
    routingKey: string;
  };
  dlq: {
    deathCount: number;
    latestReason?: string;
    latestQueue?: string;
    latestExchange?: string;
    latestTime?: string;
    latestRoutingKeys: string[];
    firstDeathQueue?: string;
    firstDeathExchange?: string;
    firstDeathReason?: string;
    lastDeathQueue?: string;
    lastDeathExchange?: string;
    lastDeathReason?: string;
  };
  properties: MessagePropertiesView;
  headers: Record<string, unknown>;
  rawDeath: RabbitDeathHeader[];
}

export interface MessagePropertiesView {
  contentType?: string;
  contentEncoding?: string;
  headers?: Record<string, unknown>;
  deliveryMode?: number;
  priority?: number;
  correlationId?: string;
  replyTo?: string;
  expiration?: string;
  messageId?: string;
  timestamp?: number;
  type?: string;
  userId?: string;
  appId?: string;
  clusterId?: string;
}

export interface RabbitDeathHeader {
  count?: number;
  reason?: string;
  queue?: string;
  time?: string;
  exchange?: string;
  'routing-keys'?: string[];
}

export type PublishOptions = Options.Publish;
