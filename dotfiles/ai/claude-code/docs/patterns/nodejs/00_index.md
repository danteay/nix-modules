# Patterns — Node.js

> Node.js-specific implementations of common patterns (ESM, streams, event loop).

---

## Contents

| File | Description |
|------|-------------|
| [Code](./code.md) | Constructor injection, domain classes with private fields, ESM named exports, error types, service config with zod, Lambda handler pattern |
| [Concurrency](./concurrency.md) | `Promise.all`/`allSettled`, `Semaphore` class, worker threads, Node.js streams with `pipeline`, async generators, SQS consumer |
| [Testing](./testing.md) | Jest / Node built-in test runner, `jest.fn()` mocks, factories, testcontainers + LocalStack, Lambda handler tests |

---

## Quick Reference

- **Modules:** ESM (`import`/`export`), prefix built-ins with `node:` (`node:fs`, `node:crypto`)
- **Config:** `zod.safeParse(process.env)` at startup — throw on invalid
- **CPU work:** `worker_threads` for blocking computation
- **Streams:** always use `pipeline` from `node:stream/promises`, not `.pipe()`

---

## Cross-References

→ [Patterns Index](../00_index.md) | [Node.js Conventions](../../conventions/nodejs/00_index.md) | [Node.js Testing](../../testing/nodejs/00_index.md) | [TypeScript Patterns](../typescript/00_index.md)
