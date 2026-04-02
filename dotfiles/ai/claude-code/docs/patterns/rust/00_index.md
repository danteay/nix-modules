# Patterns — Rust

> Rust-specific implementations of common patterns.

---

## Contents

| File | Description |
|------|-------------|
| [Code](./code.md) | DI with `Arc<dyn Trait>`, builder pattern, value objects (newtype), domain aggregates, service config, error mapping at layer boundaries |
| [Concurrency](./concurrency.md) | Tokio tasks, `join!`, `JoinSet`, `Semaphore`, worker pool, channels (`mpsc`/`oneshot`/`broadcast`), SQS Lambda consumer |
| [Testing](./testing.md) | `mockall` (`#[automock]`), test factories, testcontainers + LocalStack, Tokio test utilities, HTTP handler tests with Axum |

---

## Quick Reference

- **DI:** `Arc<dyn Trait>` injected via constructor, `async_trait` for async methods
- **Errors:** `thiserror` for domain errors, `anyhow` at binary entry points
- **Async:** Tokio runtime, `tokio::join!` for parallel, `JoinSet` for dynamic collections
- **Mocking:** `mockall` crate, `#[automock]` attribute on traits

---

## Cross-References

→ [Patterns Index](../00_index.md) | [Rust Conventions](../../conventions/rust/00_index.md) | [Rust Testing](../../testing/rust/00_index.md)
