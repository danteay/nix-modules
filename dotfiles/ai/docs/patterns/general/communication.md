# Communication Patterns (General)

> REST, gRPC, and WebSocket — when to use each and design rules.

---

## Choosing a Protocol

| Criterion | REST | gRPC | WebSocket |
|-----------|------|------|-----------|
| Client type | Any (browser, mobile, service) | Internal service-to-service | Browser / native app |
| Communication model | Request-response | Request-response + streaming | Bidirectional |
| Contract | OpenAPI / JSON Schema | Protobuf (strict) | Custom JSON or binary |
| Latency | Medium | Low | Low |
| Browser support | Native | Requires grpc-web | Native |
| Observability | Easy | Requires middleware | Requires middleware |

---

## REST

### When to Use

- Public-facing APIs or partner integrations
- CRUD-heavy resources
- Browser clients
- Human-readable request inspection matters

### Design Rules

| Rule | Example |
|------|---------|
| Resources are nouns | `/orders`, `/users/{id}` |
| HTTP verbs reflect intent | `GET` read, `POST` create, `PUT/PATCH` update, `DELETE` remove |
| Status codes are meaningful | `201` created, `204` no content, `422` validation, `409` conflict |
| Versioning in path | `/v1/orders` |
| Pagination via cursor | `?limit=20&cursor=abc` |
| Errors follow RFC 7807 | `{ "type", "title", "status", "detail" }` |

### Response Envelope

```json
// Success (200)
{ "data": { "id": "123", "status": "placed" } }

// Collection (200)
{ "data": [...], "meta": { "total": 100, "cursor": "next-token" } }

// Error (4xx/5xx) — RFC 7807
{
  "type": "https://example.com/errors/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "email is required"
}
```

### Contract Testing

REST APIs must have contract tests ensuring request/response shapes match consumer expectations. See [Testing Strategies](../../testing/general/strategies.md#contract-tests).

---

## gRPC

### When to Use

- Service-to-service communication (internal only)
- High-throughput, low-latency calls
- Strongly typed contracts between teams
- Streaming requirements
- When generated client SDKs simplify integration

### Protobuf Schema Design

```protobuf
syntax = "proto3";
package orders.v1;
option go_package = "github.com/org/service/gen/orders/v1";

service OrderService {
  rpc PlaceOrder(PlaceOrderRequest) returns (PlaceOrderResponse);
  rpc GetOrder(GetOrderRequest) returns (Order);
  rpc ListOrders(ListOrdersRequest) returns (stream Order);
}

message PlaceOrderRequest {
  string customer_id = 1;
  repeated OrderItem items = 2;
}
```

### Versioning Rules

- Package versioning: `orders.v1`, `orders.v2`
- Never remove or renumber fields — mark `deprecated = true`
- Additive-only changes within a version
- Create `v2` for breaking changes; support both during migration window

### Error Handling

Use gRPC status codes:

```
codes.NotFound        → resource not found
codes.InvalidArgument → validation error
codes.AlreadyExists   → conflict
codes.PermissionDenied → authorization failure
codes.Internal        → unexpected server error
```

### AWS + gRPC

Lambda does not natively support gRPC (requires HTTP/2 persistent connections). Options:

- ALB with HTTP/2 + ECS/Fargate
- grpc-gateway: expose REST → translate to internal gRPC
- API Gateway HTTP API with Lambda for REST, grpc-web for browsers

---

## WebSocket

### When to Use

- Real-time bidirectional communication (chat, live dashboards, collaborative editing)
- Push notifications to browser clients without polling
- Streaming responses from server

### Connection Management

Store connection IDs per user in a fast lookup store (DynamoDB, Redis):

```
Connect    → save connectionId → userId mapping
Disconnect → remove connectionId
Send       → get all connectionIds for userId → push to each
```

### Message Protocol

Define a typed envelope:

```json
// Client → Server
{ "action": "send-message", "data": { "room": "general", "text": "hello" } }

// Server → Client
{ "type": "message",  "data": { "from": "user1", "text": "hello", "ts": 1234 } }
{ "type": "error",    "data": { "code": "room_not_found", "message": "..." } }
{ "type": "presence", "data": { "userId": "user2", "status": "online" } }
```

### AWS API Gateway WebSocket (Serverless)

```yaml
# serverless.yml
functions:
  ws-connect:
    handler: cmd/ws/connect/main.go
    events:
      - websocket: { route: $connect }

  ws-disconnect:
    handler: cmd/ws/disconnect/main.go
    events:
      - websocket: { route: $disconnect }

  ws-message:
    handler: cmd/ws/message/main.go
    events:
      - websocket: { route: send-message }
```

---

## Cross-References

→ [Messaging Patterns](./messaging.md) | [Testing Strategies](../../testing/general/strategies.md) | [Architecture Overview](../../reference/architecture-overview.md)
