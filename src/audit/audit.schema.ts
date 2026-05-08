import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AuditLogDocument = HydratedDocument<AuditLog>;

@Schema({ timestamps: true, collection: 'audit_logs' })
export class AuditLog {
  @Prop({ required: true })
  eventType!: string; // 'REQUEUE', 'INSPECT', 'ERROR', etc.

  @Prop({ required: true })
  sourceQueue!: string;

  @Prop()
  targetExchange?: string;

  @Prop()
  targetRoutingKey?: string;

  @Prop()
  messageId?: string;

  @Prop()
  messageSize?: number;

  @Prop()
  messageCount?: number;

  @Prop()
  successCount?: number;

  @Prop()
  errorMessage?: string;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;

  @Prop()
  requestedBy?: string;

  @Prop()
  duration?: number; // milliseconds

  @Prop({ type: Date, default: Date.now })
  arrivedAtDlqTime?: Date;

  @Prop()
  status!: 'SUCCESS' | 'PARTIAL' | 'FAILED'; // status of operation

  // Complete message data storage
  @Prop({ type: Object })
  messageBody?: unknown; // Original message body (json/string/base64)

  @Prop({ type: Object })
  messageProperties?: Record<string, unknown>; // Complete message properties

  @Prop({ type: Object })
  messageHeaders?: Record<string, unknown>; // All message headers

  @Prop({ type: Object })
  dlqMetadata?: Record<string, unknown>; // Complete DLQ metadata (x-death, etc)

  @Prop()
  messageBodyEncoding?: string; // 'json' | 'utf8' | 'base64' | 'empty'

  @Prop()
  originalExchange?: string; // Original exchange before DLQ

  @Prop([String])
  originalRoutingKeys?: string[]; // Original routing keys
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ eventType: 1, createdAt: -1 });
AuditLogSchema.index({ sourceQueue: 1, createdAt: -1 });
AuditLogSchema.index({ messageId: 1 });
AuditLogSchema.index({ createdAt: -1 });
