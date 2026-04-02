# Concurrency Patterns (General)

> Language-agnostic concepts for concurrent and parallel workloads.

---

## Worker Pool

Bounds the number of concurrent workers processing a workload. Prevents resource exhaustion under high load.

### Concept

```
Input ──► [  Queue  ] ──► Worker 1 ──► Output
                      ──► Worker 2 ──► Output
                      ──► Worker 3 ──► Output
          (buffered)       (N = concurrency limit)
```

### When to Use

- Processing large batches (thousands of items from a DB scan or S3 listing)
- Fan-out HTTP requests with a rate limit on the external service
- Parallel file processing

### Key Design Decisions

- **Concurrency limit** — start with `N = number of CPU cores` for CPU-bound; `N = 10–50` for I/O-bound
- **Error handling** — collect all errors vs. fail-fast on first error
- **Back-pressure** — bound the input queue to prevent memory spikes
- **Graceful shutdown** — drain in-flight work on cancellation

---

## Semaphore

Limits concurrent access to a shared resource without a fixed worker count.

### Concept

```
Goroutines/Threads ──► [Semaphore(N)] ──► Shared Resource
                         (blocks when N slots full)
```

### When to Use

- Rate-limiting calls to an external API (e.g., max 5 concurrent HTTP calls)
- Limiting database connection usage from concurrent workers
- Controlling concurrent writes to a shared resource

### vs. Worker Pool

| | Worker Pool | Semaphore |
|--|-------------|-----------|
| Workers | Fixed, pre-created | Dynamic, acquire/release |
| Use case | Known batch workload | Variable concurrent access |
| Control | Coarse (N workers) | Fine (N slots) |

---

## Pipeline

Chain processing stages where each stage reads from the previous and produces output for the next.

### Concept

```
Source ──► Stage 1 ──► Stage 2 ──► Stage 3 ──► Sink
           (parse)    (enrich)    (validate)   (save)
```

### Properties

- Each stage runs **concurrently** with others
- **Back-pressure** flows naturally via bounded channels/queues
- Cancellation propagates from sink back to source

---

## WaitGroup / Join

Synchronize a set of concurrent tasks before proceeding.

### Concept

```
Main ──► Task A ──► (completes)
     ──► Task B ──► (completes) ──► Continue (all joined)
     ──► Task C ──► (completes)
```

### When to Use

- Fire N tasks concurrently and wait for all to finish
- Fan-out parallel requests then aggregate results
- Parallel initialization of independent services at startup

---

## Patterns for Message-Driven Systems

### SQS / Queue Batch Processing

```
Queue ──► Lambda/Consumer ──► Worker Pool (N workers) ──► Process messages
                                    │
                             Partial failure tracking
                                    │
                             DLQ for failed items
```

Key considerations:
- **Idempotency** — messages can be redelivered; processing must be safe to repeat
- **Partial batch failures** — mark only failed messages for retry, not the whole batch
- **Visibility timeout** — must exceed max processing time for a batch

---

## Rules (All Languages)

1. Always pass cancellation signals to concurrent work (context, AbortSignal, CancellationToken)
2. Bound all parallelism — unbounded goroutines/threads cause OOM under load
3. Never start concurrent work without a way to wait for completion
4. Make concurrent consumers idempotent by default
5. Measure before optimizing — sequential is simpler and often fast enough

---

## Language-Specific Implementations

| Language | See |
|----------|-----|
| Go | [Go Concurrency Patterns](../go/concurrency.md) — goroutines, channels, errgroup |
| Python | [Python Concurrency Patterns](../python/concurrency.md) — asyncio, TaskGroup, thread pool |
| TypeScript | [TypeScript Concurrency Patterns](../typescript/concurrency.md) — Promise, async generators |

---

## Cross-References

→ [Messaging Patterns](./messaging.md) | [Software Patterns](./software.md)
