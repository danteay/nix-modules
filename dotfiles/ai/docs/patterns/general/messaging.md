# Messaging Patterns (General)

> SNS+SQS, Kafka, RabbitMQ, NATS, Redis Pub/Sub — when to use each and key configuration rules.

---

## Choosing a Message Broker

| Broker | Use When |
|--------|---------|
| **SNS + SQS** | AWS-native, fan-out to multiple consumers, serverless Lambda consumers |
| **Kafka** | High-throughput event streaming, event replay, long retention, ordered streams |
| **RabbitMQ** | Complex routing (topic/header exchanges), existing AMQP ecosystem |
| **NATS** | Ultra-low latency, lightweight pub/sub or request-reply |
| **Redis Pub/Sub** | Ephemeral notifications, at-most-once delivery acceptable |

---

## AWS SNS + SQS (Preferred for Serverless)

### Architecture

```
Publisher ──► SNS Topic ──┬──► SQS Queue A ──► Lambda A
                          └──► SQS Queue B ──► Lambda B
                                    │
                                    └──► DLQ (failed messages, 14d retention)
```

### Configuration Rules

- Always configure a **DLQ** with 14-day retention
- Use **`ReportBatchItemFailures`** for partial batch success
- Events must be **idempotent** — SQS delivers at-least-once
- Use **SNS filter policies** to reduce unnecessary consumer invocations
- Set **visibility timeout** ≥ Lambda max duration × 6

### SNS Filter Policy Example

```json
{ "eventType": ["OrderPlaced", "OrderCancelled"] }
```

---

## Kafka

### When to Use

- Event log with long retention (days to months)
- Multiple independent consumer groups reading the same stream
- Exactly-once semantics required
- High throughput (millions of events/day)
- Event replay or time-travel debugging

### Topic Naming

```
{domain}.{entity}.{event-type}
orders.order.placed
payments.payment.processed
inventory.stock.reserved
```

### Key Rules

- **Partition key** = entity ID (ordered processing per entity)
- **Consumer group** = one per service (independent offset tracking)
- **Retention** — configure per topic (default 7 days, longer for replay use cases)
- **Schema registry** for production (Avro or Protobuf)
- No built-in DLQ — implement an error topic manually

---

## RabbitMQ

### When to Use

- Complex routing requirements (topic/headers exchanges)
- Existing AMQP infrastructure
- Message TTL and priority queues
- Per-message acknowledgment control

### Exchange Types

| Type | Routes by | Use case |
|------|-----------|---------|
| **direct** | Exact routing key | Simple queue dispatch |
| **topic** | Wildcard routing key (`orders.#`) | Event routing |
| **fanout** | Broadcast | Publish to all bound queues |
| **headers** | Message headers | Attribute-based routing |

### Configuration Rules

- Always declare **dead letter exchanges** (`x-dead-letter-exchange`)
- Use **durable exchanges and queues** for persistence across restarts
- Set **prefetch count** on consumers to avoid unbounded memory use
- Acknowledge messages **after** processing, never before

---

## NATS

### When to Use

- Ultra-low latency pub/sub (sub-millisecond)
- Lightweight microservice mesh
- Request-reply pattern
- JetStream for persistent, ordered, at-least-once delivery

### Subject Naming

```
orders.placed
orders.cancelled
payments.processed
inventory.reserved.{sku}   # parameterized subjects
```

### JetStream (Persistent)

Create a stream for subjects that need persistence and replay:

```
Stream:   ORDERS (subjects: orders.>)
Consumer: order-processor (pull, durable)
Retention: WorkQueue
```

---

## Redis Pub/Sub vs. Redis Streams

### Pub/Sub (Ephemeral)

- **At-most-once** — messages lost if subscriber is down
- No persistence, no replay
- Use for: cache invalidation signals, transient notifications

### Redis Streams (Persistent)

- **At-least-once** with consumer groups
- Persistent, replayable
- Use when you want Kafka-like semantics on existing Redis infrastructure

---

## Dead Letter Queue Strategy

All production message consumers must handle failure:

```
Primary Queue ──3 retries──► DLQ
                                │
                          ──► CloudWatch Alarm (alert on DLQ depth)
                          ──► Manual reprocessing script
                          ──► 14-day retention window
```

Standard policy: 3 attempts with backoff, then DLQ with 14-day retention.

---

## SQS Lambda Integration (Key Settings)

```yaml
# serverless.yml
functions:
  process-events:
    handler: cmd/events/process/main.go
    events:
      - sqs:
          arn: { "Fn::GetAtt": [EventsQueue, Arn] }
          batchSize: 10
          maximumBatchingWindowInSeconds: 5
          functionResponseType: ReportBatchItemFailures

resources:
  Resources:
    EventsQueue:
      Type: AWS::SQS::Queue
      Properties:
        VisibilityTimeout: 180       # must be >= Lambda timeout * 6
        MessageRetentionPeriod: 345600
        RedrivePolicy:
          deadLetterTargetArn: { "Fn::GetAtt": [EventsDLQ, Arn] }
          maxReceiveCount: 3

    EventsDLQ:
      Type: AWS::SQS::Queue
      Properties:
        MessageRetentionPeriod: 1209600   # 14 days
```

---

## Cross-References

→ [Software Patterns](./software.md) | [Communication Patterns](./communication.md) | [Concurrency Patterns](./concurrency.md) | [Deployment Guide](../../guides/deployment.md)
