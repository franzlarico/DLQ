import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { WinstonLoggerService } from '@crm4/logger';
import { Model } from 'mongoose';
import { AuditLog, AuditLogDocument } from './audit.schema';

export interface AuditLogCreateDto {
  eventType: string;
  sourceQueue: string;
  targetExchange?: string;
  targetRoutingKey?: string;
  messageId?: string;
  messageSize?: number;
  messageCount?: number;
  successCount?: number;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  requestedBy?: string;
  duration?: number;
  arrivedAtDlqTime?: Date;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';

  // Complete message data
  messageBody?: unknown;
  messageProperties?: Record<string, unknown>;
  messageHeaders?: Record<string, unknown>;
  dlqMetadata?: Record<string, unknown>;
  messageBodyEncoding?: string;
  originalExchange?: string;
  originalRoutingKeys?: string[];
}

@Injectable()
export class AuditService {
  constructor(
    @InjectModel(AuditLog.name)
    private auditLogModel: Model<AuditLogDocument>,

    private readonly logger: WinstonLoggerService,
  ) { }

  async log(data: AuditLogCreateDto): Promise<AuditLogDocument> {
    try {
      const auditLog = new this.auditLogModel(data);
      const saved = await auditLog.save();

      if (data.status === 'SUCCESS') {
        this.logger.logStructured('audit.success', {
          eventType: data.eventType,
          sourceQueue: data.sourceQueue,
          targetExchange: data.targetExchange || 'N/A',
          successCount: data.successCount,
          messageCount: data.messageCount,
          duration: data.duration,
        });
      } else if (data.status === 'PARTIAL') {
        this.logger.logStructured('audit.partial', {
          eventType: data.eventType,
          sourceQueue: data.sourceQueue,
          targetExchange: data.targetExchange || 'N/A',
          successCount: data.successCount,
          messageCount: data.messageCount,
          errorMessage: data.errorMessage,
        });
      } else {
        this.logger.logStructured('audit.failed', {
          eventType: data.eventType,
          sourceQueue: data.sourceQueue,
          errorMessage: data.errorMessage,
        });
      }

      return saved;
    } catch (error) {
      this.logger.logError(
        error instanceof Error ? error : new Error(String(error)),
        'AuditService.log',
        {
          eventType: data.eventType,
          sourceQueue: data.sourceQueue,
        },
      );

      throw error;
    }
  }

  async checkDatabaseHealth(): Promise<{ status: 'up' | 'down'; detail?: string }> {
    try {
      await this.auditLogModel.estimatedDocumentCount().exec();

      this.logger.debug('Database health check OK', 'AuditService');

      return { status: 'up' };
    } catch (error) {
      this.logger.logError(
        error instanceof Error ? error : new Error(String(error)),
        'AuditService.checkDatabaseHealth',
      );

      return {
        status: 'down',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getRequeueHistory(
    sourceQueue: string,
    limit: number = 50,
    skip: number = 0,
  ): Promise<AuditLogDocument[]> {
    this.logger.debug(
      `Fetching requeue history for queue: ${sourceQueue}`,
      'AuditService',
    );

    return this.auditLogModel
      .find({
        eventType: 'REQUEUE',
        sourceQueue,
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .exec();
  }

  async getDlqMessagesSummary(
    window: '24h' | '7d' | '30d' | 'all' = '24h',
  ): Promise<{
    totalMessages: number;
    totalRequeued: number;
    uniqueQueues: number;
    averageRequeueSize: number;
  }> {
    this.logger.debug(
      `Generating DLQ summary for window: ${window}`,
      'AuditService',
    );
    const now = new Date();
    let startDate = new Date();

    switch (window) {
      case '24h':
        startDate.setHours(startDate.getHours() - 24);
        break;
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      default:
        startDate = new Date(0);
    }

    const aggregation = await this.auditLogModel.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: now },
        },
      },
      {
        $group: {
          _id: null,
          totalMessages: { $sum: '$messageCount' },
          totalRequeued: { $sum: '$successCount' },
          uniqueQueues: { $addToSet: '$sourceQueue' },
          averageRequeueSize: { $avg: '$messageSize' },
        },
      },
    ]);

    if (aggregation.length === 0) {
      return {
        totalMessages: 0,
        totalRequeued: 0,
        uniqueQueues: 0,
        averageRequeueSize: 0,
      };
    }

    const result = aggregation[0];

    this.logger.logStructured('audit.dlq.summary.generated', {
      window,
      totalMessages: result.totalMessages || 0,
      totalRequeued: result.totalRequeued || 0,
      uniqueQueues: result.uniqueQueues?.length || 0,
    });

    return {
      totalMessages: result.totalMessages || 0,
      totalRequeued: result.totalRequeued || 0,
      uniqueQueues: result.uniqueQueues?.length || 0,
      averageRequeueSize: result.averageRequeueSize || 0,
    };
  }

  async getQueueDistribution(
    window: '24h' | '7d' | '30d' | 'all' = '24h',
  ): Promise<
    Array<{
      queue: string;
      totalMessages: number;
      requeuedMessages: number;
      failedOperations: number;
    }>
  > {
    this.logger.debug(
      `Generating queue distribution for window: ${window}`,
      'AuditService',
    );

    const now = new Date();
    let startDate = new Date();

    switch (window) {
      case '24h':
        startDate.setHours(startDate.getHours() - 24);
        break;
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      default:
        startDate = new Date(0);
    }

    const aggregation = await this.auditLogModel.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: now },
        },
      },
      {
        $group: {
          _id: '$sourceQueue',
          totalMessages: { $sum: '$messageCount' },
          requeuedMessages: { $sum: '$successCount' },
          failedOperations: {
            $sum: {
              $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0],
            },
          },
        },
      },
      {
        $project: {
          queue: '$_id',
          totalMessages: 1,
          requeuedMessages: 1,
          failedOperations: 1,
        },
      },
      { $sort: { totalMessages: -1 } },
    ]);

    this.logger.logStructured('audit.queue.distribution.generated', {
      window,
      queues: aggregation.length,
    });

    return aggregation;
  }

  async getRecentActivity(
    window: '24h' | '7d' | '30d' | 'all' = '24h',
    limit: number = 20,
  ): Promise<AuditLogDocument[]> {
    this.logger.debug(
      `Fetching recent activity for window: ${window}`,
      'AuditService',
    );

    const now = new Date();
    let startDate = new Date();

    switch (window) {
      case '24h':
        startDate.setHours(startDate.getHours() - 24);
        break;
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      default:
        startDate = new Date(0);
    }

    return this.auditLogModel
      .find({
        createdAt: { $gte: startDate, $lte: now },
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  async getExceptionSummary(
    window: '24h' | '7d' | '30d' | 'all' = '24h',
  ): Promise<
    Array<{
      reason: string;
      count: number;
    }>
  > {
    this.logger.debug(
      `Generating exception summary for window: ${window}`,
      'AuditService',
    );

    const now = new Date();
    let startDate = new Date();

    switch (window) {
      case '24h':
        startDate.setHours(startDate.getHours() - 24);
        break;
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      default:
        startDate = new Date(0);
    }

    const aggregation = await this.auditLogModel.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: now },
          status: 'FAILED',
        },
      },
      {
        $group: {
          _id: '$errorMessage',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
      {
        $project: {
          reason: '$_id',
          count: 1,
        },
      },
    ]);

    this.logger.logStructured('audit.exception.summary.generated', {
      window,
      total: aggregation.length,
    });

    return aggregation;
  }
}