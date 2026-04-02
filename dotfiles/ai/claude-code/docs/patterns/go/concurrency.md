# Go Concurrency Patterns

> Goroutines, channels, errgroup, semaphore, worker pool, and pipeline patterns.

---

## Goroutine Lifecycle Rules

1. **Never start a goroutine without a way to wait for it**
2. **Always respect context cancellation**
3. **Close channels from the producer side only**
4. **Bound all parallelism** — unbounded goroutines cause OOM

```go
// BAD — fire and forget with no lifecycle management
go func() { doWork() }()

// GOOD — tracked lifecycle
var wg sync.WaitGroup
wg.Add(1)
go func() {
    defer wg.Done()
    doWork()
}()
wg.Wait()
```

---

## errgroup (Preferred over raw WaitGroup)

`golang.org/x/sync/errgroup` is the standard for parallel tasks that can fail.

```go
import "golang.org/x/sync/errgroup"

func ProcessItems(ctx context.Context, items []Item) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(10)  // max 10 concurrent goroutines

    for _, item := range items {
        item := item  // capture (unnecessary in Go 1.22+)
        g.Go(func() error {
            return processItem(ctx, item)
        })
    }

    return g.Wait()  // returns first non-nil error; cancels ctx for all others
}
```

**Use `SetLimit`** whenever you have a variable-length input. Never create unbounded goroutines.

---

## Worker Pool

For scenarios where you need persistent workers consuming from a queue:

```go
func WorkerPool(ctx context.Context, items []Item, concurrency int) error {
    work := make(chan Item, len(items))
    for _, item := range items {
        work <- item
    }
    close(work)

    g, ctx := errgroup.WithContext(ctx)
    for range concurrency {
        g.Go(func() error {
            for {
                select {
                case <-ctx.Done():
                    return ctx.Err()
                case item, ok := <-work:
                    if !ok {
                        return nil  // channel drained
                    }
                    if err := processItem(ctx, item); err != nil {
                        return err  // first error cancels all workers
                    }
                }
            }
        })
    }
    return g.Wait()
}
```

**When to prefer worker pool over `errgroup.SetLimit`:**
- Workers need to be persistent (consuming from an external queue like SQS)
- Processing order matters within a worker
- You need fan-in from multiple sources

---

## Semaphore

Limit concurrent access without a fixed worker count:

```go
import "golang.org/x/sync/semaphore"

func CallAPIWithRateLimit(ctx context.Context, items []Item) error {
    sem := semaphore.NewWeighted(5)  // max 5 concurrent API calls

    g, ctx := errgroup.WithContext(ctx)
    for _, item := range items {
        item := item
        g.Go(func() error {
            if err := sem.Acquire(ctx, 1); err != nil {
                return err  // context cancelled
            }
            defer sem.Release(1)
            return callExternalAPI(ctx, item)
        })
    }
    return g.Wait()
}
```

**Channel-based semaphore** (no stdlib dependency):

```go
type Semaphore chan struct{}

func NewSemaphore(n int) Semaphore { return make(Semaphore, n) }

func (s Semaphore) Acquire(ctx context.Context) error {
    select {
    case s <- struct{}{}:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (s Semaphore) Release() { <-s }
```

---

## Pipeline

Chain stages connected by channels. Each stage runs concurrently with others.

```go
func Pipeline(ctx context.Context, source []string) ([]Result, error) {
    raw := produce(ctx, source)        // stage 1: emit items
    parsed := parse(ctx, raw)          // stage 2: parse concurrently
    enriched := enrich(ctx, parsed)    // stage 3: enrich concurrently
    return collect(ctx, enriched)      // stage 4: gather results
}

func produce(ctx context.Context, items []string) <-chan string {
    out := make(chan string, len(items))
    go func() {
        defer close(out)
        for _, item := range items {
            select {
            case out <- item:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func parse(ctx context.Context, in <-chan string) <-chan ParsedItem {
    out := make(chan ParsedItem)
    go func() {
        defer close(out)
        for s := range in {
            select {
            case <-ctx.Done():
                return
            case out <- parseItem(s):
            }
        }
    }()
    return out
}
```

---

## SQS Batch Processing (Lambda)

Combine errgroup + partial batch failure reporting:

```go
func Handler(ctx context.Context, event events.SQSEvent) (events.SQSEventResponse, error) {
    var (
        mu       sync.Mutex
        failures []events.SQSBatchItemFailure
    )

    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(5)  // max 5 concurrent message processors

    for _, record := range event.Records {
        record := record
        g.Go(func() error {
            if err := processRecord(ctx, record); err != nil {
                mu.Lock()
                failures = append(failures, events.SQSBatchItemFailure{
                    ItemIdentifier: record.MessageId,
                })
                mu.Unlock()
                // Return nil — we track failures manually, not via errgroup
            }
            return nil
        })
    }

    g.Wait() // nolint: errcheck — always nil since we return nil in goroutines
    return events.SQSEventResponse{BatchItemFailures: failures}, nil
}
```

---

## Channels Best Practices

```go
// Use buffered channels to decouple producer/consumer timing
ch := make(chan Item, bufferSize)

// Range over channel (cleaner than select in simple consumers)
for item := range ch {
    process(item)
}

// Fan-out: one producer, multiple consumers
for range numWorkers {
    go func() {
        for item := range shared { process(item) }
    }()
}

// Fan-in: merge multiple channels into one
func merge(ctx context.Context, channels ...<-chan Item) <-chan Item {
    out := make(chan Item)
    var wg sync.WaitGroup
    for _, ch := range channels {
        ch := ch
        wg.Add(1)
        go func() {
            defer wg.Done()
            for item := range ch {
                select {
                case out <- item:
                case <-ctx.Done():
                    return
                }
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

---

## sync.Once — Initialize Once per Cold Start

```go
var (
    secret     string
    secretOnce sync.Once
)

func getSecret(ctx context.Context) string {
    secretOnce.Do(func() {
        var err error
        secret, err = loadFromSecretsManager(ctx, os.Getenv("SECRET_ARN"))
        if err != nil {
            log.Fatal("load secret:", err)
        }
    })
    return secret
}
```

---

## Common Mistakes

```go
// WRONG — loop variable capture (Go < 1.22)
for _, item := range items {
    go func() { process(item) }()  // all goroutines see same item
}

// CORRECT (Go < 1.22)
for _, item := range items {
    item := item
    go func() { process(item) }()
}
// In Go 1.22+ loop variables are captured by value automatically

// WRONG — goroutine leak: channel send blocks forever if nobody reads
go func() { resultCh <- compute() }()

// CORRECT — buffered or select with done
go func() {
    select {
    case resultCh <- compute():
    case <-ctx.Done():
    }
}()
```

---

## Cross-References

→ [General Concurrency Concepts](../general/concurrency.md) | [Go Conventions](../../conventions/go/index.md) | [Go Testing Patterns](./testing.md)
