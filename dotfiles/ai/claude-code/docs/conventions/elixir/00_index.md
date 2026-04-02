# Conventions — Elixir

> Elixir-specific coding standards: naming, OTP, behaviours, pattern matching, and tooling.

---

## Contents

| File | Description |
|------|-------------|
| [Elixir Conventions](./index.md) | Full Elixir conventions: naming table, project structure, behaviours (ports), error handling with tagged tuples, pattern matching in function heads, OTP/GenServer supervision, DI via app config, structlog, mix toolchain |

---

## Key Rules (Quick Reference)

- Errors: `{:ok, value}` / `{:error, reason}` — always tagged tuples
- Pattern match in function heads over `cond`/`if` for multiple clauses
- Behaviours: define `@callback` specs, implement with `@impl true`
- DI: `Application.fetch_env!(:app, :repo)` — swap impl in `config/test.exs`
- Testing: `Mox` for behaviour mocks, `setup :verify_on_exit!` to enforce expectations

---

## Cross-References

→ [Conventions Index](../00_index.md) | [Elixir Patterns](../../patterns/elixir/00_index.md) | [Elixir Testing](../../testing/elixir/00_index.md)
