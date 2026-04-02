# Testing Patterns (General)

> Test structure, mocking strategy, and organization — language-agnostic.

---

## Test Hierarchy

```
         ┌─────────────────┐
         │   E2E / Smoke   │  few tests — full system validation
         ├─────────────────┤
         │  Contract Tests  │  service boundary validation
         ├─────────────────┤
         │   Integration   │  component + real infrastructure
         ├─────────────────┤
         │   Unit Tests    │  isolated functions (majority)
         └─────────────────┘
```

Each layer tests a different concern. They are **complementary**, not redundant.

---

## Unit Test Structure

**Arrange → Act → Assert (AAA)**

```
1. Arrange — set up the object under test, create mocks, set expectations
2. Act     — call the function/method being tested
3. Assert  — verify outcome and mock interactions
```

### Rules

- One test per scenario (not one test per function)
- Test names describe the scenario: `when_customer_not_found_raises_error`
- Set mock expectations **before** the call under test
- Verify mock expectations **after** the call
- Each test is fully self-contained — no shared mutable state

---

## Mocking Strategy

Use the **ports** (interfaces) defined in the domain as the mock boundary.

```
Test ──► OrderService(mock_repo, mock_publisher)
                │                 │
           MockRepo          MockPublisher
        (implements          (implements
        OrderRepository)     EventPublisher)
```

**Rules:**
- Mock at the port boundary (interface), never at the implementation
- Mock only dependencies, not the unit under test
- Use real implementations in integration tests where practical

---

## Test Data Management

### Builders / Factories

```
# Create minimal valid objects with sensible defaults
order = OrderBuilder().with_status("placed").build()
order = OrderBuilder().with_items(3).with_discount(10).build()
```

### Fixtures / Seeders

```
# Integration tests: seed DB with known state
seed_orders(db, count=5, status="pending")
```

### Isolation

Each test creates its own data and cleans up after itself. No shared state between tests.

---

## Contract Testing

For services that communicate (REST, events, gRPC):

```
Consumer ──defines──► Contract (expectations about provider responses)
                            │
Provider ──verifies──► Contract (proves it satisfies consumer expectations)
```

**Tools:**
- REST/JSON: Pact
- gRPC/Protobuf: Buf
- Events: JSON Schema validation

---

## Test Organization

```
tests/
├── unit/          # Isolated, mocked, fast
├── integration/   # Real infra (containers), slower
├── e2e/           # Full system, deployed env
└── smoke/         # Post-deploy health checks
```

Or co-locate with source (preferred in Go):
```
service/order_service.go
service/order_service_test.go
```

---

## Language-Specific Guides

| Language | See |
|----------|-----|
| Go | [Go Testing Guide](../../testing/go/guide.md) + [Go Testing Patterns](../go/testing.md) |
| Python | [Python Testing Guide](../../testing/python/guide.md) + [Python Testing Patterns](../python/testing.md) |
| TypeScript | [TypeScript Testing Guide](../../testing/typescript/guide.md) + [TypeScript Testing Patterns](../typescript/testing.md) |

---

## Cross-References

→ [Testing Strategies](../../testing/general/strategies.md) | [Mock Generation](../../guides/mock-generation.md) | [Common Pitfalls](../../conventions/general/common-pitfalls.md)
