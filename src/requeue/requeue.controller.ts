import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { normalizeOptionalString, parseLimit, requireQueueName } from '../rabbit/dto';
import { RequeueJobService } from './requeue.service';

interface RequeueJobBody {
  sourceQueue?: string;
  limit?: number | string;
  targetExchange?: string;
  targetRoutingKey?: string;
  requestedBy?: string;
}

@Controller('requeue')
export class RequeueController {
  constructor(private readonly requeueJobService: RequeueJobService) {}

  @Post('jobs')
  createJob(@Body() body: RequeueJobBody = {}) {
    return this.requeueJobService.createJob({
      sourceQueue: requireQueueName(body.sourceQueue),
      limit: parseLimit(body.limit, 1, 500),
      targetExchange: normalizeOptionalString(body.targetExchange) ?? '',
      targetRoutingKey: normalizeOptionalString(body.targetRoutingKey),
      requestedBy: normalizeOptionalString(body.requestedBy) ?? 'internal-network',
    });
  }

  @Get('jobs/:id')
  getJob(@Param('id') id: string) {
    return this.requeueJobService.getJob(id);
  }
}
