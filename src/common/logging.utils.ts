import type { LogLevel } from '@nestjs/common';

export function formatLogMeta(metadata: Record<string, unknown>): string {
  return JSON.stringify(metadata, (_key, value) => {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
      };
    }

    return value;
  });
}

export function sanitizeAmqpUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);

    if (url.username) {
      url.username = '***';
    }

    if (url.password) {
      url.password = '***';
    }

    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function parseLogLevels(rawLevels: string | undefined): LogLevel[] {
  const allowedLevels: LogLevel[] = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'];
  const normalized = rawLevels
    ?.split(',')
    .map((level) => level.trim().toLowerCase())
    .filter((level): level is LogLevel => allowedLevels.includes(level as LogLevel));

  return normalized?.length ? normalized : ['log', 'error', 'warn', 'debug'];
}
