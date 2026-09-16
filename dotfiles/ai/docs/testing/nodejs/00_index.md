# Testing — Node.js

> Node.js test setup, patterns, and guides.

---

## Contents

| File | Description |
|------|-------------|
| [Guide](./guide.md) | Full Node.js testing guide: Jest / Node built-in test runner, unit tests, factories, testcontainers + LocalStack, Lambda handler tests, coverage config |

---

## Quick Reference

- **Test command:** `pnpm test` (Jest) or `node --test` (built-in)
- **Coverage:** `pnpm test -- --coverage`
- **Mocking:** `jest.fn()` / `jest.mock()`
- **Integration:** `testcontainers` + LocalStack

---

## Cross-References

→ [Testing Index](../00_index.md) | [Node.js Patterns — Testing](../../patterns/nodejs/testing.md) | [Node.js Conventions](../../conventions/nodejs/00_index.md)
