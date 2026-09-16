# Patterns Index

> All software patterns grouped by category. Each category has a `general/` folder for language-agnostic content and per-language subfolders for concrete implementations.

## Structure

```
patterns/
├── general/       Language-agnostic concepts
├── go/            Go-specific implementations
├── python/        Python-specific implementations
├── typescript/    TypeScript-specific implementations
├── rust/          Rust-specific implementations
├── elixir/        Elixir/OTP-specific implementations
├── nodejs/        Node.js-specific implementations (ESM, streams)
├── nix/           Nix module and overlay patterns
└── pkl/           PKL schema and amend patterns
```

## Quick Selection

```
New bounded context / service?         → patterns/general/architecture.md
Async multi-step workflow?             → patterns/general/software.md (Saga)
Audit trail or event replay?           → patterns/general/software.md (Event Sourcing + Outbox)
Decoupled integrations?                → patterns/general/messaging.md
Synchronous API design?                → patterns/general/communication.md (REST/gRPC)
Real-time bidirectional comms?         → patterns/general/communication.md (WebSocket)
Heavy concurrent workload?             → patterns/*/concurrency.md (lang-specific)
Wiring dependencies?                   → patterns/*/code.md (lang-specific)
Writing tests?                         → patterns/*/testing.md (lang-specific)
```

## General Patterns (All Languages)

| Pattern | Description |
|---------|-------------|
| [Architecture](./general/architecture.md) | DDD, Hexagonal Architecture, Repository Pattern |
| [Software](./general/software.md) | Saga, Event Sourcing, Outbox, Event-Driven |
| [Communication](./general/communication.md) | REST, gRPC, WebSocket |
| [Messaging](./general/messaging.md) | SNS+SQS, Kafka, RabbitMQ, NATS, Redis Pub/Sub |
| [Concurrency](./general/concurrency.md) | Worker Pool, Semaphore, Pipeline, WaitGroup concepts |
| [Code](./general/code.md) | Dependency Injection, IoC, Service Configuration, Interface Segregation |
| [Testing](./general/testing.md) | Test structure, mocking strategy, contract testing |

## Go Patterns

| Pattern | Description |
|---------|-------------|
| [Concurrency](./go/concurrency.md) | goroutines, channels, errgroup, semaphore, worker pool, pipeline |
| [Code](./go/code.md) | Constructor injection, functional options, provider pattern, service config |
| [Testing](./go/testing.md) | testify, mockery, t.Parallel, test wrappers, handler tests |

## Python Patterns

| Pattern | Description |
|---------|-------------|
| [Concurrency](./python/concurrency.md) | asyncio, TaskGroup, Semaphore, Queue, thread pool |
| [Code](./python/code.md) | Protocol interfaces, Pydantic, DI, Result type |
| [Testing](./python/testing.md) | pytest, fixtures, parametrize, AsyncMock, factories |

## TypeScript Patterns

| Pattern | Description |
|---------|-------------|
| [Concurrency](./typescript/concurrency.md) | Promise patterns, AbortController, async generators, rate limiting |
| [Code](./typescript/code.md) | Discriminated unions, branded types, Result type, zod, DI |
| [Testing](./typescript/testing.md) | vitest, spies, factories, integration tests, snapshot testing |

## Rust Patterns

| Pattern | Description |
|---------|-------------|
| [Concurrency](./rust/concurrency.md) | Tokio tasks, JoinSet, Semaphore, worker pool, SQS consumer |
| [Code](./rust/code.md) | Builder pattern, DI with Arc<dyn Trait>, newtype, error mapping |
| [Testing](./rust/testing.md) | mockall, testcontainers, Tokio test utilities |

## Elixir Patterns

| Pattern | Description |
|---------|-------------|
| [Concurrency](./elixir/concurrency.md) | Task, async_stream, GenServer pool, Broadway, supervision |
| [Code](./elixir/code.md) | Behaviours, DI via config, domain structs, with chains, Broadway |
| [Testing](./elixir/testing.md) | ExUnit, Mox, ExMachina, async tests, Ecto sandbox |

## Node.js Patterns

| Pattern | Description |
|---------|-------------|
| [Concurrency](./nodejs/concurrency.md) | Promise patterns, Semaphore, worker threads, streams, SQS consumer |
| [Code](./nodejs/code.md) | Constructor injection, domain classes, ESM module pattern, Lambda handler |
| [Testing](./nodejs/testing.md) | Jest / Node test runner, mocks, testcontainers, Lambda tests |

## Nix Patterns

| Pattern | Description |
|---------|-------------|
| [Code](./nix/code.md) | flake-parts modules, overlays, home-manager modules, listDirModules |

## PKL Patterns

| Pattern | Description |
|---------|-------------|
| [Code](./pkl/code.md) | Schema composition, amending chains, environment variables, output formats |
