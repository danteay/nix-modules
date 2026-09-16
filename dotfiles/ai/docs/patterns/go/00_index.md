# Patterns — Go

> Go-specific implementations of common patterns.

---

## Contents

| File | Description |
|------|-------------|
| [Code](./code.md) | Constructor injection, functional options, interface segregation, service config with `LoadConfig()`, provider pattern, error wrapping |
| [Concurrency](./concurrency.md) | goroutine lifecycle rules, `errgroup`, worker pool, semaphore (`x/sync`), pipeline, SQS batch partial failures, `sync.Once` |
| [Testing](./testing.md) | Test naming, `t.Parallel`, testify + mockery `EXPECT()` API, test wrapper pattern, handler tests, `TestMain` |

---

## Quick Reference

- **DI:** constructor injection via `New...` functions, `Arc`-like pattern with interfaces
- **Config:** `LoadConfig()` validates at startup, panics on bad env
- **Mocking:** `mockery` generates typed mocks, use `EXPECT().Method()` chain
- **Concurrency limit:** `golang.org/x/sync/semaphore`

---

## Cross-References

→ [Patterns Index](../00_index.md) | [Go Conventions](../../conventions/go/00_index.md) | [Go Testing](../../testing/go/00_index.md)
