# Testing Guide (Node.js)

> Setup, unit tests, integration tests with testcontainers, Lambda handler tests, and coverage for Node.js projects.

---

## Setup

```bash
# pnpm (preferred)
pnpm add -D jest @jest/globals testcontainers

# Or using Node built-in (no extra deps, Node 20+)
# Use node --test
```

```json
// package.json
{
  "type": "module",
  "scripts": {
    "test": "node --experimental-vm-modules node_modules/.bin/jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:integration": "jest --testPathPattern=integration"
  },
  "engines": { "node": ">=20" }
}
```

---

## Test Commands

```bash
# All tests
pnpm test

# Watch mode
pnpm test -- --watch

# Coverage
pnpm test -- --coverage

# Single file
pnpm test -- placeOrder

# Integration tests only
pnpm test:integration

# Node built-in (no Jest)
node --test
node --test src/**/*.test.js
node --test --reporter=spec
```

---

## File Organization

```
src/
├── domain/
│   ├── order.js
│   └── __tests__/
│       └── order.test.js
├── useCases/
│   ├── placeOrder.js
│   └── __tests__/
│       └── placeOrder.test.js
└── adapters/
    └── dynamodb/
        └── orderRepo.js

test/
├── factories.js
├── helpers.js
└── integration/
    ├── orderRepo.test.js
    └── handler.test.js
```

---

## Unit Test Pattern (Jest)

```js
// src/domain/__tests__/order.test.js
import { describe, it, expect, beforeEach } from '@jest/globals';
import { Order } from '../order.js';

describe('Order', () => {
  describe('create()', () => {
    it('creates order with pending status and UUID id', () => {
      const order = Order.create({
        customerId: 'cust-1',
        items: [{ sku: 'SKU-1', quantity: 1, price: 1000 }],
      });

      expect(order.status).toBe('pending');
      expect(order.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('throws ValidationError when customerId missing', () => {
      expect(() => Order.create({ items: [] }))
        .toThrow(expect.objectContaining({ name: 'ValidationError' }));
    });
  });

  describe('place()', () => {
    it('transitions pending → placed', () => {
      const order = Order.create({ customerId: 'c', items: [{ sku: 'S', quantity: 1, price: 1 }] });
      const placed = order.place();

      expect(placed.status).toBe('placed');
    });

    it('throws InvalidTransitionError from non-pending status', () => {
      const placed = Order.create({ customerId: 'c', items: [{ sku: 'S', quantity: 1, price: 1 }] }).place();

      expect(() => placed.place())
        .toThrow(expect.objectContaining({ name: 'InvalidTransitionError' }));
    });
  });
});
```

---

## Use Case Test with Mocks

```js
// src/useCases/__tests__/placeOrder.test.js
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { PlaceOrderUseCase } from '../placeOrder.js';

describe('PlaceOrderUseCase', () => {
  let repo, publisher, sut;

  beforeEach(() => {
    repo = { save: jest.fn().mockResolvedValue(undefined) };
    publisher = { publish: jest.fn().mockResolvedValue(undefined) };
    sut = new PlaceOrderUseCase(repo, publisher);
  });

  it('saves and publishes on success', async () => {
    await sut.execute({ customerId: 'cust-1', items: [{ sku: 'S', quantity: 1, price: 1 }] });

    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'OrderPlaced' })
    );
  });

  it('does not publish when save throws', async () => {
    repo.save.mockRejectedValue(new Error('db error'));

    await expect(sut.execute({ customerId: 'c', items: [] })).rejects.toThrow('db error');
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});
```

---

## Factories

```js
// test/factories.js
import { randomUUID } from 'node:crypto';

let seq = 0;
const next = () => ++seq;

export const makeOrderItem = (overrides = {}) => ({
  sku: `SKU-${next()}`,
  quantity: 1,
  price: 1000,
  ...overrides,
});

export const makeSqsEvent = (records) => ({
  Records: records.map(body => ({
    messageId: randomUUID(),
    receiptHandle: 'handle',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    attributes: {},
    messageAttributes: {},
    md5OfBody: 'abc',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:123:test-queue',
    awsRegion: 'us-east-1',
  })),
});
```

---

## Integration Test Setup (Testcontainers + LocalStack)

```js
// test/integration/setup.js
import { GenericContainer } from 'testcontainers';
import { DynamoDBClient, CreateTableCommand } from '@aws-sdk/client-dynamodb';

export async function startLocalStack() {
  const container = await new GenericContainer('localstack/localstack')
    .withEnvironment({ SERVICES: 'dynamodb,sns,sqs' })
    .withExposedPorts(4566)
    .start();

  const endpoint = `http://localhost:${container.getMappedPort(4566)}`;
  const clientConfig = {
    endpoint,
    region: 'us-east-1',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  };

  return { container, endpoint, clientConfig };
}

export async function createOrdersTable(client) {
  await client.send(new CreateTableCommand({
    TableName: 'orders-test',
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST',
  }));
}
```

```js
// test/integration/orderRepo.test.js
import { startLocalStack, createOrdersTable } from './setup.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDbOrderRepo } from '../../src/adapters/dynamodb/orderRepo.js';
import { makeOrderItem } from '../factories.js';
import { Order } from '../../src/domain/order.js';

describe('DynamoDbOrderRepo — integration', () => {
  let container, repo;

  beforeAll(async () => {
    const { container: c, clientConfig } = await startLocalStack();
    container = c;

    const client = new DynamoDBClient(clientConfig);
    await createOrdersTable(client);

    repo = new DynamoDbOrderRepo(
      { AWS_REGION: 'us-east-1', ORDERS_TABLE: 'orders-test' },
      client
    );
  }, 60_000); // containers take time

  afterAll(async () => {
    await container?.stop();
  });

  it('persists and retrieves order', async () => {
    const order = Order.create({ customerId: 'cust-1', items: [makeOrderItem()] });
    await repo.save(order);

    const found = await repo.findById(order.id);
    expect(found.id).toBe(order.id);
  });

  it('throws NotFoundError for unknown id', async () => {
    await expect(repo.findById('nonexistent')).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});
```

---

## Coverage Configuration

```js
// jest.config.js
export default {
  testEnvironment: 'node',
  coverageThreshold: {
    global: {
      lines: 80,
      branches: 70,
      functions: 80,
      statements: 80,
    },
  },
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/main.js',
    '!src/**/__tests__/**',
  ],
  coverageReporters: ['text', 'lcov', 'html'],
};
```

---

## Cross-References

→ [Testing Strategies](../../testing/general/strategies.md) | [Testing Patterns (Node.js)](../../patterns/nodejs/testing.md) | [TypeScript Testing Guide](../typescript/guide.md)
