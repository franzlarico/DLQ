import { BadRequestException } from '@nestjs/common';

export interface RequeueRequestBody {
  limit?: number;
  targetExchange?: string;
  targetRoutingKey?: string;
}

export function parseLimit(value: unknown, fallback = 10, max = 100): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new BadRequestException(`limit must be an integer between 1 and ${max}`);
  }

  return parsed;
}

export function requireQueueName(queue: string | undefined): string {
  const normalized = queue?.trim();
  if (!normalized) {
    throw new BadRequestException('queue is required');
  }

  return normalized;
}

export function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
