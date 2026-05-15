import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { WinstonLoggerService } from '@crm4/logger';

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  constructor(
    private readonly logger: WinstonLoggerService,
  ) { }

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    const requestId = request.header('x-request-id')?.trim() || randomUUID();

    response.setHeader('x-request-id', requestId);

    // agregar requestId al request para trazabilidad
    (request as Request & { requestId?: string }).requestId = requestId;

    this.logger.logRequestStart(request);

    response.once('finish', () => {
      const durationMs =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;

      this.logger.logRequestEnd(
        request,
        response,
        durationMs,
      );

      // logs adicionales por status
      if (response.statusCode >= 500) {
        this.logger.error(
          {
            event: 'http.request.failed',
            requestId,
            method: request.method,
            path: request.originalUrl ?? request.url,
            statusCode: response.statusCode,
            durationMs: Number(durationMs.toFixed(2)),
            ip: request.ip,
          },
          undefined,
          'HTTP',
        );

        return;
      }

      if (response.statusCode >= 400) {
        this.logger.warn(
          {
            event: 'http.request.client_error',
            requestId,
            method: request.method,
            path: request.originalUrl ?? request.url,
            statusCode: response.statusCode,
            durationMs: Number(durationMs.toFixed(2)),
            ip: request.ip,
          },
          'HTTP',
        );
      }
    });

    next();
  }
}
