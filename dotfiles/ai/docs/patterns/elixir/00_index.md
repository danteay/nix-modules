# Patterns — Elixir

> Elixir/OTP-specific implementations of common patterns.

---

## Contents

| File | Description |
|------|-------------|
| [Code](./code.md) | Behaviours (ports), DI via application config, domain structs, `with` chains, GenServer, Broadway SQS consumer |
| [Concurrency](./concurrency.md) | `Task`/`Task.async_stream`, GenServer worker pool, Broadway pipeline, process registry, `DynamicSupervisor`, timeouts |
| [Testing](./testing.md) | ExUnit, Mox (`expect`/`stub`/`verify_on_exit!`), ExMachina factories, async tests, Broadway consumer tests |

---

## Quick Reference

- **Ports:** `@behaviour MyApp.Ports.OrderRepository` — use `@callback` + `@impl true`
- **DI:** `Application.fetch_env!(:my_app, :order_repo)` — swap impl in `config/test.exs`
- **Mocking:** `Mox.defmock(MockRepo, for: MyApp.Ports.OrderRepository)`
- **Pipelines:** `Broadway` for SQS/Kafka consumer pipelines with back-pressure

---

## Cross-References

→ [Patterns Index](../00_index.md) | [Elixir Conventions](../../conventions/elixir/00_index.md) | [Elixir Testing](../../testing/elixir/00_index.md)
