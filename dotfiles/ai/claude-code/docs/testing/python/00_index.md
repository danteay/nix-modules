# Testing — Python

> Python test setup, patterns, and guides.

---

## Contents

| File | Description |
|------|-------------|
| [Guide](./guide.md) | Full Python testing guide: pytest setup, conftest fixtures, factories, AsyncMock, testcontainers + LocalStack, async context manager mocking, coverage config |

---

## Quick Reference

- **Test command:** `pytest`
- **Coverage:** `pytest --cov=src --cov-report=html`
- **Mocking:** `pytest-mock` (`mocker.create_autospec`)
- **Integration:** `testcontainers` + LocalStack

---

## Cross-References

→ [Testing Index](../00_index.md) | [Python Patterns — Testing](../../patterns/python/testing.md) | [Python Conventions](../../conventions/python/00_index.md)
