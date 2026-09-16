# TypeScript Testing Guide

> Comprehensive guide: vitest setup, unit tests, integration tests, and coverage in TypeScript.

---

## Setup

```nix
packages = with pkgs; [ nodejs_22 pnpm go-task ];
```

```bash
pnpm add -D vitest @vitest/coverage-v8 testcontainers @aws-sdk/client-dynamodb
```

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      thresholds: { lines: 80, functions: 80, branches: 75 },
      exclude: ["**/tests/**", "**/*.d.ts", "**/dist/**"],
    },
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
})
```

```bash
# Run all tests
vitest run

# Watch mode
vitest

# Run specific test file
vitest run tests/unit/order-service.test.ts

# Run with coverage
vitest run --coverage

# Run matching pattern
vitest run -t "place order"
```

---

## Unit Tests

### File Organization

```
src/
└── order/
    ├── service.ts
    └── service.test.ts     # co-located with source (preferred)
tests/
├── factories.ts            # shared test data builders
├── unit/                   # or keep co-located in src/
└── integration/
```

### Test Structure

```typescript
// src/order/service.test.ts
import { describe, it, expect, vi, beforeEach, type MockedObject } from "vitest"
import { OrderService } from "./service"
import type { OrderRepository, EventPublisher } from "./ports"
import { makeOrder, makePlaceOrderCmd } from "../../tests/factories"
import { OrderNotFoundError } from "./errors"

describe("OrderService", () => {
  let mockRepo: MockedObject<OrderRepository>
  let mockPublisher: MockedObject<EventPublisher>
  let service: OrderService

  beforeEach(() => {
    mockRepo = {
      save:           vi.fn().mockResolvedValue(undefined),
      findById:       vi.fn().mockResolvedValue(null),
      findByCustomer: vi.fn().mockResolvedValue([]),
    }
    mockPublisher = {
      publish: vi.fn().mockResolvedValue(undefined),
    }
    service = new OrderService(mockRepo, mockPublisher)
  })

  describe("place", () => {
    it("saves order to repository", async () => {
      const cmd = makePlaceOrderCmd()
      await service.place(cmd)
      expect(mockRepo.save).toHaveBeenCalledOnce()
      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: cmd.customerId, status: "placed" })
      )
    })

    it("publishes OrderPlaced event", async () => {
      const cmd = makePlaceOrderCmd()
      const order = await service.place(cmd)

      expect(mockPublisher.publish).toHaveBeenCalledOnce()
      expect(mockPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: "OrderPlaced", orderId: order.id })
      )
    })

    it("throws ValidationError when items is empty", async () => {
      const cmd = makePlaceOrderCmd({ items: [] })
      await expect(service.place(cmd)).rejects.toThrow("items must not be empty")
    })

    it("propagates repository error", async () => {
      mockRepo.save.mockRejectedValueOnce(new Error("DynamoDB unavailable"))
      await expect(service.place(makePlaceOrderCmd())).rejects.toThrow("DynamoDB unavailable")
      expect(mockPublisher.publish).not.toHaveBeenCalled()
    })
  })

  describe("get", () => {
    it("returns order when found", async () => {
      const order = makeOrder()
      mockRepo.findById.mockResolvedValueOnce(order)

      const result = await service.get(order.id)
      expect(result).toEqual(order)
    })

    it("throws OrderNotFoundError when not found", async () => {
      mockRepo.findById.mockResolvedValueOnce(null)
      await expect(service.get("missing-id" as OrderID)).rejects.toThrow(OrderNotFoundError)
    })
  })
})
```

---

## Factories

```typescript
// tests/factories.ts
import { randomUUID } from "node:crypto"
import type { Order, OrderItem, PlaceOrderCmd, OrderID, CustomerID } from "../src/order/models"

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

## Integration Tests

### DynamoDB via testcontainers

```typescript
// tests/integration/dynamo-order-repository.test.ts
import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from "vitest"
import { GenericContainer, StartedTestContainer, Wait } from "testcontainers"
import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
} from "@aws-sdk/client-dynamodb"
import { DynamoOrderRepository } from "../../src/adapters/dynamo-order-repository"
import { makeOrder } from "../factories"

let container: StartedTestContainer
let dynamoClient: DynamoDBClient
const TABLE = "orders-test"

beforeAll(async () => {
  container = await new GenericContainer("localstack/localstack:latest")
    .withEnvironment({ SERVICES: "dynamodb" })
    .withExposedPorts(4566)
    .withWaitStrategy(Wait.forLogMessage("Ready."))
    .start()

  dynamoClient = new DynamoDBClient({
    endpoint:    `http://localhost:${container.getMappedPort(4566)}`,
    region:      "us-east-2",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  })
}, 60_000)

afterAll(async () => {
  await container.stop()
})

beforeEach(async () => {
  await dynamoClient.send(new CreateTableCommand({
    TableName:            TABLE,
    BillingMode:          "PAY_PER_REQUEST",
    AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }],
    KeySchema:            [{ AttributeName: "pk", KeyType: "HASH" }],
  }))
})

afterEach(async () => {
  await dynamoClient.send(new DeleteTableCommand({ TableName: TABLE }))
})

describe("DynamoOrderRepository", () => {
  it("saves and retrieves an order by id", async () => {
    const repo  = new DynamoOrderRepository(dynamoClient, TABLE)
    const order = makeOrder()

    await repo.save(order)
    const found = await repo.findById(order.id)

    expect(found).not.toBeNull()
    expect(found!.customerId).toBe(order.customerId)
    expect(found!.status).toEqual(order.status)
  })

  it("returns null for non-existent order", async () => {
    const repo  = new DynamoOrderRepository(dynamoClient, TABLE)
    const found = await repo.findById("nonexistent" as OrderID)
    expect(found).toBeNull()
  })

  it("finds pending orders only", async () => {
    const repo    = new DynamoOrderRepository(dynamoClient, TABLE)
    const placed  = makeOrder({ status: { kind: "placed", placedAt: new Date() } })
    const shipped = makeOrder({ status: { kind: "shipped", shippedAt: new Date(), trackingNumber: "TRK-1" } })

    await Promise.all([repo.save(placed), repo.save(shipped)])

    const pending = await repo.findPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].id).toBe(placed.id)
  })
})
```

---

## Lambda Handler Tests

```typescript
// tests/integration/create-order-handler.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { APIGatewayProxyEventV2 } from "aws-lambda"
import { handler } from "../../src/cmd/http/create-order"

describe("createOrderHandler", () => {
  beforeEach(() => {
    // Reset module-level mocks between tests
    vi.restoreAllMocks()
  })

  it("returns 201 with order id on success", async () => {
    const event = makeApiGwEvent({
      body: JSON.stringify({ customerId: "cust-1", items: [{ sku: "sku-1", quantity: 1 }] }),
    })

    const result = await handler(event, mockContext())
    const body = JSON.parse(result.body)

    expect(result.statusCode).toBe(201)
    expect(body.data.id).toBeDefined()
  })

  it("returns 422 for missing customerId", async () => {
    const event = makeApiGwEvent({
      body: JSON.stringify({ items: [{ sku: "sku-1", quantity: 1 }] }),
    })

    const result = await handler(event, mockContext())
    expect(result.statusCode).toBe(422)
  })
})

function makeApiGwEvent(overrides: Partial<APIGatewayProxyEventV2>): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "POST /v1/orders",
    rawPath: "/v1/orders",
    rawQueryString: "",
    headers: { "content-type": "application/json" },
    requestContext: {} as never,
    isBase64Encoded: false,
    ...overrides,
  }
}

function mockContext() {
  return {
    getRemainingTimeInMillis: () => 30_000,
    functionName: "create-order",
    invokedFunctionArn: "arn:aws:lambda:us-east-2:000:function:create-order",
  } as never
}
```

---

## Coverage

```bash
# Run with coverage
vitest run --coverage

# View HTML report
open coverage/index.html

# Fail on threshold (configured in vitest.config.ts thresholds)
# vitest exits non-zero if thresholds not met
```

---

## Cross-References

→ [TypeScript Testing Patterns](../../patterns/typescript/testing.md) | [General Strategies](../general/strategies.md) | [TypeScript Conventions](../../conventions/typescript/index.md)
