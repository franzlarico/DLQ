import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { normalizeOptionalString, parseLimit, requireQueueName, type RequeueRequestBody } from './dto';
import { RabbitService } from './rabbit.service';
import type { InspectedMessage, QueueInfo, RabbitConfig, RequeueResult } from './rabbit.types';

@Controller('rabbit')
export class RabbitController {
  constructor(private readonly rabbitService: RabbitService) {}

  @Get('config')
  getConfig(): Omit<RabbitConfig, 'url'> & { urlConfigured: boolean } {
    const defaults = this.rabbitService.getDefaults();

    return {
      urlConfigured: Boolean(defaults.url),
      prefetch: defaults.prefetch,
      defaultDlq: defaults.defaultDlq,
      defaultRequeueExchange: defaults.defaultRequeueExchange,
      defaultRequeueRoutingKey: defaults.defaultRequeueRoutingKey,
    };
  }

  @Get('queues/:queue')
  getQueueInfo(@Param('queue') queue: string): Promise<QueueInfo> {
    return this.rabbitService.getQueueInfo(requireQueueName(queue));
  }

  @Get('queues/:queue/messages')
  inspectMessages(@Param('queue') queue: string, @Query('limit') limit?: string): Promise<InspectedMessage[]> {
    return this.rabbitService.inspectMessages(requireQueueName(queue), parseLimit(limit, 10, 100));
  }

  @Post('queues/:queue/requeue')
  requeueMessages(@Param('queue') queue: string, @Body() body: RequeueRequestBody = {}): Promise<RequeueResult> {
    const defaults = this.rabbitService.getDefaults();
    const targetExchange =
      normalizeOptionalString(body.targetExchange) ?? defaults.defaultRequeueExchange ?? '';
    const targetRoutingKey =
      normalizeOptionalString(body.targetRoutingKey) ?? defaults.defaultRequeueRoutingKey;

    return this.rabbitService.requeueMessages({
      sourceQueue: requireQueueName(queue),
      limit: parseLimit(body.limit, 1, 100),
      targetExchange,
      targetRoutingKey,
    });
  }
}
