# Conventions — TypeScript

> TypeScript-specific coding standards: strict config, type system, async, logging, and tooling.

---

## Contents

| File | Description |
|------|-------------|
| [TypeScript Conventions](./index.md) | Full TS conventions: tsconfig strict flags, naming table, type system rules (never `any`, branded types), zod for external validation, error handling, named exports, async rules, pino logging, eslint strict config |

---

## Key Rules (Quick Reference)

- Config: `"strict": true` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`
- Never use `any` — use `unknown` + narrowing or `z.unknown()` from zod
- Branded types: `type OrderId = string & { readonly __brand: 'OrderId' }`
- External input: always validate with `zod` before use
- Exports: named exports only, no `export default`

---

## Cross-References

→ [Conventions Index](../00_index.md) | [TypeScript Patterns](../../patterns/typescript/00_index.md) | [TypeScript Testing](../../testing/typescript/00_index.md) | [Node.js Conventions](../nodejs/00_index.md)
