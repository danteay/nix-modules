# Testing Strategies (General)

> All test types, when to use them, coverage targets, and language-agnostic rules.

---

## Test Pyramid

```
         ┌─────────────────┐
         │   E2E / Smoke   │  5–10%  — full system, post-deploy
         ├─────────────────┤
         │  Contract Tests  │  10%   — service boundary validation
         ├─────────────────┤
         │   Integration   │  25–30% — component + real infrastructure
         ├─────────────────┤
         │   Unit Tests    │  50–60% — isolated functions
         └─────────────────┘
```

---

## Unit Tests

**What:** One function or method in isolation with all dependencies mocked.

**When:** Every business logic function in service, usecase, and domain layers.

**Coverage target:** 80%+ on service and usecase layers.

**Characteristics:**
- No I/O (no DB, no network)
- Fast (milliseconds per test)
- Deterministic

**Language guides:**
- [Go Unit Tests](../go/guide.md#unit-tests)
- [Python Unit Tests](../python/guide.md#unit-tests)
- [TypeScript Unit Tests](../typescript/guide.md#unit-tests)

---

## Integration Tests

**What:** A component interacting with real infrastructure (database, cache, queue).

**When:** Repository layer, cache clients, external HTTP adapters.

**Coverage target:** All repository methods and their edge cases.

**Characteristics:**
- Uses real infrastructure via testcontainers or LocalStack
- Slower (seconds per test)
- Each test creates its own isolated data

**Language guides:**
- [Go Integration Tests](../go/guide.md#integration-tests)
- [Python Integration Tests](../python/guide.md#integration-tests)
- [TypeScript Integration Tests](../typescript/guide.md#integration-tests)

---

## End-to-End (E2E) Tests

**What:** Full system flow via real entry points (HTTP, SQS). No mocking.

**When:** Critical business flows (checkout, onboarding, payment processing).

**Coverage target:** 3–5 critical flows per service.

**Characteristics:**
- Runs against deployed environment (dev/staging) or full local stack
- Slow (seconds to minutes)
- Tests entire integration chain

---

## Smoke Tests

**What:** Minimal post-deploy health checks.

**When to run:** Immediately after every deployment to any environment.

**Coverage target:** 1 test per major entry point (health, main flow).

**Characteristics:**
- Very fast (< 5 seconds total)
- Read-only or uses known test data
- No business logic assertions — just "is it up and reachable?"

```
GET /health → 200
GET /v1/orders?limit=1 → not 500
```

---

## Contract Tests

**What:** Verify a service's API or event schema matches consumer expectations.

**When:** Any service with API consumers or event subscribers.

**Tools:** Pact (REST), Buf (gRPC/Protobuf), JSON Schema validation (events).

**Two sides:**

```
Consumer → defines expected response shapes
Provider → verifies its responses satisfy all consumer contracts
```

---

## Coverage Targets by Layer

| Layer | Target | Method |
|-------|--------|--------|
| Domain models | 100% | Unit |
| Service | 85%+ | Unit |
| UseCase | 80%+ | Unit |
| Repository | 70%+ | Integration |
| Handler | 60%+ | Handler/E2E |
| Config / wiring | excluded | — |

---

## Coverage Commands

```bash
# Go
go test ./... -coverprofile=coverage.out
go tool cover -func=coverage.out | grep total

# Python
pytest --cov=src --cov-report=html --cov-fail-under=80

# TypeScript (vitest)
vitest run --coverage
```

---

## Rules (All Languages)

- Tests are first-class code — maintain them like production code
- Never use `time.sleep` / `sleep()` — use retry with timeout
- Tests must be deterministic and order-independent
- Each test creates its own data and cleans up after itself
- Use meaningful names that describe the scenario, not just the function
- Test the **behaviour**, not the implementation

---

## Language-Specific Guides

| Language | Guide |
|----------|-------|
| Go | [Go Testing Guide](../go/guide.md) |
| Python | [Python Testing Guide](../python/guide.md) |
| TypeScript | [TypeScript Testing Guide](../typescript/guide.md) |
| Rust | [Rust Testing Guide](../rust/guide.md) |
| Elixir | [Elixir Testing Guide](../elixir/guide.md) |
| Node.js | [Node.js Testing Guide](../nodejs/guide.md) |
| Nix | [Nix Testing Guide](../nix/guide.md) |
| PKL | [PKL Testing Guide](../pkl/guide.md) |

---

## Cross-References

→ [Testing Patterns](../../patterns/general/testing.md) | [Mock Generation](../../guides/mock-generation.md) | [Common Pitfalls](../../conventions/general/common-pitfalls.md)
