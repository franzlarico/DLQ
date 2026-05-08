import { createHash } from 'crypto';
import type { InspectedMessage } from './rabbit.types';

export function buildMessageFingerprint(message: Pick<
  InspectedMessage,
  'body' | 'bodyEncoding' | 'sizeBytes' | 'fields' | 'properties' | 'metadata'
>): string {
  const payload = JSON.stringify({
    body: message.body,
    bodyEncoding: message.bodyEncoding,
    sizeBytes: message.sizeBytes,
    exchange: message.fields.exchange,
    routingKey: message.fields.routingKey,
    headers: message.properties.headers ?? {},
    correlationId: message.properties.correlationId,
    type: message.properties.type,
    appId: message.properties.appId,
    sourceQueue: message.metadata.sourceQueue,
  });

  return createHash('sha1').update(payload).digest('hex');
}

export function buildBodyHash(body: unknown): string {
  return createHash('sha1').update(JSON.stringify(body ?? null)).digest('hex');
}

export function buildBodyPreview(body: unknown, limit = 500): string {
  const preview = typeof body === 'string' ? body : JSON.stringify(body ?? null);
  return preview.length > limit ? `${preview.slice(0, limit)}...` : preview;
}
