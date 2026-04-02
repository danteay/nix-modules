# Testing — PKL

> PKL schema validation, constraint tests, snapshot testing, and CI integration.

---

## Contents

| File | Description |
|------|-------------|
| [Guide](./guide.md) | PKL testing guide: pkl eval validation, constraint violation fixtures, snapshot testing with diff, Nix flake checks for PKL, CI pipeline |

---

## Quick Reference

- **Validate:** `pkl eval config/*.pkl`
- **Render:** `pkl eval --format json config/prod.pkl`
- **Constraint check:** `pkl eval tests/fixtures/invalid-port.pkl` (should fail)
- **Snapshot diff:** compare `pkl eval` output against committed snapshots

---

## Cross-References

→ [Testing Index](../00_index.md) | [PKL Patterns](../../patterns/pkl/00_index.md) | [PKL Conventions](../../conventions/pkl/00_index.md) | [PKL Configuration Reference](../../reference/pkl-configuration.md)
