# Code Patterns (Node.js)

> Constructor injection, module patterns, domain modeling, and service configuration in Node.js (ESM).

---

## Dependency Injection

```js
// ports/orderRepository.js — define the interface via JSDoc
/**
 * @typedef {Object} OrderRepository
 * @property {(id: string) => Promise<Order>} findById
 * @property {(order: Order) => Promise<void>} save
 */

// useCases/placeOrder.js
export class PlaceOrderUseCase {
  /** @param {OrderRepository} repo @param {EventPublisher} publisher */
  constructor(repo, publisher) {
    this.repo = repo;
    this.publisher = publisher;
  }

  async execute(cmd) {
    const order = Order.create(cmd);
    await this.repo.save(order);
    await this.publisher.publish({ type: 'OrderPlaced', data: order });
    return order;
  }
}

// main.js — wire at entry point only
import { DynamoDbOrderRepo } from './adapters/dynamodb/orderRepo.js';
import { SnsPublisher } from './adapters/sns/publisher.js';
import { PlaceOrderUseCase } from './useCases/placeOrder.js';

const config = loadConfig();
const repo = new DynamoDbOrderRepo(config);
const publisher = new SnsPublisher(config);
const placeOrder = new PlaceOrderUseCase(repo, publisher);
```

---

## Domain Modeling

```js
// domain/order.js
import { randomUUID } from 'node:crypto';

export class Order {
  #id;
  #customerId;
  #items;
  #status;
  #createdAt;

  constructor({ id, customerId, items, status, createdAt }) {
    this.#id = id;
    this.#customerId = customerId;
    this.#items = items;
    this.#status = status;
    this.#createdAt = createdAt;
  }

  static create({ customerId, items }) {
    if (!customerId) throw new ValidationError('customerId is required');
    if (!items?.length) throw new ValidationError('items cannot be empty');

    return new Order({
      id: randomUUID(),
      customerId,
      items,
      status: 'pending',
      createdAt: new Date(),
    });
  }

  place() {
    if (this.#status !== 'pending') {
      throw new InvalidTransitionError(this.#status, 'placed');
    }
    return new Order({ ...this.toJSON(), status: 'placed' });
  }

  toJSON() {
    return {
      id: this.#id,
      customerId: this.#customerId,
      items: this.#items,
      status: this.#status,
      createdAt: this.#createdAt,
    };
  }

  get id() { return this.#id; }
  get status() { return this.#status; }
}
```

---

## Error Types

```js
// errors.js
export class AppError extends Error {
  constructor(message, code, statusCode = 500) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource, id) {
    super(`${resource} ${id} not found`, 'NOT_FOUND', 404);
    this.resource = resource;
    this.resourceId = id;
  }
}

export class ValidationError extends AppError {
  constructor(message, fields = {}) {
    super(message, 'VALIDATION_ERROR', 422);
    this.fields = fields;
  }
}

export class InvalidTransitionError extends AppError {
  constructor(from, to) {
    super(`Invalid transition: ${from} → ${to}`, 'INVALID_TRANSITION', 409);
  }
}
```

---

## Service Configuration

```js
// config.js
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8080),
  AWS_REGION: z.string(),
  ORDERS_TABLE: z.string(),
  SNS_TOPIC_ARN: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export function loadConfig(env = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return Object.freeze(result.data);
}
```

---

## Repository Pattern (AWS SDK v3)

```js
// adapters/dynamodb/orderRepo.js
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { NotFoundError } from '../../errors.js';

export class DynamoDbOrderRepo {
  #client;
  #tableName;

  constructor(config) {
    this.#client = new DynamoDBClient({ region: config.AWS_REGION });
    this.#tableName = config.ORDERS_TABLE;
  }

  async findById(id) {
    const { Item } = await this.#client.send(new GetItemCommand({
      TableName: this.#tableName,
      Key: marshall({ id }),
    }));

    if (!Item) throw new NotFoundError('Order', id);
    return this.#toDomain(unmarshall(Item));
  }

  async save(order) {
    await this.#client.send(new PutItemCommand({
      TableName: this.#tableName,
      Item: marshall(order.toJSON()),
    }));
  }

  #toDomain(item) {
    return new Order(item);
  }
}
```

---

## Module Pattern (Named Exports, No Default Classes)

```js
// Prefer named function exports for simple service modules
// useCases/cancelOrder.js

export async function cancelOrder(orderId, { repo, publisher }) {
  const order = await repo.findById(orderId);
  const cancelled = order.cancel();
  await repo.save(cancelled);
  await publisher.publish({ type: 'OrderCancelled', data: cancelled });
  return cancelled;
}

// Usage — pass deps explicitly or via closure
const deps = { repo, publisher };
await cancelOrder(orderId, deps);
```

Use classes when you need to maintain instance state or implement an interface. Use plain functions for stateless operations.

---

## Lambda Handler Pattern

```js
// handlers/placeOrder.js
import { loadConfig } from '../config.js';
import { createDependencies } from '../container.js';

let deps; // module-level — reused across warm invocations

export async function handler(event) {
  deps ??= createDependencies(loadConfig());

  const body = JSON.parse(event.body);

  try {
    const order = await deps.placeOrder.execute(body);
    return { statusCode: 201, body: JSON.stringify({ data: order }) };
  } catch (err) {
    if (err.statusCode) {
      return { statusCode: err.statusCode, body: JSON.stringify({ error: err.message }) };
    }
    console.error('Unhandled error', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
  }
}
```

---

## Cross-References

→ [Conventions (Node.js)](../../conventions/nodejs/index.md) | [TypeScript Patterns](../typescript/code.md) | [Concurrency (Node.js)](./concurrency.md) | [Testing (Node.js)](../../testing/nodejs/guide.md)
