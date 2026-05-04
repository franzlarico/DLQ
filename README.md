# Rabbit DLQ Console API

Backend NestJS para inspeccionar mensajes de una DLQ de RabbitMQ, ver metadata y reencolarlos desde una API HTTP.

## Requisitos

- Node.js 20+
- RabbitMQ accesible por AMQP

## Instalacion

```bash
npm install
cp .env.example .env
npm run start:dev
```

Opcional para levantar RabbitMQ local:

```bash
docker compose up -d
```

Panel RabbitMQ local: <http://localhost:15672> con `guest / guest`.

## Endpoints

```http
GET /health
GET /rabbit/queues/:queue
GET /rabbit/queues/:queue/messages?limit=10
POST /rabbit/queues/:queue/requeue
```

Ejemplo para inspeccionar metadata sin consumir definitivamente:

```bash
curl "http://localhost:3000/rabbit/queues/example.dlq/messages?limit=5"
```

Ejemplo para reencolar:

```bash
curl -X POST "http://localhost:3000/rabbit/queues/example.dlq/requeue" \
  -H "Content-Type: application/json" \
  -d "{\"limit\":5,\"targetRoutingKey\":\"example.queue\"}"
```

Si `targetRoutingKey` no se envia, la API intenta usar el primer routing key del header `x-death`.

## Nota importante

RabbitMQ via AMQP no tiene un "peek" real de mensajes. Para inspeccionar, la API hace `basic.get`, transforma el mensaje a JSON de lectura y luego hace `nack` con `requeue=true`, de modo que el mensaje queda nuevamente en la cola. Esto puede cambiar su posicion relativa en la cola.
