# Patterns — Python

> Python-specific implementations of common patterns.

---

## Contents

| File | Description |
|------|-------------|
| [Code](./code.md) | Protocol interfaces, Pydantic v2 models, constructor injection via dataclass, service config, domain error hierarchy, Result type |
| [Concurrency](./concurrency.md) | `asyncio.gather`, `TaskGroup` (3.11+), `asyncio.Semaphore`, Queue-based worker pool, `ThreadPoolExecutor`, `asyncio.timeout` |
| [Testing](./testing.md) | pytest naming, `conftest.py` fixtures, `parametrize`, `mocker.create_autospec`, `AsyncMock`, factories, testcontainers |

---

## Quick Reference

- **Interfaces:** `Protocol` (structural subtyping, no inheritance needed)
- **Config:** `pydantic.BaseSettings`, validates at startup
- **Mocking:** `mocker.create_autospec(MyProtocol)` for typed mocks
- **Async concurrency limit:** `asyncio.Semaphore`

---

## Cross-References

→ [Patterns Index](../00_index.md) | [Python Conventions](../../conventions/python/00_index.md) | [Python Testing](../../testing/python/00_index.md)
