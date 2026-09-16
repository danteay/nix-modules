# Conventions — Rust

> Rust-specific coding standards: naming, ownership, error handling, async, logging, and tooling.

---

## Contents

| File | Description |
|------|-------------|
| [Rust Conventions](./index.md) | Full Rust conventions: naming table, project structure, error handling (thiserror/anyhow), ownership rules, traits as ports, tokio async patterns, tracing structured logging, clippy config |

---

## Key Rules (Quick Reference)

- Errors: `thiserror` for typed domain errors, `anyhow` in binary entry points
- Never `unwrap()`/`expect()` in production — use `?` and `.context()`
- Traits: `Send + Sync` bounds on trait objects used in async contexts
- Async: `tokio::sync` (not `std::sync`) for mutexes in async code
- Linting: `clippy::pedantic` + `unwrap_used = "deny"` + `expect_used = "deny"`

---

## Cross-References

→ [Conventions Index](../00_index.md) | [Rust Patterns](../../patterns/rust/00_index.md) | [Rust Testing](../../testing/rust/00_index.md)
