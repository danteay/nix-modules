# Python Concurrency Patterns

> asyncio, TaskGroup, Semaphore, Queue, and thread pool patterns.

---

## asyncio Fundamentals

Use `async/await` for all I/O-bound work. Never block the event loop.

```python
# BAD — blocks the event loop
import time
async def fetch(url: str) -> str:
    time.sleep(1)           # blocks entire event loop
    return requests.get(url).text  # blocking I/O

# GOOD — non-blocking
import asyncio
import httpx
async def fetch(url: str) -> str:
    async with httpx.AsyncClient() as client:
        resp = await client.get(url)
        return resp.text
```

---

## Parallel Tasks (asyncio.gather)

Run multiple coroutines concurrently and collect all results:

```python
async def enrich_orders(orders: list[Order]) -> list[EnrichedOrder]:
    async def enrich_one(order: Order) -> EnrichedOrder:
        customer, inventory = await asyncio.gather(
            customer_service.get(order.customer_id),
            inventory_service.check(order.items),
        )
        return EnrichedOrder(order=order, customer=customer, inventory=inventory)

    return await asyncio.gather(*[enrich_one(o) for o in orders])
```

**`gather` behaviour:**
- All tasks run concurrently
- Returns when ALL complete
- By default, first exception propagates and others are cancelled
- Use `return_exceptions=True` to collect all results including exceptions

```python
results = await asyncio.gather(*tasks, return_exceptions=True)
successes = [r for r in results if not isinstance(r, Exception)]
errors    = [r for r in results if isinstance(r, Exception)]
```

---

## TaskGroup (Python 3.11+ — Preferred)

Structured concurrency: all tasks are properly joined and errors handled:

```python
async def process_batch(items: list[Item]) -> list[Result]:
    results: list[Result] = []

    async with asyncio.TaskGroup() as tg:
        tasks = [tg.create_task(process_item(item)) for item in items]

    # All tasks finished (or TaskGroup re-raises first exception)
    return [t.result() for t in tasks]
```

**Prefer `TaskGroup` over `gather`** for Python 3.11+:
- Proper structured concurrency (no task leaks)
- Better error handling (collects `ExceptionGroup`)
- Cancels remaining tasks on first failure

---

## Semaphore (Rate Limiting)

Limit concurrent I/O operations:

```python
async def call_api_with_limit(items: list[Item], concurrency: int = 5) -> list[Result]:
    sem = asyncio.Semaphore(concurrency)
    results = []

    async def call_one(item: Item) -> Result:
        async with sem:  # blocks when N slots are taken
            return await external_api.call(item)

    return await asyncio.gather(*[call_one(item) for item in items])
```

---

## Queue-Based Worker Pool

For stream processing or when producers/consumers run at different rates:

```python
async def worker_pool(
    source: AsyncIterator[Item],
    concurrency: int,
    processor: Callable[[Item], Awaitable[Result]],
) -> list[Result]:
    queue: asyncio.Queue[Item] = asyncio.Queue(maxsize=concurrency * 2)
    results: list[Result] = []
    lock = asyncio.Lock()

    async def worker() -> None:
        while True:
            try:
                item = queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            result = await processor(item)
            async with lock:
                results.append(result)
            queue.task_done()

    # Fill queue
    async for item in source:
        await queue.put(item)

    # Run workers
    workers = [asyncio.create_task(worker()) for _ in range(concurrency)]
    await asyncio.gather(*workers)
    return results
```

---

## Thread Pool (CPU-Bound Work)

For CPU-bound tasks, offload to a thread pool to avoid blocking the event loop:

```python
import asyncio
from concurrent.futures import ThreadPoolExecutor

executor = ThreadPoolExecutor(max_workers=4)

async def process_image(data: bytes) -> bytes:
    loop = asyncio.get_event_loop()
    # Run CPU-bound work in thread pool
    return await loop.run_in_executor(executor, compress_image, data)
```

For process-based parallelism (true CPU parallelism, bypasses GIL):

```python
from concurrent.futures import ProcessPoolExecutor

async def run_heavy_computation(data: list[float]) -> list[float]:
    loop = asyncio.get_event_loop()
    with ProcessPoolExecutor() as pool:
        return await loop.run_in_executor(pool, heavy_compute, data)
```

---

## Context Cancellation

Use `asyncio.timeout` (3.11+) or `asyncio.wait_for` to bound operation time:

```python
# Python 3.11+
async def fetch_with_timeout(url: str) -> str:
    async with asyncio.timeout(10.0):  # cancels after 10 seconds
        return await fetch(url)

# Python 3.10-
async def fetch_with_timeout_legacy(url: str) -> str:
    return await asyncio.wait_for(fetch(url), timeout=10.0)
```

---

## SQS Lambda (asyncio in Lambda Handler)

```python
import asyncio
import json
from typing import Any

async def process_record(record: dict[str, Any]) -> str | None:
    """Returns message ID if processing failed, None on success."""
    try:
        body = json.loads(record["body"])
        await order_service.process(body)
        return None
    except Exception as exc:
        logger.error("failed to process", id=record["messageId"], exc_info=exc)
        return record["messageId"]

def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    records = event.get("Records", [])

    async def run() -> list[str]:
        tasks = [process_record(r) for r in records]
        results = await asyncio.gather(*tasks, return_exceptions=False)
        return [r for r in results if r is not None]

    failed_ids = asyncio.run(run())
    return {
        "batchItemFailures": [
            {"itemIdentifier": id} for id in failed_ids
        ]
    }
```

---

## Common Pitfalls

```python
# WRONG — creates new event loop on every call
def handler(event, ctx):
    asyncio.run(main())   # OK for Lambda (single-threaded), BAD in web servers

# WRONG — mixing sync and async incorrectly
async def service_method():
    result = requests.get(url)  # blocking! use httpx.AsyncClient instead

# WRONG — forgetting to await
async def get_order(id: str) -> Order:
    return repo.find_by_id(id)  # missing await — returns coroutine, not Order

# CORRECT
async def get_order(id: str) -> Order:
    return await repo.find_by_id(id)
```

---

## Cross-References

→ [General Concurrency Concepts](../general/concurrency.md) | [Python Conventions](../../conventions/python/index.md) | [Python Testing Patterns](./testing.md)
