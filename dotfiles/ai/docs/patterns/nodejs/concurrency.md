# Concurrency Patterns (Node.js)

> Promise patterns, event loop management, worker threads, streams, and SQS consumers in Node.js.

---

## Promise.all (Parallel Independent Work)

```js
// Run independent async operations concurrently
const [order, customer, inventory] = await Promise.all([
  orderRepo.findById(orderId),
  customerService.getById(customerId),
  inventoryService.check(items),
]);

// Fail fast — rejects as soon as any promise rejects
```

---

## Promise.allSettled (Tolerant Fan-Out)

```js
const results = await Promise.allSettled(
  orderIds.map(id => orderRepo.findById(id))
);

const orders = [];
const errors = [];

for (const result of results) {
  if (result.status === 'fulfilled') {
    orders.push(result.value);
  } else {
    errors.push(result.reason);
  }
}
```

---

## Semaphore (Concurrency Limit)

```js
// utils/semaphore.js
export class Semaphore {
  #permits;
  #queue = [];

  constructor(permits) {
    this.#permits = permits;
  }

  async acquire() {
    if (this.#permits > 0) {
      this.#permits--;
      return;
    }
    return new Promise(resolve => this.#queue.push(resolve));
  }

  release() {
    if (this.#queue.length > 0) {
      const resolve = this.#queue.shift();
      resolve();
    } else {
      this.#permits++;
    }
  }

  async withPermit(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// Usage
const sem = new Semaphore(10);

const results = await Promise.all(
  items.map(item => sem.withPermit(() => processItem(item)))
);
```

---

## Worker Pool

```js
// utils/workerPool.js
import { Semaphore } from './semaphore.js';

export async function processWithPool(items, handler, { concurrency = 10 } = {}) {
  const sem = new Semaphore(concurrency);
  return Promise.all(
    items.map(item => sem.withPermit(() => handler(item)))
  );
}

// Usage
const results = await processWithPool(events, processEvent, { concurrency: 5 });
```

---

## Worker Threads

For CPU-bound work that would block the event loop:

```js
// workers/hashWorker.js
import { workerData, parentPort } from 'node:worker_threads';
import { createHash } from 'node:crypto';

const result = createHash('sha256').update(workerData.payload).digest('hex');
parentPort.postMessage(result);

// main.js
import { Worker } from 'node:worker_threads';

function runInWorker(workerFile, data) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerFile, { workerData: data });
    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', code => {
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
  });
}

const hash = await runInWorker('./workers/hashWorker.js', { payload: largeData });
```

---

## Streams for Large Data

```js
import { createReadStream, createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const transformRecords = new Transform({
  objectMode: true,
  transform(chunk, _encoding, callback) {
    try {
      const record = JSON.parse(chunk.toString());
      callback(null, processRecord(record));
    } catch (err) {
      callback(err);
    }
  },
});

await pipeline(
  createReadStream('input.jsonl'),
  transformRecords,
  createWriteStream('output.jsonl'),
);
```

---

## Async Generator for Pagination

```js
async function* scanDynamoDB(client, tableName) {
  let lastKey;

  do {
    const response = await client.send(new ScanCommand({
      TableName: tableName,
      ExclusiveStartKey: lastKey,
    }));

    for (const item of response.Items ?? []) {
      yield unmarshall(item);
    }

    lastKey = response.LastEvaluatedKey;
  } while (lastKey);
}

// Usage
for await (const item of scanDynamoDB(client, 'orders')) {
  await processItem(item);
}
```

---

## SQS Lambda Consumer (Batch with Partial Failures)

```js
// handlers/processOrders.js
import { processWithPool } from '../utils/workerPool.js';

export async function handler(event) {
  const failures = [];

  await processWithPool(
    event.Records,
    async (record) => {
      try {
        const body = JSON.parse(record.body);
        await processOrder(body);
      } catch (err) {
        console.error({ messageId: record.messageId, err }, 'record failed');
        failures.push({ itemIdentifier: record.messageId });
      }
    },
    { concurrency: 5 }
  );

  return { batchItemFailures: failures };
}
```

---

## AbortController for Timeouts

```js
async function fetchWithTimeout(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return await response.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
```

---

## Event Emitter Pattern

```js
import { EventEmitter } from 'node:events';

class OrderProcessor extends EventEmitter {
  async process(order) {
    this.emit('processing', { orderId: order.id });
    try {
      const result = await this.#doProcess(order);
      this.emit('processed', { orderId: order.id, result });
      return result;
    } catch (err) {
      this.emit('error', { orderId: order.id, err });
      throw err;
    }
  }
}

const processor = new OrderProcessor();
processor.on('processed', ({ orderId }) => logger.info({ orderId }, 'done'));
processor.on('error', ({ orderId, err }) => logger.error({ orderId, err }, 'failed'));
```

Rules:
- Always handle the `error` event on EventEmitter instances — unhandled `error` events throw
- Use `once` instead of `on` for one-time events (e.g., connection established)
- Prefer async/await over EventEmitter for complex flows — EventEmitters get hard to trace

---

## Cross-References

→ [Concurrency Concepts](../general/concurrency.md) | [Code Patterns (Node.js)](./code.md) | [TypeScript Concurrency](../typescript/concurrency.md) | [Testing (Node.js)](../../testing/nodejs/guide.md)
