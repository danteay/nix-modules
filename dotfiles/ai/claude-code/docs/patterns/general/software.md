# Software Patterns (General)

> Saga, Event Sourcing, Outbox Pattern, and Event-Driven Architecture — language-agnostic.

---

## Event-Driven Architecture

Services communicate by publishing and consuming events. No direct synchronous calls between services.

### Core Concepts

| Concept | Definition |
|---------|-----------|
| **Event** | Immutable fact that something happened (`OrderPlaced`, `PaymentProcessed`) |
| **Publisher** | Service that emits events (doesn't know consumers) |
| **Consumer** | Service that reacts to events (doesn't know publisher) |
| **Event bus** | Infrastructure that routes events (SNS → SQS, Kafka topic, NATS subject) |

### Event Design Rules

- Events are **past-tense** and **immutable**
- Events carry **enough data** for consumers to act without calling back
- Events are **versioned** — add fields with defaults, never remove
- Every event has a **unique ID** (UUID) for idempotency tracking
- Consumers must be **idempotent** — the same event may arrive more than once

### AWS Pattern (SNS → SQS)

```
Service A                                Service B
   │                                        │
   ├──publish──► SNS Topic ──subscribe──► SQS Queue ──► Lambda Consumer
                    │
                    └──subscribe──► SQS Queue ──► Lambda Consumer (Service C)
```

---

## Saga Pattern

Manages long-running, multi-step workflows across services where each step may fail and require compensation.

### Choreography Saga (Preferred for simpler flows)

Each service reacts to events and publishes its own events. No central coordinator.

```
OrderService          PaymentService         InventoryService
     │                     │                      │
     ├──OrderPlaced──►      │                      │
     │                ──PaymentProcessed──►         │
     │                      │               ──InventoryReserved──►
     │  ◄──────────────── all done ─────────────────┤
```

**Compensating transactions on failure:**

```
PaymentFailed ──► OrderService cancels order
InventoryFailed ──► PaymentService refunds ──► OrderService cancels
```

### Orchestration Saga (For complex flows)

A dedicated saga orchestrator sends commands and awaits responses.

```
SagaOrchestrator state machine:
  StateStarted          → send ReserveInventoryCmd
  StateInventoryReserved → send ProcessPaymentCmd
  StatePaymentProcessed  → send ConfirmOrderCmd
  StatePaymentFailed     → send ReleaseInventoryCmd (compensation)
```

### Saga Rules

- Each saga step must be **idempotent**
- Always define **compensating transactions** for every step
- **Persist saga state** before publishing the next command
- Use a **DLQ** for failed saga messages

---

## Event Sourcing

Store state as a sequence of events, not as a current snapshot.

### When to Use

- Audit trail is a hard requirement
- State must be replayable to any point in time
- Complex business state with many transitions
- CQRS (Command Query Responsibility Segregation) benefits the read model

### Event Store Concept

```
Stream: "order#123"

Version │ Event Type          │ Payload
────────┼─────────────────────┼──────────────────
1       │ OrderCreated        │ { customerId, items }
2       │ ItemAdded           │ { sku, qty }
3       │ DiscountApplied     │ { code, percent }
4       │ OrderPlaced         │ { total }
```

### Aggregate Reconstruction

```
events = eventStore.load("order#123")
order  = reduce(events, apply)   // pure function, no side effects
```

### Snapshots (Performance)

For aggregates with many events, snapshot every N events to avoid full replay on every load.

### DynamoDB Streams Alternative

DynamoDB Streams can replace the outbox table — configure a Lambda to read the stream and publish to SNS/SQS. Simpler, but less control over retry behavior.

---

## Outbox Pattern

Guarantees that database writes and event publishing are atomic — no lost events.

### Problem

```
db.save(order)
publisher.publish(OrderPlaced{})   // crash here = lost event
```

### Solution

Write events to an `outbox` table in the **same database transaction**. A relay process reads and publishes them.

```
Transaction (atomic):
  1. Save order to orders table
  2. Save event to outbox table

Relay (separate process):
  3. Fetch unpublished outbox events
  4. Publish each to SNS/SQS/Kafka
  5. Mark as published
```

### Relay Process Design

```
Schedule: every 10s (or triggered by DynamoDB Stream)
Batch size: 10 events per run
On publish failure: retry with backoff, do not mark published
On repeated failure: alert + DLQ
```

---

## Cross-References

→ [Architecture Patterns](./architecture.md) | [Messaging Patterns](./messaging.md) | [Concurrency Patterns](./concurrency.md)
