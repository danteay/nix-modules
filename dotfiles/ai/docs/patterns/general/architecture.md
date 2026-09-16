# Architecture Patterns (General)

> DDD, Hexagonal Architecture, and Repository Pattern — language-agnostic concepts.

---

## Domain-Driven Design (DDD)

### Core Building Blocks

| Concept | Definition |
|---------|-----------|
| **Domain** | The problem space (e.g., Orders, Users, Payments) |
| **Entity** | Object with identity that persists over time |
| **Value Object** | Immutable, identified by its values (no ID) |
| **Aggregate** | Cluster of entities with a single root; the consistency boundary |
| **Domain Event** | Something that happened in the domain (past tense, immutable) |
| **Repository** | Abstraction for loading/saving aggregates |
| **Domain Service** | Stateless operation that doesn't belong to a single entity |
| **Bounded Context** | Explicit boundary where a model applies consistently |

### Strategic Design Rules

- Each service / microservice owns **one bounded context**
- Cross-context communication via **domain events** (async) or **anti-corruption layer** (sync)
- Never share a database table across bounded contexts
- Use **ubiquitous language** — domain vocabulary must appear in code (variables, methods, types)
- Aggregates are the **consistency unit** — no transactions crossing aggregate roots

### Tactical Layers

```
domain/
├── models       # Entities + Value Objects (pure logic, no I/O)
├── errors       # Domain-specific errors (not infrastructure errors)
└── events       # Domain event type definitions (past tense)
```

---

## Hexagonal Architecture (Ports & Adapters)

The domain is the center. External systems connect through ports (interfaces) implemented by adapters.

```
              Driving side                   Driven side
                (inbound)                    (outbound)

  HTTP ────► [adapter] ──────────────────── [adapter] ──► Database
  Queue ───► [adapter] ──► [  Domain  ] ── [adapter] ──► Message Queue
  CLI ─────► [adapter] ──────────────────── [adapter] ──► External API
                          [   Core   ]
```

### Ports

- **Driving ports** — interfaces the domain exposes to the outside world (what callers use)
- **Driven ports** — interfaces the domain requires from infrastructure (what the domain calls)

### Benefits

- Domain has **no imports** from infrastructure packages
- Infrastructure can be swapped without touching business logic
- All domain logic is testable with pure in-memory implementations

### Layer Mapping to 5-Layer Architecture

```
Handler    → Primary adapter (HTTP/event → driving port)
Worker     → Driving port implementation + orchestration
UseCase    → Complex domain workflows (optional)
Service    → Domain logic (core)
Repository → Driven port + secondary adapter (DB/cache)
```

---

## Repository Pattern

Single abstraction for all data access per domain aggregate.

### Rules

- **One repository per aggregate root** — never multiple, never split across files
- Repository **interface** belongs to the domain layer (defines what the domain needs)
- Repository **implementation** belongs to the infrastructure layer
- Only aggregate roots have repositories — child entities are fetched via their root
- Methods are domain-oriented, not CRUD: `FindPendingOrders`, `FindByCustomer`

### Interface Principle

```
domain/ ───defines──► OrderRepository interface
                              ↑
repository/ ──implements──────┘
```

The domain defines what it needs. Infrastructure satisfies it.

### Anti-Patterns

| Wrong | Right |
|-------|-------|
| Multiple repositories for one domain | One repository per aggregate root |
| Methods: `GetAll`, `Create`, `Update` | Domain-oriented: `FindPending`, `SaveDraft` |
| Business logic inside repository | Repository only does data mapping |
| Repository returns raw DB types | Repository maps to domain types |
| Cross-domain repository access | Each domain accesses only its own data |

---

## Cross-References

→ Language-specific implementations:
- [Go Architecture](../../conventions/go/index.md)
- [Python Architecture](../../conventions/python/index.md)
- [TypeScript Architecture](../../conventions/typescript/index.md)

→ [Software Patterns](./software.md) | [Code Patterns](./code.md) | [Architecture Overview](../../reference/architecture-overview.md)
