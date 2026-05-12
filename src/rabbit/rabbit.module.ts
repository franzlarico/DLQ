import { Module } from '@nestjs/common';
import { RabbitController } from './rabbit.controller';
import { RabbitService } from './rabbit.service';
import { AuditModule } from '../audit/audit.module';
import { NacosModule } from '../nacos/nacos.module';

@Module({
  imports: [AuditModule, NacosModule],
  controllers: [RabbitController],
  providers: [RabbitService],
  exports: [RabbitService],
})
export class RabbitModule {}