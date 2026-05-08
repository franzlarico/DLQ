import { Injectable } from '@nestjs/common';
import type { RequeueResult } from '../rabbit/rabbit.types';
import { RabbitService } from '../rabbit/rabbit.service';
import { AuditService } from '../audit/audit.service';

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
    private readonly auditService: AuditService,
  ) {}

  async createJob(request: RequeueJobRequest): Promise<RequeueResult> {
    return this.rabbitService.requeueMessages({
      sourceQueue: request.sourceQueue,
      limit: request.limit,
      targetExchange: request.targetExchange,
      targetRoutingKey: request.targetRoutingKey,
    });
  }

  async runJobAndReturnResult(request: RequeueJobRequest): Promise<RequeueResult> {
    return this.rabbitService.requeueMessages({
      sourceQueue: request.sourceQueue,
      limit: request.limit,
      targetExchange: request.targetExchange,
      targetRoutingKey: request.targetRoutingKey,
    });
  }

  getJob(id: string) {
    return { message: `Job ${id} not tracked (observability disabled)` };
  }
}
