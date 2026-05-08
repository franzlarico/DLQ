import { buildBodyHash, buildBodyPreview, buildMessageFingerprint } from './message-fingerprint.util';

describe('message-fingerprint util', () => {
  const baseMessage = {
    body: { id: 1, status: 'failed' },
    bodyEncoding: 'json' as const,
    sizeBytes: 32,
    fields: {
      deliveryTag: 1,
      redelivered: false,
      exchange: '',
      routingKey: 'orders.queue',
    },
    properties: {
      headers: { 'x-death': [{ reason: 'rejected' }] },
      correlationId: 'corr-1',
      type: 'order.created',
      appId: 'dlq-tests',
    },
    metadata: {
      sourceQueue: 'orders.queue.dead-letter',
    },
  } as unknown as Parameters<typeof buildMessageFingerprint>[0];

  it('builds a stable fingerprint for the same message payload', () => {
    const first = buildMessageFingerprint(baseMessage);
    const second = buildMessageFingerprint(baseMessage);

    expect(first).toHaveLength(40);
    expect(first).toBe(second);
  });

  it('changes the fingerprint when routing data changes', () => {
    const first = buildMessageFingerprint(baseMessage);
    const changed = buildMessageFingerprint({
      ...baseMessage,
      fields: {
        ...baseMessage.fields,
        routingKey: 'payments.queue',
      },
    });

    expect(changed).not.toBe(first);
  });

  it('builds hash and preview helpers for persisted auditing', () => {
    expect(buildBodyHash(baseMessage.body)).toHaveLength(40);
    expect(buildBodyPreview({ foo: 'bar' }, 5)).toContain('...');
  });
});
