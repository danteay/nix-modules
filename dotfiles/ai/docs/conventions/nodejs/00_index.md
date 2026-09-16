# Conventions — Node.js

> Node.js-specific coding standards: ESM modules, event loop, streams, async patterns, and tooling.

---

## Contents

| File | Description |
|------|-------------|
| [Node.js Conventions](./index.md) | Full Node.js conventions: ESM over CJS, `node:` built-in prefix, event loop awareness, streams with `pipeline`, async/await rules, error types, config with zod, graceful shutdown |

---

## Key Rules (Quick Reference)

- Modules: `"type": "module"` in `package.json`, prefix built-ins with `node:`
- No synchronous I/O (`fs.readFileSync`) outside startup/config
- CPU-bound work: `worker_threads`, never block the event loop
- Streams: always use `pipeline` from `node:stream/promises`
- Unhandled rejections: register `process.on('unhandledRejection', ...)` handler + exit

---

## Cross-References

→ [Conventions Index](../00_index.md) | [Node.js Patterns](../../patterns/nodejs/00_index.md) | [TypeScript Conventions](../typescript/00_index.md) | [Node.js Testing](../../testing/nodejs/00_index.md)
