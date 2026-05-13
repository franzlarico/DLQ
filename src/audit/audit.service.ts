import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
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
  private readonly logger = new Logger(AuditService.name);

  constructor(@InjectModel(AuditLog.name) private auditLogModel: Model<AuditLogDocument>) {}

  async log(data: AuditLogCreateDto): Promise<AuditLogDocument> {
    try {
      const auditLog = new this.auditLogModel(data);
      const saved = await auditLog.save();
      
      // Log summary only for successful operations
      if (data.status === 'SUCCESS') {
        this.logger.log(
          `[AUDIT] ${data.eventType} completed: ${data.sourceQueue} → ${data.targetExchange || 'N/A'} (${data.successCount}/${data.messageCount} msgs, ${data.duration}ms)`,
        );
      } else if (data.status === 'PARTIAL') {
        this.logger.warn(
          `[AUDIT] ${data.eventType} partial: ${data.sourceQueue} → ${data.targetExchange || 'N/A'} (${data.successCount}/${data.messageCount} msgs) - ${data.errorMessage}`,
        );
      } else {
        this.logger.error(
          `[AUDIT] ${data.eventType} failed: ${data.sourceQueue} - ${data.errorMessage}`,
        );
      }
      
      return saved;
    } catch (error) {
      this.logger.error(`Failed to save audit log: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async checkDatabaseHealth(): Promise<{ status: 'up' | 'down'; detail?: string }> {
    try {
      await this.auditLogModel.estimatedDocumentCount().exec();
      return { status: 'up' };
    } catch (error) {
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
    return {
      totalMessages: result.totalMessages || 0,
      totalRequeued: result.totalRequeued || 0,
      uniqueQueues: result.uniqueQueues?.length || 0,
      averageRequeueSize: result.averageRequeueSize || 0,
    };
  }

  async getQueueDistribution(window: '24h' | '7d' | '30d' | 'all' = '24h'): Promise<
    Array<{
      queue: string;
      totalMessages: number;
      requeuedMessages: number;
      failedOperations: number;
    }>
  > {
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

    return aggregation;
  }

  async getRecentActivity(
    window: '24h' | '7d' | '30d' | 'all' = '24h',
    limit: number = 20,
  ): Promise<AuditLogDocument[]> {
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

  async getExceptionSummary(window: '24h' | '7d' | '30d' | 'all' = '24h'): Promise<
    Array<{
      reason: string;
      count: number;
    }>
  > {
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

    return aggregation;
  }
}
