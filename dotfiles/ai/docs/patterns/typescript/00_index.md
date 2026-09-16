# Patterns — TypeScript

> TypeScript-specific implementations of common patterns.

---

## Contents

| File | Description |
|------|-------------|
| [Code](./code.md) | Discriminated unions, branded types, Result type (`Ok`/`Err`), constructor injection, zod validation, domain error classes |
| [Concurrency](./concurrency.md) | `Promise.all`/`allSettled`, `Semaphore` class, worker pool, `AbortController` with timeout, async generators for DynamoDB scan |
| [Testing](./testing.md) | vitest `describe`/`it`, `MockedObject<T>`, spies vs mocks vs stubs, factories, testcontainers, Lambda handler tests, snapshots |

---

## Quick Reference

- **Type safety:** branded types with `unique symbol`, discriminated unions with exhaustive switch
- **Config:** `zod.parse(process.env)` at startup
- **Mocking:** `vi.fn()` + `MockedObject<T>` for typed mock objects
- **Async limit:** `Semaphore` class (permits-based)

---

## Cross-References

→ [Patterns Index](../00_index.md) | [TypeScript Conventions](../../conventions/typescript/00_index.md) | [TypeScript Testing](../../testing/typescript/00_index.md)
