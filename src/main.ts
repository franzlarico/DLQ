import { initializeAPM, initializeElasticsearchTemplate, WinstonLoggerService } from '@crm4/logger';
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { parseLogLevels, sanitizeAmqpUrl } from './common/logging.utils';
import { EnvConfiguration } from './common/config/nacos.config';

async function bootstrap(): Promise<void> {
  await EnvConfiguration();

  console.log(EnvConfiguration)
  const apmAgent = initializeAPM({
    serviceName: `colas-muertas`,
    serverUrl: process.env.ELASTIC_APM_SERVER_URL,
    environment: process.env.NODE_ENV,
  });

  if (apmAgent) {
    console.log('APM Agent initialized successfully');
  }

  // 3. Elastic ANTES de Nest
  await initializeElasticsearchTemplate({
    serviceName: 'deadqueue.log',
    elasticsearchUrl: process.env.ELASTICSEARCH_URL,
    elasticUsername: process.env.ELASTIC_USERNAME,
    elasticPassword: process.env.ELASTIC_PASSWORD,
  });

  const app = await NestFactory.create(AppModule, {
    logger: parseLogLevels(process.env.LOG_LEVEL),
  });
  const logger = app.get(WinstonLoggerService);
  const corsOrigin = process.env.CORS_ORIGIN ?? '*';

  app.enableShutdownHooks();
  app.enableCors({
    origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((origin) => origin.trim()),
  });
  const swaggerConfig = new DocumentBuilder()
    .setTitle('DLQ Console API')
    .setDescription('API for inspecting RabbitMQ DLQ messages and requeueing them safely.')
    .setVersion('1.0.0')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  logger.setElasticReady();

  logger.log(`backend listening on http://localhost:${port}`);
  logger.log(`swagger docs: http://localhost:${port}/docs`);
  logger.log(`cors origin: ${corsOrigin}`);
  logger.log(
    `rabbitmq target: ${sanitizeAmqpUrl(process.env.RABBITMQ_AMQ ?? 'amqp://user:password@localhost:5672')}`,
  );
}

void bootstrap();
