import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RequeueJobService } from '../requeue/requeue.service';
import { normalizeOptionalString, parseLimit, requireQueueName, type RequeueRequestBody } from './dto';
import { RabbitService } from './rabbit.service';
import type { InspectedMessage, QueueInfo, QueueListItem, RabbitConfig, RequeueResult } from './rabbit.types';

@Controller('rabbit')
export class RabbitController {
  constructor(
    private readonly rabbitService: RabbitService,
    private readonly requeueJobService: RequeueJobService,
  ) {}

  @Get('config')
  getConfig(): Omit<RabbitConfig, 'url' | 'managementUrl'> & {
    urlConfigured: boolean;
    managementUrlConfigured: boolean;
  } {
    const defaults = this.rabbitService.getDefaults();

    return {
      urlConfigured: Boolean(defaults.url),
      managementUrlConfigured: Boolean(defaults.managementUrl),
      prefetch: defaults.prefetch,
      defaultDlq: defaults.defaultDlq,
      defaultRequeueExchange: defaults.defaultRequeueExchange,
      defaultRequeueRoutingKey: defaults.defaultRequeueRoutingKey,
    };
  }

  @Get('queues')
  listQueues(): Promise<QueueListItem[]> {
    return this.rabbitService.listQueues();
  }

  @Get('queues/:queue')
  getQueueInfo(@Param('queue') queue: string): Promise<QueueInfo> {
    return this.rabbitService.getQueueInfo(requireQueueName(queue));
  }

  @Get('queues/:queue/messages')
  async inspectMessages(@Param('queue') queue: string, @Query('limit') limit?: string): Promise<InspectedMessage[]> {
    const messages = await this.rabbitService.inspectMessages(requireQueueName(queue), parseLimit(limit, 10, 100));
    return messages;
  }

  @Post('queues/:queue/requeue')
  async requeueMessages(@Param('queue') queue: string, @Body() body: RequeueRequestBody = {}): Promise<RequeueResult> {
    const defaults = this.rabbitService.getDefaults();
    const targetExchange =
      normalizeOptionalString(body.targetExchange) ?? defaults.defaultRequeueExchange ?? '';
    const targetRoutingKey =
      normalizeOptionalString(body.targetRoutingKey) ?? defaults.defaultRequeueRoutingKey;

    return this.requeueJobService.runJobAndReturnResult({
      sourceQueue: requireQueueName(queue),
      limit: parseLimit(body.limit, 1, 100),
      targetExchange,
      targetRoutingKey,
    });
  }
}
