# Conventions — Python

> Python-specific coding standards: type hints, Pydantic, async, logging, and tooling.

---

## Contents

| File | Description |
|------|-------------|
| [Python Conventions](./index.md) | Full Python conventions: naming table, project structure, type hints with `from __future__ import annotations`, Pydantic v2 frozen models, Protocol, async patterns, structlog, ruff/mypy pyproject.toml config |

---

## Key Rules (Quick Reference)

- Type hints: always, use `from __future__ import annotations`, no bare `Any`
- Models: `pydantic.BaseModel` with `model_config = ConfigDict(frozen=True)`
- Interfaces: `Protocol` with `@runtime_checkable` for structural subtyping
- Async: `asyncio.TaskGroup` (3.11+) over `gather`, `asyncio.timeout` over `wait_for`
- Tooling: `ruff` for lint+format, `mypy --strict` for type checking

---

## Cross-References

→ [Conventions Index](../00_index.md) | [Python Patterns](../../patterns/python/00_index.md) | [Python Testing](../../testing/python/00_index.md)
