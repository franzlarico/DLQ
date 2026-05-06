import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const corsOrigin = process.env.CORS_ORIGIN ?? '*';

  app.enableCors({
    origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((origin) => origin.trim()),
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`✅ Backend corriendo en http://localhost:${port}`);
  console.log(`🔗 RabbitMQ URL: ${process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672'}`);
}

void bootstrap();
