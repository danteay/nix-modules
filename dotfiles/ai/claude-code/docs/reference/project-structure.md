# Project Structure

> Standard project layouts per language. Each structure enforces the same architectural components adapted to language idioms.

## Guiding Principle

Every service, regardless of language, exposes the same structural components:

| Component | Purpose |
|-----------|---------|
| **cmd / handlers** | Entry points — Lambda handlers, HTTP servers, event consumers. Wiring only, no business logic. |
| **ports** | Interface definitions for hexagonal architecture (adapters boundary). _Go exception: interfaces are defined inline by consumers._ |
| **domain/models** | Aggregates, entities, value objects. Pure domain logic, no I/O. |
| **domain/errors** | Typed domain exception hierarchy. |
| **repositories** | Port implementations for data access (DynamoDB, Postgres, etc.). |
| **services** | Domain services — business logic that spans multiple aggregates. |
| **usecases** | Orchestration layer — coordinates services, repositories, and events. |
| **pkg / libs** | Shared internal modules: OpenTelemetry, structured logging, AWS SDK wrappers. |
| **tests** | Unit and integration tests co-located with source (language-dependent). |
| **qa/** | Cross-cutting tests: integration, E2E, contract, smoke, load. |
| **config/** | PKL schemas + Serverless Framework partials. |
| **secrets/** | ejson-encrypted secret files only. Never plaintext. |
| **nix/** | Dev shell derivations and build packages. |
| **taskfiles/** | Segregated Taskfile partials (`build.yml`, `test.yml`, `deploy.yml`). |

> Domain components (`models`, `errors`, `repositories`, `services`, `usecases`) can be either **per-service** (microservice) or **shared across services** (monorepo shared domain). Use whichever fits the project scope.

---

## Go Service Layout

Go does not use an explicit `ports/` directory. Interfaces are defined in the package that _consumes_ them (Go's implicit interface idiom).

```
{service}/
├── cmd/
│   ├── http/
│   │   └── {endpoint}/
│   │       ├── main.go            # Lambda/HTTP entry — wire deps here only
│   │       ├── handler.go         # HTTP handler func
│   │       └── lambda-config.yml  # per-function Lambda settings
│   └── <event-type>/
│       └── {event}/
│           ├── main.go
│           ├── handler.go
│           └── lambda-config.yml
├── internal/
│   └── {domain}/                  # one dir per bounded context
│       ├── domain/
│       │   ├── models.go          # aggregates, entities, value objects
│       │   └── errors.go          # sentinel errors + domain error types
│       ├── repository/            # data-access implementations (DynamoDB, RDS, etc.)
│       │   └── dynamodb.go
│       ├── service/               # domain services (business logic)
│       │   └── {service}.go
│       └── usecase/               # use case orchestration (optional per domain)
│           └── {usecase}.go
├── pkg/                           # shared internal packages
│   ├── otel/                      # OpenTelemetry tracer setup
│   ├── logger/                    # slog / structured logging config
│   ├── awsclient/                 # shared AWS SDK client factories
│   └── testutil/                  # shared test helpers and fixtures
├── qa/
│   ├── integration/               # real infrastructure tests (LocalStack)
│   ├── e2e/                       # end-to-end API tests
│   ├── contract/                  # Pact / consumer-driven contract tests
│   ├── smoke/                     # post-deploy smoke tests
│   └── load/                      # k6 / artillery load tests
├── config/
│   ├── pkl/
│   │   ├── PklProject
│   │   ├── main.pkl               # base config schema
│   │   ├── dev.pkl
│   │   ├── staging.pkl
│   │   └── prod.pkl
│   └── sls/
│       ├── iam.yml                # IAM role definitions
│       └── resources.yml          # CloudFormation resources
├── secrets/
│   ├── dev.ejson
│   └── prod.ejson
├── nix/
│   ├── packages.nix               # build derivation
│   └── dev-shell.nix              # dev shell inputs
├── taskfiles/
│   ├── build.yml
│   ├── test.yml
│   ├── lint.yml
│   └── deploy.yml
├── flake.nix
├── serverless.yml
├── go.mod
├── go.sum
└── Taskfile.yml
```

---

## Python Service Layout

```
{service}/
├── cmd/
│   ├── http/
│   │   └── {endpoint}.py          # Lambda HTTP handler entry point
│   └── <event-type>/
│       └── {event}_consumer.py    # Lambda event consumer entry point
├── src/
│   └── {package}/
│       ├── domain/
│       │   ├── models.py          # Pydantic models, aggregates, value objects
│       │   ├── errors.py          # domain exception hierarchy
│       │   └── ports/             # port (interface) definitions — hexagonal boundary
│       │       ├── repositories.py  # Protocol classes for data access
│       │       └── services.py      # Protocol classes for external services
│       ├── repositories/          # port implementations (DynamoDB, RDS adapters)
│       │   └── dynamodb.py
│       ├── services/              # domain services (business logic)
│       │   └── {service}.py
│       └── usecases/              # use case orchestration
│           └── {usecase}.py
├── libs/                          # shared internal modules
│   ├── otel/                      # OpenTelemetry setup (tracer, meter)
│   ├── logger/                    # structlog configuration
│   └── awsclient/                 # shared boto3 / aiobotocore client factories
├── tests/                         # unit tests (pytest)
│   ├── conftest.py
│   └── unit/
│       └── {domain}/
├── qa/
│   ├── integration/               # real infrastructure (LocalStack / testcontainers)
│   ├── e2e/
│   ├── contract/
│   ├── smoke/
│   └── load/
├── config/
│   ├── pkl/
│   │   ├── PklProject
│   │   ├── main.pkl
│   │   ├── dev.pkl
│   │   └── prod.pkl
│   └── sls/
│       ├── iam.yml
│       └── resources.yml
├── secrets/
│   ├── dev.ejson
│   └── prod.ejson
├── nix/
│   ├── packages.nix
│   └── dev-shell.nix
├── taskfiles/
│   ├── build.yml
│   ├── test.yml
│   ├── lint.yml
│   └── deploy.yml
├── flake.nix
├── serverless.yml
├── pyproject.toml
└── Taskfile.yml
```

---

## TypeScript / Node.js Service Layout

```
{service}/
├── cmd/
│   ├── http/
│   │   └── {endpoint}/
│   │       ├── index.ts           # Lambda / HTTP server entry point
│   │       └── lambda-config.yml
│   └── events/
│       └── {event}-consumer/
│           ├── index.ts
│           └── lambda-config.yml
├── src/
│   ├── domain/
│   │   ├── models.ts              # types, interfaces, value objects, aggregates
│   │   ├── errors.ts              # domain exception classes
│   │   └── ports/                 # port (interface) definitions — hexagonal boundary
│   │       ├── repositories.ts    # repository interface contracts
│   │       ├── services.ts        # external service interface contracts
│   │       └── usecases.ts        # use case interface contracts (optional)
│   ├── repositories/              # port implementations (DynamoDB, RDS adapters)
│   │   └── dynamodb/
│   │       └── {entity}Repo.ts
│   ├── services/                  # domain services (business logic)
│   │   └── {service}.ts
│   └── usecases/                  # use case orchestration
│       └── {usecase}.ts
├── libs/                          # shared internal modules
│   ├── otel/                      # OpenTelemetry setup
│   ├── logger/                    # pino configuration
│   └── awsclient/                 # shared AWS SDK v3 client factories
├── tests/                         # unit tests (vitest)
│   └── unit/
│       └── {domain}/
├── qa/
│   ├── integration/               # testcontainers / LocalStack
│   ├── e2e/
│   ├── contract/
│   ├── smoke/
│   └── load/
├── config/
│   ├── pkl/
│   │   ├── PklProject
│   │   ├── main.pkl
│   │   ├── dev.pkl
│   │   └── prod.pkl
│   └── sls/
│       ├── iam.yml
│       └── resources.yml
├── secrets/
│   ├── dev.ejson
│   └── prod.ejson
├── nix/
│   ├── packages.nix
│   └── dev-shell.nix
├── taskfiles/
│   ├── build.yml
│   ├── test.yml
│   ├── lint.yml
│   └── deploy.yml
├── flake.nix
├── serverless.yml
├── tsconfig.json
├── package.json
└── Taskfile.yml
```

---

## Elixir / OTP Service Layout

Entry points in Elixir are modules, not filesystem binaries. Lambda entry points use `aws_ex_ray` / `lambda_ex` or a custom Erlang runtime. The OTP application itself starts via `application.ex`.

```
{service}/
├── lib/
│   └── {app}/
│       ├── application.ex         # OTP Application — supervision tree root
│       ├── domain/
│       │   ├── {entity}.ex        # domain structs, aggregates, business rules
│       │   └── errors.ex          # exception modules and tagged-tuple error types
│       ├── ports/                 # behaviour definitions — hexagonal boundary
│       │   ├── order_repository.ex  # @callback specs for data access
│       │   └── event_publisher.ex   # @callback specs for event publishing
│       ├── adapters/              # port implementations
│       │   ├── dynamodb/
│       │   │   └── order_repo.ex  # @behaviour OrderRepository
│       │   └── sns/
│       │       └── publisher.ex   # @behaviour EventPublisher
│       ├── services/              # domain services (business logic)
│       │   └── {service}.ex
│       ├── usecases/              # use case orchestration
│       │   └── {usecase}.ex
│       ├── handlers/              # entry points: Phoenix controllers
│       │   ├── http/
│       │   │   └── {endpoint}_handler.ex
│       │   └── events/
│       │       └── {event}_consumer.ex   # Broadway pipeline or GenServer consumer
│       └── workers/               # GenServer workers, scheduled jobs
│           └── {worker}.ex
├── libs/                          # shared internal modules (separate Mix dependencies)
│   ├── otel/                      # OpenTelemetry setup (opentelemetry_api)
│   ├── logger/                    # Logger JSON backend config
│   └── awsclient/                 # shared ExAws config and client helpers
├── test/
│   ├── support/
│   │   ├── mocks.ex               # Mox.defmock declarations
│   │   ├── factories.ex           # ExMachina factory definitions
│   │   └── data_case.ex           # Ecto sandbox helper (if applicable)
│   └── unit/
│       └── {domain}/
├── qa/
│   ├── integration/               # LocalStack / real infra tests
│   ├── e2e/
│   ├── contract/
│   ├── smoke/
│   └── load/
├── config/
│   ├── pkl/
│   │   ├── PklProject
│   │   ├── main.pkl
│   │   ├── dev.pkl
│   │   └── prod.pkl
│   ├── sls/
│   │   ├── iam.yml
│   │   └── resources.yml
│   ├── config.exs                 # compile-time config
│   ├── dev.exs
│   ├── prod.exs
│   └── runtime.exs                # runtime env var config (read("env:..."))
├── secrets/
│   ├── dev.ejson
│   └── prod.ejson
├── nix/
│   ├── packages.nix
│   └── dev-shell.nix
├── taskfiles/
│   ├── build.yml
│   ├── test.yml
│   ├── lint.yml
│   └── deploy.yml
├── flake.nix
├── mix.exs
├── mix.lock
└── Taskfile.yml
```

---

## Rust Service Layout

Lambda entry points use `src/bin/` — each binary becomes a separate Lambda function. For multiple services in a workspace, each service is a workspace member crate.

```
{service}/
├── src/
│   ├── lib.rs                     # crate root — re-exports public modules
│   ├── config.rs                  # Config struct (serde + envy from env vars)
│   ├── errors.rs                  # top-level AppError (thiserror)
│   ├── bin/                       # Lambda / binary entry points
│   │   ├── http_{endpoint}.rs     # Lambda HTTP handler binary
│   │   └── {event}_consumer.rs    # Lambda event consumer binary
│   ├── domain/
│   │   ├── mod.rs
│   │   ├── {entity}.rs            # aggregate, value objects, domain logic
│   │   └── errors.rs              # domain error types (thiserror)
│   ├── ports/                     # trait definitions — hexagonal boundary
│   │   ├── mod.rs
│   │   ├── repository.rs          # OrderRepository trait (async_trait)
│   │   └── publisher.rs           # EventPublisher trait
│   ├── adapters/                  # port implementations
│   │   ├── mod.rs
│   │   ├── dynamodb/
│   │   │   ├── mod.rs
│   │   │   └── order_repo.rs      # impl OrderRepository for DynamoDbOrderRepo
│   │   └── sns/
│   │       └── publisher.rs
│   ├── use_cases/
│   │   ├── mod.rs
│   │   └── {usecase}.rs
│   └── handlers/                  # Axum routes or Lambda handler functions
│       ├── mod.rs
│       └── {handler}.rs
├── libs/                          # shared workspace member crates
│   ├── otel/                      # tracing-subscriber + OpenTelemetry setup
│   │   ├── Cargo.toml
│   │   └── src/lib.rs
│   ├── logger/                    # tracing JSON formatter config
│   │   ├── Cargo.toml
│   │   └── src/lib.rs
│   └── awsclient/                 # shared AWS SDK config and client builders
│       ├── Cargo.toml
│       └── src/lib.rs
├── tests/                         # integration tests (Rust `tests/` convention)
│   ├── common/
│   │   ├── mod.rs                 # shared test setup helpers
│   │   └── factories.rs           # test data builders
│   └── {domain}_test.rs
├── qa/
│   ├── integration/               # testcontainers + LocalStack
│   ├── e2e/
│   ├── contract/
│   ├── smoke/
│   └── load/
├── config/
│   ├── pkl/
│   │   ├── PklProject
│   │   ├── main.pkl
│   │   ├── dev.pkl
│   │   └── prod.pkl
│   └── sls/
│       ├── iam.yml
│       └── resources.yml
├── secrets/
│   ├── dev.ejson
│   └── prod.ejson
├── nix/
│   ├── packages.nix
│   └── dev-shell.nix
├── taskfiles/
│   ├── build.yml
│   ├── test.yml
│   ├── lint.yml
│   └── deploy.yml
├── flake.nix
├── serverless.yml
├── Cargo.toml                     # workspace root or single crate manifest
├── Cargo.lock
└── Taskfile.yml
```

---

## Rules

- **cmd / bin / handlers** — entry points only. Wire dependencies and call use cases. Zero business logic.
- **ports/** — interface/behaviour/trait definitions owned by the domain, not the adapter. _Go exception: interfaces are implicitly defined by consumers._
- **repositories/** — always implement a port. Never called directly from handlers.
- **pkg / libs/** — cross-cutting concerns (observability, logging, AWS clients) shared across domains within the service.
- **qa/** — cross-cutting quality tests that require real or near-real infrastructure. Separate from unit `tests/`.
- **config/pkl/** — all service config defined as PKL schemas; rendered to JSON/YAML at deploy time.
- **secrets/** — only ejson-encrypted files. Plaintext credentials are never committed.
- **nix/** — dev shell and build derivations. `flake.nix` at root is always present.
- **taskfiles/** — split large Taskfiles into segregated partials (`build.yml`, `test.yml`, `lint.yml`, `deploy.yml`) included from root `Taskfile.yml`.

---

## Cross-References

→ [Architecture Overview](./architecture-overview.md) | [Configuration](./configuration.md) | [PKL Configuration](./pkl-configuration.md) | [Dev Environment](../guides/dev-environment.md)
