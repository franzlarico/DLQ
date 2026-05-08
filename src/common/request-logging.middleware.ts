import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { formatLogMeta } from './logging.utils';

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    const requestId = request.header('x-request-id')?.trim() || randomUUID();

    response.setHeader('x-request-id', requestId);

    response.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const metadata = {
        requestId,
        method: request.method,
        path: request.originalUrl ?? request.url,
        statusCode: response.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        ip: request.ip,
      };

      if (response.statusCode >= 500) {
        this.logger.error(`request failed ${formatLogMeta(metadata)}`);
        return;
      }

      if (response.statusCode >= 400) {
        this.logger.warn(`request completed with client error ${formatLogMeta(metadata)}`);
        return;
      }

      this.logger.log(`request completed ${formatLogMeta(metadata)}`);
    });

    next();
  }
}
