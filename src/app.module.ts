import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { RabbitController } from './rabbit/rabbit.controller';
import { RabbitService } from './rabbit/rabbit.service';

@Module({
  imports: [],
  controllers: [HealthController, RabbitController],
  providers: [RabbitService],
})
export class AppModule {}
