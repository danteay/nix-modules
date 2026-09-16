# Conventions Index

> Per-language coding standards. Each language has its own subfolder. `general/` covers cross-language rules.

## Structure

```
conventions/
├── general/       Language-agnostic rules and pitfalls
├── go/            Go standards
├── python/        Python standards
├── typescript/    TypeScript standards
├── rust/          Rust standards
├── elixir/        Elixir/OTP standards
├── nodejs/        Node.js-specific standards
├── nix/           Nix flakes and home-manager
└── pkl/           PKL configuration language
```

## Language Conventions

| Language | Index | Key Topics |
|----------|-------|-----------|
| [Go](./go/index.md) | `go/index.md` | Naming, errors, interfaces, context, tracing, slog, golangci-lint |
| [Python](./python/index.md) | `python/index.md` | Type hints, Pydantic, Protocol, async, structlog, ruff/mypy |
| [TypeScript](./typescript/index.md) | `typescript/index.md` | strict TS, branded types, zod, async rules, pino, eslint |
| [Rust](./rust/index.md) | `rust/index.md` | Ownership, thiserror/anyhow, traits, tokio, tracing, clippy |
| [Elixir](./elixir/index.md) | `elixir/index.md` | Behaviours, OTP, pattern matching, with chains, Mox, credo |
| [Node.js](./nodejs/index.md) | `nodejs/index.md` | ESM, streams, event loop, async patterns, pino, zod |
| [Nix](./nix/index.md) | `nix/index.md` | flake-parts, dev shells, home-manager modules, overlays |
| [PKL](./pkl/index.md) | `pkl/index.md` | Class design, stage files, constraints, evaluation |

## General Conventions

| File | Contents |
|------|---------|
| [Common Pitfalls](./general/common-pitfalls.md) | Architecture, events, config, infrastructure anti-patterns |

## Non-Negotiable Rules (All Languages)

1. **Type safety** — no `any` / untyped structures in production code
2. **Explicit error handling** — no silent swallowing of errors
3. **Context/cancellation propagation** — pass it to all I/O operations
4. **Dependency injection** — wire at entry point, not inside business logic
5. **Latest stable versions** — use current LTS/stable releases
6. **Nix dev shells** — all tools via `nix develop`, no global installs
7. **PKL for config** — type-safe schemas, not raw YAML/JSON
8. **ejson for secrets** — encrypt at rest, never commit plaintext
