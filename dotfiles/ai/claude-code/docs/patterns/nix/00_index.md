# Patterns — Nix

> Nix-specific patterns for modules, overlays, dev shells, and flake composition.

---

## Contents

| File | Description |
|------|-------------|
| [Code](./code.md) | flake-parts module pattern, dev shell modules, overlay composition, home-manager module pattern, `listDirModules`, `lib.mkIf`/`lib.mkMerge`, reading external files, derivation pinning |

---

## Quick Reference

- **Flake structure:** use `flake-parts` — split into `perSystem`, `imports`, separate `.nix` files
- **Auto-import:** `listDirModules` discovers `.nix` files, skips `*.skip.nix`
- **Conditionals:** `lib.mkIf condition { ... }` not Nix `if`/`then`
- **Overlays:** `final: prev: { }` — use `prev` to get original, `final` for the full fixed-point

---

## Cross-References

→ [Patterns Index](../00_index.md) | [Nix Conventions](../../conventions/nix/00_index.md) | [Nix Testing](../../testing/nix/00_index.md) | [Dev Environment Guide](../../guides/dev-environment.md)
