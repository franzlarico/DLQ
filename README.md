# Rabbit DLQ Console API

Backend NestJS para inspeccionar y reencolar mensajes en DLQ de RabbitMQ con auditoría y dashboards operativos.

## Qué incluye este proyecto

- API para listar colas RabbitMQ y ver mensajes DLQ
- Requeue seguro de mensajes desde una DLQ hacia un exchange/routing key destino
- Auditoría con MongoDB a través de Mongoose
- Dashboards de métricas: resumen, distribución por cola, actividad, excepciones
- Endpoint de salud en `/dashboard/health`
- Swagger UI en `/docs`
- Soporte para recarga dinámica de configuración con Nacos

## Requisitos

- Node.js 20+
- RabbitMQ accesible por AMQP y Management API
- MongoDB accesible para persistencia de auditoría
- Opcional: Nacos si se usa recarga dinámica de configuración

## Instalación y arranque

```bash
npm install
cp .env.example .env
npm run start:dev
```

El proyecto usa `MONGODB_URI` para conectar con MongoDB. Si no se define, usa `mongodb://localhost:27017/dlq-console`.

## Variables de entorno importantes

```env
PORT=3000
CORS_ORIGIN=*
LOG_LEVEL=debug
RABBITMQ_AMQ=amqp://admin:admin@localhost:5672
RABBITMQ_MANAGEMENT_URL=http://localhost:15672
RABBITMQ_PREFETCH=10
RABBITMQ_DEFAULT_DLQ=
RABBITMQ_DEFAULT_REQUEUE_EXCHANGE=
RABBITMQ_DEFAULT_REQUEUE_ROUTING_KEY=
MONGODB_URI=mongodb://localhost:27017/dlq-console
```

## Endpoints principales

```http
GET /docs

GET /rabbit/config
GET /rabbit/queues
GET /rabbit/queues/:queue
GET /rabbit/queues/:queue/messages?limit=10
POST /rabbit/queues/:queue/requeue

POST /requeue/jobs
GET /requeue/jobs/:id

GET /dashboard/summary?window=24h
GET /dashboard/queues?window=24h
GET /dashboard/activity?window=24h&limit=20
GET /dashboard/exceptions?window=24h
GET /dashboard/health

POST /nacos/reload
GET /nacos/status
```

## Notas útiles

- La API de Swagger se expone en `/docs`
- El endpoint `/dashboard/health` valida el estado de la base de datos y reporta dependencias
- El requeue de mensajes DLQ se puede ejecutar desde `/rabbit/queues/:queue/requeue` o `POST /requeue/jobs`
- Al inspeccionar mensajes RabbitMQ desde DLQ, la lógica puede usar `basic.get` y `nack(requeue=true)` para devolver el mensaje a la cola

## Comandos de desarrollo

```bash
npm run start:dev
npm run build
npm run lint
npm run test
npm run test:watch
npm run test:cov
```
