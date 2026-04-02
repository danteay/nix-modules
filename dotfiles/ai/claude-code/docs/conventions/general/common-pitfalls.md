# Common Pitfalls (General)

> Language-agnostic anti-patterns: architecture, events, configuration, and infrastructure.

---

## Architecture Pitfalls

### Skipping Layers

```
WRONG:  Handler → Repository  (skips service)
WRONG:  Handler → DB client   (skips all layers)
CORRECT: Handler → [Worker] → [UseCase] → Service → Repository
```

Each layer has a single responsibility. Skipping layers mixes concerns and makes testing harder.

### Cross-Domain Direct Coupling

```
WRONG  — order service imports payment domain types directly
CORRECT — communicate via domain events
         OrderService publishes "PaymentRequested" event
         PaymentService consumes it and publishes "PaymentCompleted" back
```

Never import types or functions from another bounded context's internal packages. Use events, shared kernel types, or an anti-corruption layer.

### Business Logic in Wrong Layer

| Layer | Belongs | Does NOT Belong |
|-------|---------|----------------|
| Handler | Deserialise, authenticate, route | Validation, domain rules |
| Service | Domain rules, entity mutations | Data formatting, HTTP concerns |
| Repository | Data access, marshalling | Business decisions |

---

## Event / Messaging Pitfalls

### Non-Idempotent Consumers

Events are delivered at-least-once. Every consumer **must** handle duplicate delivery safely.

```
WRONG:  consumer inserts record unconditionally → duplicate on retry
CORRECT: consumer uses upsert or checks event ID before processing
```

### Lost Events (Non-Atomic Publish)

```
WRONG:
  1. Save order to DB
  2. Publish event ← if this crashes, event is lost forever

CORRECT (Outbox Pattern):
  Atomic transaction:
    1. Save order to DB
    2. Save event to outbox table
  Relay process reads outbox and publishes → safe to retry
```

### Missing Dead Letter Queue

Every queue **must** have a DLQ. Silent message loss is worse than visible failure.

### Ignoring Event Schema Evolution

Events are a public API. Consumers depend on the schema. Rules:

- Only **add** fields (with defaults); never remove or rename
- Version events when a breaking change is unavoidable: `OrderPlaced.v2`
- Produce both versions during migration window

---

## Configuration Pitfalls

### Hardcoded Infrastructure Values

```
WRONG:  region = "us-east-1"  (in code)
WRONG:  tableName = "orders-prod"  (in code)
CORRECT: read from env vars injected by infrastructure (CloudFormation Ref), secrets, PKL configs or env vars
```

### Config Validated Too Late

```
WRONG:  os.getenv("TABLE_NAME") called inside request handler
CORRECT: Load and validate ALL config at startup; crash before first request
```

### Secrets in Environment Variables

```
WRONG:  TABLE_PASSWORD: "plaintextpassword"
CORRECT: Use AWS Secrets Manager; inject the ARN, not the value
```

---

## Infrastructure Pitfalls

### Wildcard IAM Permissions

```yaml
# WRONG — way too broad
Action: "*"
Resource: "*"

# CORRECT — least privilege
Action: [dynamodb:GetItem, dynamodb:PutItem]
Resource: arn:aws:dynamodb:region:account:table/my-table
```

### No DLQ + No Monitoring

Every Lambda that processes events needs:

- DLQ on its source queue
- CloudWatch alarm on error rate
- CloudWatch alarm on throttles
- Tracing enabled (OpenTelemetry / X-Ray)

### Click-Ops

Any change made in the AWS console but not reflected in code will be lost on the next deploy and creates config drift. **All infrastructure changes must go through IaaC** (Serverless Framework / CloudFormation / Formae).

### `DeletionPolicy: Delete` on Databases

Always set `DeletionPolicy: Retain` on DynamoDB tables in production. A `serverless remove` should never destroy production data.

---

## Testing Pitfalls

### Mocking Business Logic in Integration Tests

```
WRONG:  service is mocked in handler test → handler passes, but real service is broken
CORRECT: handler test uses real service + real repo; only mock external I/O (SQS, SNS, S3)
```

### Shared State Between Tests

Tests that share state are order-dependent, flaky, and impossible to parallelise. Every test creates its own data and cleans up after itself.

### `sleep` / Polling Without Timeout

```
WRONG:  time.Sleep(2 * time.Second)  // magic number, may still be too short
CORRECT: eventually/retry with explicit timeout and interval
```

---

## Cross-References

→ Language-specific pitfalls are embedded in each language's conventions:

- [Go Conventions](../go/index.md)
- [Python Conventions](../python/index.md)
- [TypeScript Conventions](../typescript/index.md)

→ [Architecture Patterns](../../patterns/general/architecture.md) | [Testing Strategies](../../testing/general/strategies.md)
