# Conventions — PKL

> PKL-specific coding standards: file organization, class design, constraints, stage files, and CI evaluation.

---

## Contents

| File | Description |
|------|-------------|
| [PKL Conventions](./index.md) | Full PKL conventions: when to use PKL, file organization, naming conventions, class design with doc comments and constraints, stage files (dev vs prod), amending/composability, evaluation workflow, CI validation, anti-patterns |

---

## Key Rules (Quick Reference)

- Every service config has a `base.pkl` (template) and per-env amend files (`dev.pkl`, `prod.pkl`)
- All secrets via `read("env:SECRET_NAME")` — never hardcoded
- Use typed constraints: `Int(isBetween(...))`, `String(startsWith(...))`, not bare primitives
- Validate in CI: `pkl eval config/*.pkl` as a required check
- Output: render to JSON/YAML at deploy time, commit rendered output for auditability

---

## Cross-References

→ [Conventions Index](../00_index.md) | [PKL Patterns](../../patterns/pkl/00_index.md) | [PKL Testing](../../testing/pkl/00_index.md) | [PKL Configuration Reference](../../reference/pkl-configuration.md)
