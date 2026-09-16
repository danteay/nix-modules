# Testing Index

> Testing strategies, setup guides, and language-specific test patterns.

---

## Structure

```
testing/
├── general/    Language-agnostic strategies and test pyramid
├── go/         Go testing with testify, mockery, testcontainers
├── python/     Python testing with pytest, factories, testcontainers
├── typescript/ TypeScript testing with vitest, testcontainers
├── rust/       Rust testing with mockall, testcontainers
├── elixir/     Elixir testing with ExUnit, Mox, ExMachina
├── nodejs/     Node.js testing with Jest / Node test runner
├── nix/        Nix expression tests, flake checks, nixosTest
└── pkl/        PKL validation, constraint tests, snapshot tests
```

---

## Language Guides

| Language | Entry Point |
|----------|-------------|
| General | [general/00_index.md](./general/00_index.md) |
| Go | [go/00_index.md](./go/00_index.md) |
| Python | [python/00_index.md](./python/00_index.md) |
| TypeScript | [typescript/00_index.md](./typescript/00_index.md) |
| Rust | [rust/00_index.md](./rust/00_index.md) |
| Elixir | [elixir/00_index.md](./elixir/00_index.md) |
| Node.js | [nodejs/00_index.md](./nodejs/00_index.md) |
| Nix | [nix/00_index.md](./nix/00_index.md) |
| PKL | [pkl/00_index.md](./pkl/00_index.md) |

---

## Cross-References

→ [Documentation Index](../00_index.md) | [Patterns](../patterns/00_index.md) | [Testing Strategies](./general/strategies.md)
