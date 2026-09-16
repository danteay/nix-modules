# Testing — Rust

> Rust test setup, patterns, and guides.

---

## Contents

| File | Description |
|------|-------------|
| [Guide](./guide.md) | Full Rust testing guide: cargo test setup, mockall, testcontainers + LocalStack, Tokio test utilities, HTTP handler tests, cargo-llvm-cov coverage |

---

## Quick Reference

- **Test command:** `cargo test`
- **Coverage:** `cargo llvm-cov --html`
- **Mocking:** `mockall` (`#[automock]`, `MockOrderRepository`)
- **Integration:** `testcontainers` crate + LocalStack

---

## Cross-References

→ [Testing Index](../00_index.md) | [Rust Patterns — Testing](../../patterns/rust/testing.md) | [Rust Conventions](../../conventions/rust/00_index.md)
