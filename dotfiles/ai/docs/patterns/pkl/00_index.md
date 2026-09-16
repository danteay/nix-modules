# Patterns — PKL

> PKL-specific patterns for schema composition, amending chains, and configuration templates.

---

## Contents

| File | Description |
|------|-------------|
| [Code](./code.md) | Base schema definition, class hierarchy, constraints, amending pattern (template → env), env var reading, listing/mapping patterns, module composition, output formats, anti-patterns |

---

## Quick Reference

- **Amending:** `amends "base.pkl"` — override specific fields per environment
- **Constraints:** `Int(isBetween(1024, 65535))`, `String(startsWith("https://"))`
- **Env vars:** `read("env:VAR_NAME")` (required) or `read?("env:VAR") ?? "default"` (optional)
- **Output:** `pkl eval --format json config/prod.pkl` → JSON for Go/Node.js consumption

---

## Cross-References

→ [Patterns Index](../00_index.md) | [PKL Conventions](../../conventions/pkl/00_index.md) | [PKL Testing](../../testing/pkl/00_index.md) | [PKL Configuration Reference](../../reference/pkl-configuration.md)
