import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service';

type DashboardWindow = '24h' | '7d' | '30d' | 'all';

@Controller('dashboard')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('summary')
  async getSummary(@Query('window') window: DashboardWindow = '24h') {
    const summary = await this.auditService.getDlqMessagesSummary(window);
    return {
      window,
      summary,
    };
  }

  @Get('queues')
  async getQueues(@Query('window') window: DashboardWindow = '24h') {
    const distribution = await this.auditService.getQueueDistribution(window);
    return distribution;
  }

  @Get('activity')
  async getActivity(
    @Query('window') window: DashboardWindow = '24h',
    @Query('limit') limit: string = '20',
  ) {
    const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
    const activity = await this.auditService.getRecentActivity(window, limitNum);
    return activity;
  }

  @Get('exceptions')
  async getExceptions(@Query('window') window: DashboardWindow = '24h') {
    const exceptions = await this.auditService.getExceptionSummary(window);
    return exceptions;
  }

  @Get('health')
  async getHealth() {
    return {
      status: 'up',
      dependencies: {
        database: { status: 'up' },
        rabbitAmqp: { status: 'up' },
        rabbitManagement: { status: 'up' },
      },
    };
  }
}
