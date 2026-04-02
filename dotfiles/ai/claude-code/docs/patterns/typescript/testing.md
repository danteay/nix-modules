# TypeScript Testing Patterns

> vitest, mocking, integration testing, and snapshot testing in TypeScript.

---

## Test Naming Convention

```
describe("OrderService", () => {
  describe("place", () => {
    it("creates and saves order when input is valid")
    it("publishes OrderPlaced event after successful save")
    it("throws OrderNotFoundError when customer does not exist")
    it("throws ValidationError when items list is empty")
  })
})
```

---

## Unit Test (vitest)

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { MockedObject } from "vitest"

describe("OrderService", () => {
  let mockRepo: MockedObject<OrderRepository>
  let mockPublisher: MockedObject<EventPublisher>
  let service: OrderService

  beforeEach(() => {
    mockRepo = {
      save:           vi.fn().mockResolvedValue(undefined),
      findById:       vi.fn(),
      findByCustomer: vi.fn(),
    }
    mockPublisher = {
      publish: vi.fn().mockResolvedValue(undefined),
    }
    service = new OrderService(mockRepo, mockPublisher)
  })

  it("creates order and saves to repository", async () => {
    const cmd: PlaceOrderCmd = {
      customerId: "cust-123",
      items: [{ sku: "sku-1", quantity: 2 }],
    }

    const order = await service.place(cmd)

    expect(order.customerId).toBe("cust-123")
    expect(order.status).toBe("placed")
    expect(mockRepo.save).toHaveBeenCalledOnce()
    expect(mockRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cust-123" })
    )
  })

  it("publishes OrderPlaced event", async () => {
    await service.place(validCmd())

    expect(mockPublisher.publish).toHaveBeenCalledOnce()
    expect(mockPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "OrderPlaced" })
    )
  })

  it("throws when repository save fails", async () => {
    mockRepo.save.mockRejectedValueOnce(new Error("DynamoDB unavailable"))

    await expect(service.place(validCmd())).rejects.toThrow("DynamoDB unavailable")
  })
})
```

---

## Spy vs Mock vs Stub

```typescript
// Spy — wraps real implementation, tracks calls
const spy = vi.spyOn(orderService, "place")
await orderService.place(cmd)
expect(spy).toHaveBeenCalledOnce()

// Mock — replace implementation entirely
const mockFn = vi.fn().mockResolvedValue(order)

// Stub — return fixed value
mockRepo.findById.mockResolvedValue(order)  // always returns order

// Return different values on successive calls
mockRepo.findById
  .mockResolvedValueOnce(order)    // first call
  .mockResolvedValueOnce(null)     // second call
  .mockRejectedValueOnce(new Error("DB error"))  // third call throws
```

---

## Factory Functions (Test Data)

```typescript
// tests/factories.ts
import { randomUUID } from "node:crypto"

export function makeOrderItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    sku: "sku-test-001",
    quantity: 1,
    ...overrides,
  }
}

export function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id:         randomUUID() as OrderID,
    customerId: "cust-test" as CustomerID,
    items:      [makeOrderItem()],
    status:     { kind: "placed", placedAt: new Date() },
    createdAt:  new Date(),
    ...overrides,
  }
}

export function makePlaceOrderCmd(overrides: Partial<PlaceOrderCmd> = {}): PlaceOrderCmd {
  return {
    customerId: "cust-test" as CustomerID,
    items:      [makeOrderItem()],
    ...overrides,
  }
}
```

---

## Integration Test with testcontainers

```typescript
// tests/integration/order-repository.test.ts
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest"
import {
  GenericContainer,
  StartedTestContainer,
  Wait,
} from "testcontainers"
import { DynamoDBClient, CreateTableCommand } from "@aws-sdk/client-dynamodb"

let container: StartedTestContainer
let dynamoClient: DynamoDBClient

beforeAll(async () => {
  container = await new GenericContainer("localstack/localstack:latest")
    .withEnvironment({ SERVICES: "dynamodb" })
    .withExposedPorts(4566)
    .withWaitStrategy(Wait.forLogMessage("Ready."))
    .start()

  const endpoint = `http://localhost:${container.getMappedPort(4566)}`
  dynamoClient = new DynamoDBClient({
    endpoint,
    region: "us-east-2",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  })
})

afterAll(async () => {
  await container.stop()
})

beforeEach(async () => {
  // Create fresh table for each test
  await dynamoClient.send(new CreateTableCommand({
    TableName: "orders-test",
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
  }))
})

describe("DynamoOrderRepository", () => {
  it("saves and retrieves an order", async () => {
    const repo = new DynamoOrderRepository(dynamoClient, "orders-test")
    const order = makeOrder()

    await repo.save(order)
    const found = await repo.findById(order.id)

    expect(found).not.toBeNull()
    expect(found!.customerId).toBe(order.customerId)
  })

  it("returns null for non-existent order", async () => {
    const repo = new DynamoOrderRepository(dynamoClient, "orders-test")
    const found = await repo.findById("nonexistent-id" as OrderID)
    expect(found).toBeNull()
  })
})
```

---

## Snapshot Testing

Use sparingly — mainly for complex serialised output, not business logic:

```typescript
it("serialises order to DynamoDB record format", () => {
  const order = makeOrder({
    id: "ord-fixed-id" as OrderID,
    customerId: "cust-fixed" as CustomerID,
    createdAt: new Date("2024-01-01T00:00:00Z"),
  })

  const record = toDynamoRecord(order)

  expect(record).toMatchInlineSnapshot(`
    {
      "pk": { "S": "order#ord-fixed-id" },
      "customer_id": { "S": "cust-fixed" },
      "status": { "S": "placed" },
      "created_at": { "S": "2024-01-01T00:00:00.000Z" },
    }
  `)
})
```

---

## Vitest Configuration

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
      },
      exclude: ["**/mocks/**", "**/tests/**", "**/*.d.ts"],
    },
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 30_000,  // longer for integration tests
  },
})
```

---

## Cross-References

→ [General Testing Patterns](../general/testing.md) | [TypeScript Testing Guide](../../testing/typescript/guide.md) | [Mock Generation](../../guides/mock-generation.md) | [TypeScript Conventions](../../conventions/typescript/index.md)
