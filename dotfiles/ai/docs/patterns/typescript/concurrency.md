# TypeScript Concurrency Patterns

> Promise patterns, async generators, AbortController, and rate limiting in TypeScript.

---

## Promise Fundamentals

```typescript
// Always await — never leave floating promises
const order = await orderService.place(cmd)

// BAD — unhandled rejection
orderService.place(cmd)  // floating promise

// GOOD — explicit fire-and-forget with error handling
void orderService.place(cmd).catch(err => logger.error("place failed", err))
```

---

## Parallel Execution

### Promise.all (Fail Fast)

Run tasks concurrently. Rejects with first error, cancels nothing.

```typescript
const [order, customer, inventory] = await Promise.all([
  orderRepo.findById(orderId),
  customerRepo.findById(customerId),
  inventoryService.check(items),
])
```

### Promise.allSettled (Collect All Results)

Wait for all, regardless of individual failures:

```typescript
const results = await Promise.allSettled([
  notifyEmail(order),
  notifySMS(order),
  notifySlack(order),
])

const failures = results.filter(r => r.status === "rejected")
if (failures.length > 0) {
  logger.warn("some notifications failed", { count: failures.length })
}
```

### Promise.race (First Wins)

```typescript
// Timeout pattern
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
  )
  return Promise.race([promise, timeout])
}

const order = await withTimeout(orderRepo.findById(id), 5000)
```

---

## Concurrency Limiting (Semaphore)

Prevent unbounded parallel requests:

```typescript
class Semaphore {
  private queue: Array<() => void> = []
  private active = 0

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active++
      return this.release.bind(this)
    }
    return new Promise(resolve => {
      this.queue.push(() => {
        this.active++
        resolve(this.release.bind(this))
      })
    })
  }

  private release(): void {
    this.active--
    const next = this.queue.shift()
    if (next) next()
  }
}

// Usage
const sem = new Semaphore(5)

async function processAll(items: Item[]): Promise<Result[]> {
  return Promise.all(
    items.map(async item => {
      const release = await sem.acquire()
      try {
        return await processItem(item)
      } finally {
        release()
      }
    })
  )
}
```

---

## Worker Pool (Batch Processing)

```typescript
async function processInBatches<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let index = 0

  async function worker(): Promise<void> {
    while (index < items.length) {
      const current = index++
      results[current] = await processor(items[current])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  )
  return results
}

// Usage
const enriched = await processInBatches(orders, enrichOrder, 10)
```

---

## AbortController (Cancellation)

```typescript
async function fetchWithCancel(
  url: string,
  signal: AbortSignal,
): Promise<Response> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response
}

// Timeout with AbortController
async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), ms)

  try {
    return await fetchWithCancel(url, controller.signal)
  } finally {
    clearTimeout(timeoutId)
  }
}

// Lambda handler with timeout
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const controller = new AbortController()
  // Leave 500ms for cleanup before Lambda timeout
  const timeout = setTimeout(
    () => controller.abort(new Error("Lambda timeout approaching")),
    (context.getRemainingTimeInMillis() - 500),
  )

  try {
    const result = await processEvent(event, controller.signal)
    return { statusCode: 200, body: JSON.stringify(result) }
  } finally {
    clearTimeout(timeout)
  }
}
```

---

## Async Generators (Streaming)

For streaming large datasets without loading everything into memory:

```typescript
async function* scanDynamoTable(
  client: DynamoDBClient,
  tableName: string,
): AsyncGenerator<Item[], void, void> {
  let lastKey: Record<string, AttributeValue> | undefined

  do {
    const result = await client.send(new ScanCommand({
      TableName: tableName,
      ExclusiveStartKey: lastKey,
      Limit: 100,
    }))

    yield result.Items?.map(unmarshal) ?? []
    lastKey = result.LastEvaluatedKey
  } while (lastKey)
}

// Consume
for await (const batch of scanDynamoTable(client, "orders")) {
  await processBatch(batch)
}
```

---

## SQS Lambda Batch (TypeScript)

```typescript
import type { SQSHandler, SQSBatchResponse } from "aws-lambda"

export const handler: SQSHandler = async (event): Promise<SQSBatchResponse> => {
  const failures: string[] = []

  await Promise.all(
    event.Records.map(async record => {
      try {
        await processRecord(JSON.parse(record.body))
      } catch (err) {
        logger.error("failed to process record", { id: record.messageId, err })
        failures.push(record.messageId)
      }
    })
  )

  return {
    batchItemFailures: failures.map(id => ({ itemIdentifier: id })),
  }
}
```

---

## Common Pitfalls

```typescript
// WRONG — sequential, not parallel
const orderA = await repo.findById("A")
const orderB = await repo.findById("B")  // waits for A to complete first

// CORRECT — parallel
const [orderA, orderB] = await Promise.all([
  repo.findById("A"),
  repo.findById("B"),
])

// WRONG — for await in a loop is sequential
for (const item of items) {
  await processItem(item)  // each waits for previous
}

// CORRECT — parallel with limit
await processInBatches(items, processItem, 10)

// WRONG — catching and swallowing
try {
  await riskyOp()
} catch (_) {}  // silent failure

// CORRECT — handle or re-throw
try {
  await riskyOp()
} catch (err) {
  logger.error("risky op failed", { err })
  throw new ServiceError("operation failed", { cause: err })
}
```

---

## Cross-References

→ [General Concurrency Concepts](../general/concurrency.md) | [TypeScript Conventions](../../conventions/typescript/index.md) | [TypeScript Testing Patterns](./testing.md)
