# Node.js Conventions

> Node.js-specific conventions: module system, event loop, streams, and runtime patterns.
> For TypeScript-specific rules see [TypeScript Conventions](../typescript/index.md).

---

## Module System

Prefer **ESM** (ES Modules) over CommonJS for all new projects:

```json
// package.json
{
  "type": "module",
  "engines": { "node": ">=20" }
}
```

```js
// Good — ESM
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

export function processOrder(order) { ... }
export default class OrderService { ... }

// Avoid — CommonJS in new projects
const fs = require('fs');
module.exports = { processOrder };
```

When interop with CommonJS is required, use `.mjs` / `.cjs` extensions explicitly.

---

## Node.js Built-in Modules

Always prefix built-in modules with `node:` to distinguish from npm packages:

```js
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Worker, isMainThread } from 'node:worker_threads';
```

---

## Async Patterns

Async/await is preferred over callbacks and raw Promises:

```js
// Good — async/await
async function placeOrder(attrs) {
  const order = await orderRepo.findById(attrs.id);
  await publisher.publish({ type: 'OrderPlaced', data: order });
  return order;
}

// Parallel operations — do not await sequentially when independent
const [order, payment] = await Promise.all([
  orderRepo.findById(orderId),
  paymentService.getStatus(paymentId),
]);

// Error handling
async function safeProcess(event) {
  try {
    await processEvent(event);
  } catch (err) {
    logger.error({ err, event }, 'event processing failed');
    throw err;
  }
}
```

Rules:

- Never mix callbacks and promises in the same call chain
- Always `await` Promises or explicitly `.catch()` them — no unhandled rejections
- Use `Promise.allSettled` when you need all results regardless of failure
- Avoid `Promise.race` without timeout handling

---

## Event Loop Awareness

CPU-bound work blocks the event loop — off-load it:

```js
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { setImmediate } from 'node:timers/promises';

// For heavy computation — use worker threads
function runCpuBound(data) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./worker.js', { workerData: data });
    worker.on('message', resolve);
    worker.on('error', reject);
  });
}

// For yielding in a loop — use setImmediate
async function processBatch(items) {
  for (const item of items) {
    await processItem(item);
    await setImmediate(); // yield to event loop between items
  }
}
```

Rules:

- No synchronous I/O (`fs.readFileSync`) outside of startup/config loading
- No CPU-bound loops on the main thread without yielding
- Use `worker_threads` for CPU-intensive work
- Use `child_process.execFile` (not `exec`) for shell commands — prevents injection

---

## Streams

Prefer Node.js streams for large data processing:

```js
import { createReadStream, createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const transform = new Transform({
  objectMode: true,
  transform(chunk, encoding, callback) {
    try {
      callback(null, processChunk(chunk));
    } catch (err) {
      callback(err);
    }
  },
});

// Use pipeline — handles errors and cleanup automatically
await pipeline(
  createReadStream('input.jsonl'),
  transform,
  createWriteStream('output.jsonl'),
);
```

Rules:

- Always use `pipeline` (from `node:stream/promises`) — not `.pipe()` directly
- Handle `error` events on all stream instances when not using `pipeline`
- Use `objectMode: true` for streams of objects, not raw buffers

---

## Error Handling

```js
// Domain errors
export class OrderNotFoundError extends Error {
  constructor(id) {
    super(`Order ${id} not found`);
    this.name = 'OrderNotFoundError';
    this.code = 'ORDER_NOT_FOUND';
    Error.captureStackTrace(this, this.constructor);
  }
}

// Operational error vs programmer error distinction
function assertDefined(value, message) {
  if (value == null) throw new TypeError(message); // programmer error
}

// Unhandled rejection safety net (log + exit)
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'unhandled promise rejection');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  process.exit(1);
});
```

---

## Configuration

```js
// config.js
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(8080),
  AWS_REGION: z.string(),
  TABLE_NAME: z.string(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export function loadConfig() {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${result.error.message}`);
  }
  return result.data;
}
```

---

## Process Management

```js
// Graceful shutdown
const server = app.listen(config.PORT);

async function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await db.disconnect();
    process.exit(0);
  });

  // Force exit after timeout
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
```

---

## Toolchain

```bash
# Formatting + linting
npx prettier --write .
npx eslint . --fix

# Tests
node --test             # built-in test runner (Node 20+)
npx jest                # Jest (if used)

# Security
npm audit
npx better-npm-audit check

# Package management — prefer pnpm
pnpm install
pnpm run build
pnpm test
```

Key runtime packages:

- `zod` — runtime config and input validation
- `pino` — structured JSON logging
- `fastify` or `express` — HTTP server
- `@aws-sdk/client-*` — AWS SDK v3 (modular imports)

---

## Cross-References

→ [TypeScript Conventions](../typescript/index.md) | [Patterns (Node.js)](../../patterns/nodejs/code.md) | [Testing (Node.js)](../../testing/nodejs/guide.md) | [General Conventions](../general/common-pitfalls.md)
