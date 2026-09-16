# Testing Patterns (Node.js)

> Jest / Node test runner, mocking, factories, integration tests, and Lambda handler tests in Node.js.

---

## Test Framework Choice

| Framework | Use When |
|-----------|----------|
| **Node built-in** (`node:test`) | Minimal deps, Node 20+, simple projects |
| **Jest** | Rich ecosystem, snapshot tests, mocking utilities |
| **Vitest** | TypeScript-first (prefer for TS projects) — see [TypeScript Testing](../typescript/testing.md) |

---

## Node Built-in Test Runner (Node 20+)

```js
// order.test.js
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

describe('Order', () => {
  describe('create()', () => {
    it('creates order with pending status', () => {
      const order = Order.create({ customerId: 'cust-1', items: [testItem()] });

      assert.equal(order.status, 'pending');
      assert.equal(order.customerId, 'cust-1');
    });

    it('throws ValidationError when customerId is missing', () => {
      assert.throws(
        () => Order.create({ items: [testItem()] }),
        { name: 'ValidationError' }
      );
    });
  });
});

function testItem() {
  return { sku: 'SKU-001', quantity: 1, price: 1000 };
}
```

Run: `node --test` or `node --test src/**/*.test.js`

---

## Jest Structure

```js
// useCases/__tests__/placeOrder.test.js
import { PlaceOrderUseCase } from '../placeOrder.js';
import { makeOrder } from '../../test/factories.js';

describe('PlaceOrderUseCase', () => {
  let repo, publisher, useCase;

  beforeEach(() => {
    repo = {
      findById: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
    };
    publisher = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    useCase = new PlaceOrderUseCase(repo, publisher);
  });

  describe('execute()', () => {
    it('saves order and publishes event', async () => {
      const result = await useCase.execute({
        customerId: 'cust-1',
        items: [{ sku: 'SKU-1', quantity: 1, price: 500 }],
      });

      expect(repo.save).toHaveBeenCalledOnce();
      expect(publisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'OrderPlaced' })
      );
      expect(result.status).toBe('pending');
    });

    it('throws when save fails', async () => {
      repo.save.mockRejectedValue(new Error('db error'));

      await expect(useCase.execute({ customerId: 'c', items: [] }))
        .rejects.toThrow('db error');

      expect(publisher.publish).not.toHaveBeenCalled();
    });
  });
});
```

---

## Factories

```js
// test/factories.js
import { randomUUID } from 'node:crypto';
import { Order } from '../src/domain/order.js';

let counter = 0;

export function makeOrder(overrides = {}) {
  return Order.create({
    customerId: `cust-${++counter}`,
    items: [makeOrderItem()],
    ...overrides,
  });
}

export function makeOrderItem(overrides = {}) {
  return {
    sku: `SKU-${++counter}`,
    quantity: 1,
    price: 1000,
    ...overrides,
  };
}

export function makeSqsRecord(body, overrides = {}) {
  return {
    messageId: randomUUID(),
    receiptHandle: 'handle',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    attributes: {},
    messageAttributes: {},
    md5OfBody: 'abc',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:123:test-queue',
    awsRegion: 'us-east-1',
    ...overrides,
  };
}
```

---

## Integration Tests with Testcontainers

```js
// test/integration/orderRepo.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { GenericContainer } from 'testcontainers';
import { DynamoDBClient, CreateTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDbOrderRepo } from '../../src/adapters/dynamodb/orderRepo.js';
import { makeOrder } from '../factories.js';

let container, client, repo;

before(async () => {
  container = await new GenericContainer('localstack/localstack')
    .withEnvironment({ SERVICES: 'dynamodb' })
    .withExposedPorts(4566)
    .start();

  const endpoint = `http://localhost:${container.getMappedPort(4566)}`;

  client = new DynamoDBClient({
    endpoint,
    region: 'us-east-1',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });

  await client.send(new CreateTableCommand({
    TableName: 'orders-test',
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST',
  }));

  repo = new DynamoDbOrderRepo({ AWS_REGION: 'us-east-1', ORDERS_TABLE: 'orders-test' }, client);
});

after(async () => {
  await container?.stop();
});

describe('DynamoDbOrderRepo', () => {
  it('saves and retrieves order', async () => {
    const order = makeOrder();
    await repo.save(order);

    const found = await repo.findById(order.id);
    assert.equal(found.id, order.id);
    assert.equal(found.customerId, order.customerId);
  });

  it('throws NotFoundError for missing id', async () => {
    await assert.rejects(
      () => repo.findById('nonexistent'),
      { name: 'NotFoundError' }
    );
  });
});
```

---

## Lambda Handler Test

```js
// handlers/__tests__/placeOrder.test.js
import { handler } from '../placeOrder.js';
import { makeOrder } from '../../test/factories.js';

// Mock the dependency container
jest.mock('../../container.js', () => ({
  createDependencies: () => ({
    placeOrder: {
      execute: jest.fn().mockResolvedValue(makeOrder()),
    },
  }),
}));

describe('handler', () => {
  it('returns 201 on success', async () => {
    const event = {
      body: JSON.stringify({ customerId: 'cust-1', items: [] }),
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.data).toBeDefined();
  });

  it('returns 422 for validation error', async () => {
    const { createDependencies } = await import('../../container.js');
    createDependencies().placeOrder.execute.mockRejectedValue(
      Object.assign(new Error('invalid'), { statusCode: 422 })
    );

    const response = await handler({ body: JSON.stringify({}) });
    expect(response.statusCode).toBe(422);
  });
});
```

---

## Jest Configuration

```js
// jest.config.js
export default {
  testEnvironment: 'node',
  transform: {},  // ESM — no transform needed
  extensionsToTreatAsEsm: ['.js'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  coverageThreshold: {
    global: { lines: 80, branches: 70 },
  },
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/main.js',
  ],
};
```

---

## Running Tests

```bash
# Node built-in
node --test
node --test --reporter=spec

# Jest
pnpm test
pnpm test -- --coverage
pnpm test -- --watch
pnpm test -- --testPathPattern=placeOrder
```

---

## Cross-References

→ [Testing Strategies](../../testing/general/strategies.md) | [Testing Guide (Node.js)](../../testing/nodejs/guide.md) | [TypeScript Testing](../typescript/testing.md) | [Code Patterns (Node.js)](./code.md)
