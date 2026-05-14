import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RequestLoggingMiddleware } from './common/request-logging.middleware';
import { RabbitController } from './rabbit/rabbit.controller';
import { RabbitService } from './rabbit/rabbit.service';
import { RequeueController } from './requeue/requeue.controller';
import { RequeueJobService } from './requeue/requeue.service';
import { AuditModule } from './audit/audit.module';
import { NacosController } from './nacos/nacos.controller';
import { NacosService } from './nacos/nacos.service';
import { LoggerModule } from '@crm4/logger';

@Module({
  imports: [
    MongooseModule.forRoot(
      process.env.MONGODB_URI ?? 'mongodb://localhost:27017/dlq-console',
    ),
    LoggerModule.forRootAsync({
      useFactory: () => ({
        serviceName: `deadqueue.log`,
        serviceNodeName: `colas-muertas-node`,
        logFilename: `deadqueue`,
      }),
    }),
    AuditModule,
  ],
  controllers: [RabbitController, RequeueController, NacosController],
  providers: [RabbitService, RequeueJobService, NacosService],
})
export class AppModule { }
