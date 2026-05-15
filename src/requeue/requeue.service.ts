import { Injectable } from '@nestjs/common';
import { WinstonLoggerService } from '@crm4/logger';

import type { RequeueResult } from '../rabbit/rabbit.types';
import { RabbitService } from '../rabbit/rabbit.service';

export interface RequeueJobRequest {
  sourceQueue: string;
  limit: number;
  targetExchange: string;
  targetRoutingKey?: string;
  requestedBy?: string;
}

@Injectable()
export class RequeueJobService {
  constructor(
    private readonly rabbitService: RabbitService,
    private readonly logger: WinstonLoggerService,
  ) {}

  async createJob(request: RequeueJobRequest): Promise<RequeueResult> {
    const transaction = this.logger.startManualTransaction(
      'requeue-job-create',
      'rabbitmq',
      {
        sourceQueue: request.sourceQueue,
        targetExchange: request.targetExchange,
        targetRoutingKey: request.targetRoutingKey,
        requestedBy: request.requestedBy,
      },
    );

    const startedAt = Date.now();

    try {
      this.logger.logStructured('Starting requeue job', {
        request,
      });

      const span = transaction.startSpan(
        'rabbitmq.requeueMessages',
        'rabbitmq',
      );

      const result = await this.rabbitService.requeueMessages({
        sourceQueue: request.sourceQueue,
        limit: request.limit,
        targetExchange: request.targetExchange,
        targetRoutingKey: request.targetRoutingKey,
      });

      span.end();

      const duration = Date.now() - startedAt;

      this.logger.logJob(
        'requeue-job',
        {
          sourceQueue: request.sourceQueue,
          targetExchange: request.targetExchange,
          targetRoutingKey: request.targetRoutingKey,
          limit: request.limit,
          requestedBy: request.requestedBy,
          durationMs: duration,
          result,
        },
        'completed',
      );

      transaction.setContext({
        result,
        durationMs: duration,
      });

      transaction.end('success');

      return result;
    } catch (error) {
      const duration = Date.now() - startedAt;

      this.logger.logJob(
        'requeue-job',
        {
          sourceQueue: request.sourceQueue,
          targetExchange: request.targetExchange,
          targetRoutingKey: request.targetRoutingKey,
          limit: request.limit,
          requestedBy: request.requestedBy,
          durationMs: duration,
        },
        'failed',
        error as Error,
      );

      this.logger.logError(
        error,
        'RequeueJobService.createJob',
        {
          request,
          durationMs: duration,
        },
      );

      transaction.end('failure', error as Error);

      throw error;
    }
  }

  async runJobAndReturnResult(
    request: RequeueJobRequest,
  ): Promise<RequeueResult> {
    const transaction = this.logger.startManualTransaction(
      'requeue-job-run',
      'rabbitmq',
      {
        sourceQueue: request.sourceQueue,
        targetExchange: request.targetExchange,
        targetRoutingKey: request.targetRoutingKey,
        requestedBy: request.requestedBy,
      },
    );

    const startedAt = Date.now();

    try {
      this.logger.logStructured('Running requeue job', {
        request,
      });

      const span = transaction.startSpan(
        'rabbitmq.requeueMessages',
        'rabbitmq',
      );

      const result = await this.rabbitService.requeueMessages({
        sourceQueue: request.sourceQueue,
        limit: request.limit,
        targetExchange: request.targetExchange,
        targetRoutingKey: request.targetRoutingKey,
      });

      span.end();

      const duration = Date.now() - startedAt;

      this.logger.logJob(
        'requeue-job-run',
        {
          sourceQueue: request.sourceQueue,
          targetExchange: request.targetExchange,
          targetRoutingKey: request.targetRoutingKey,
          limit: request.limit,
          requestedBy: request.requestedBy,
          durationMs: duration,
          result,
        },
        'completed',
      );

      transaction.setContext({
        result,
        durationMs: duration,
      });

      transaction.end('success');

      return result;
    } catch (error) {
      const duration = Date.now() - startedAt;

      this.logger.logJob(
        'requeue-job-run',
        {
          sourceQueue: request.sourceQueue,
          targetExchange: request.targetExchange,
          targetRoutingKey: request.targetRoutingKey,
          limit: request.limit,
          requestedBy: request.requestedBy,
          durationMs: duration,
        },
        'failed',
        error as Error,
      );

      this.logger.logError(
        error,
        'RequeueJobService.runJobAndReturnResult',
        {
          request,
          durationMs: duration,
        },
      );

      transaction.end('failure', error as Error);

      throw error;
    }
  }

  getJob(id: string) {
    this.logger.debug(
      `Fetching requeue job info: ${id}`,
      'RequeueJobService',
    );

    return {
      message: `Job ${id} not tracked (observability disabled)`,
    };
  }
}