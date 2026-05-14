import type { Options } from 'amqplib';

/**
 * =========================
 * PUBLIC DTOs (FRONT + API)
 * =========================
 */

export interface RabbitConfig {
  urlConfigured: boolean;
  managementUrlConfigured: boolean;
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

export interface QueueListItem {
  name: string;
  messageCount: number;
  isDlq: boolean;
}

export interface InspectOptions {
  queue: string;
  limit: number;
}

export interface RequeueOptions {
  sourceQueue: string;
  limit: number;
  targetExchange?: string;
  targetRoutingKey?: string;
}

export interface RequeueResult {
  sourceQueue: string;
  targetExchange: string;
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

  inferredOriginalExchange?: string;
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

export interface RequeueJobDetails {
  id: string;
  sourceQueue: string;

  targetExchange?: string;
  targetRoutingKey?: string;

  requestedCount: number;
  requeuedCount: number;

  status: string;
  requestedBy: string;

  errorMessage?: string;

  startedAt: string;
  finishedAt?: string;
  durationMs?: number;

  targetRoutingKeys: string[];

  items: Array<{
    id: string;
    fingerprint?: string;
    messageId?: string;
    routingKey?: string;
    status: string;
    createdAt: string;
  }>;
}

/**
 * =========================
 * INTERNAL BACKEND TYPES
 * =========================
 */

export interface RabbitInternalConfig {
  url: string;
  managementUrl?: string;
  vhost: string;
  prefetch: number;
  defaultDlq?: string;
  defaultRequeueExchange?: string;
  defaultRequeueRoutingKey?: string;
}

export type PublishOptions = Options.Publish;