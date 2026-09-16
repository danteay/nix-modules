# Architecture Overview

> Canonical reference for project architecture across all services.

## Core Principles

1. **Domain-Driven Design** — Business logic lives in domain layers; infrastructure is a detail
2. **Hexagonal Architecture** — Core domain is isolated from external concerns via ports & adapters
3. **One responsibility per component** — Each Lambda/service/module does one thing
4. **Events over direct coupling** — Services communicate via events, not direct calls
5. **Infrastructure as Code** — All resources defined declaratively (Serverless Framework + PKL)

---

## 5-Layer Architecture (Services)

All services follow a strict layered architecture. No layer may skip another.

```
┌─────────────────────────────────────────┐
│  Handler  (entry point — HTTP / event)  │
├─────────────────────────────────────────┤
│  Worker   (orchestration, validation)   │
├─────────────────────────────────────────┤
│  UseCase  (complex workflow, optional)  │
├─────────────────────────────────────────┤
│  Service  (business logic, events)      │
├─────────────────────────────────────────┤
│  Repository (data access abstraction)   │
└─────────────────────────────────────────┘
```

### Layer Responsibilities

| Layer | Owns | Does NOT own |
|-------|------|--------------|
| **Handler** | Deserializing input, calling worker, formatting response | Business logic |
| **Worker** | Validation, input mapping, coordinating service/usecase calls | Data access |
| **UseCase** | Multi-domain workflows, saga orchestration | HTTP concerns |
| **Service** | Business rules, domain entity mutations, **publishing entity events** | Data format details |
| **Repository** | All database/cache reads and writes | Business rules |

### When to Use UseCase

```
Simple CRUD      → Handler → Worker → Service → Repository
Complex workflow → Handler → Worker → UseCase → Service → Repository
Cross-domain     → UseCase coordinates via events (never direct cross-domain imports)
```

---

## Domain Model

Each domain contains:

```text
domains/
└── {domain}/
    ├── domain/
    │   ├── models         # Entities, value objects
    │   ├── events         # Domain event definitions
    │   ├── ports          # Hexagonal port definitions (optional, golang doesn't needs this as use the interface segregation principle)
    │   └── errors         # Domain-specific errors
    ├── repository/        # Data access (one package per domain)
    ├── service/           # Business logic
    └── usecase/           # Complex workflows (optional)
```

**Rules:**

- A `repository` is the representation of a single data storage (DB table, collection or index)
- Entity events published in `service/` layer only
- No cross-domain imports — use events or shared kernel only

---

## Entry Points

### HTTP Lambda (one per endpoint)

```text
?/
└── http/
    └── {endpoint-name}/
        ├── main.?             # Lambda entrypoint
        ├── handler/           # Deserialise → worker → response
        └── lambda-config.yml  # Serverless framework lambda configuration (optional if not using serverless)
```

### Event Consumer Lambda

```text
?/
└── <consumer-type>/
    └── {event-name}/
        ├── main.?
        ├── handler/            # Parse SQS/SNS message → worker
        └── lambda-config.yml   # Serverless framework lambda configuration (optional if not using serverless)
```

### Scheduled Lambda

```text
cmd/
└── scheduled/
    └── {job-name}/
        ├── main.?
        ├── handler/
        └── lambda-config.yml   # Serverless framework lambda configuration (optional if not using serverless)
```

---

## Infrastructure Layer

| Concern | Technology |
|---------|-----------|
| Compute | AWS Lambda (arm64, provided.al2023) |
| Primary DB | AWS DynamoDB |
| Cache | Redis (ElastiCache or container) |
| Async messaging | AWS SQS + SNS |
| Object storage | AWS S3 |
| Config | PKL → evaluated at deploy time |
| Secrets | ejson + AWS Secrets Manager |
| Observability | OpenTelemetry → AWS X-Ray |
| Deployment | Serverless Framework |
| IaaC | Serverless Framework YAML + CloudFormation |

---

## Cross-References

→ [Project Structure](./project-structure.md) | [Patterns](../patterns/) | [Deployment Guide](../guides/deployment.md)
