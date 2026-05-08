# Rabbit DLQ Console API

Backend NestJS para inspeccion, requeue y observabilidad operativa de DLQ en RabbitMQ.

## Lo nuevo en este MVP

- Persistencia de auditoria y KPIs con PostgreSQL o fallback `sqljs`
- Worker continuo para capturar snapshots y muestrear DLQ activas
- Dashboard API para summary, queues, exceptions y activity
- Jobs de requeue auditados
- Health checks de API, Rabbit AMQP, Rabbit Management y base de datos
- Swagger en `/docs`

## Requisitos

- Node.js 20+
- RabbitMQ accesible por AMQP y Management
- PostgreSQL recomendado para historico real

## Instalacion

```bash
npm install
cp .env.example .env
npm run start:dev
```

Si no configuras `DATABASE_URL`, el backend usa `sqljs` persistido en archivo para no bloquear el arranque local.

## Variables importantes

```env
PORT=3001
RABBITMQ_URL=amqp://admin:admin@localhost:5672
RABBITMQ_MANAGEMENT_URL=http://localhost:15672
DATABASE_URL=postgres://postgres:postgres@localhost:5432/dlq_console
DLQ_COLLECTOR_INTERVAL_MS=30000
DLQ_COLLECTOR_INSPECT_LIMIT=5
```

## Endpoints principales

```http
GET /health
GET /docs

GET /rabbit/config
GET /rabbit/queues
GET /rabbit/queues/:queue
GET /rabbit/queues/:queue/messages?limit=10
POST /rabbit/queues/:queue/requeue

GET /dashboard/summary?window=24h
GET /dashboard/queues?window=24h
GET /dashboard/exceptions?window=24h
GET /dashboard/activity?window=24h&limit=12
GET /dashboard/export?window=24h&format=csv

POST /requeue/jobs
GET /requeue/jobs/:id
```

## Requeue auditado

`POST /requeue/jobs` crea un job persistido, ejecuta el requeue y guarda:

- cola origen
- destino inferido o manual
- cantidad solicitada y real
- duracion
- items reencolados

Los headers de DLQ como `x-death` y `x-first/last-death-*` se limpian antes de republicar.

## Nota importante

RabbitMQ via AMQP no tiene un "peek" real de mensajes. Para inspeccionar, la API hace `basic.get`, transforma el mensaje y luego `nack` con `requeue=true`, por lo que el mensaje vuelve a la cola y puede cambiar de posicion relativa.

## Tests

```bash
npm test -- --runInBand
npm run build
```
