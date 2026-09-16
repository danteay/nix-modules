# Conventions — Nix

> Nix-specific coding standards: flake-parts structure, module design, naming, and formatting.

---

## Contents

| File | Description |
|------|-------------|
| [Nix Conventions](./index.md) | Full Nix conventions: flake-parts structure, per-language dev shells, home-manager module pattern, naming conventions, `lib.mkIf`/`lib.mkMerge`/`lib.mkOption` patterns, overlays, formatting with alejandra |

---

## Key Rules (Quick Reference)

- Always use flakes — never `nix-channel` or `NIX_PATH`
- Use `flake-parts` for composable per-system configuration
- All tools in `nix develop` dev shells — no global installs
- Module options: use `lib.mkOption` with `type`, `default`, and `description`
- Format: `alejandra` (preferred) or `nixfmt`

---

## Cross-References

→ [Conventions Index](../00_index.md) | [Nix Patterns](../../patterns/nix/00_index.md) | [Nix Testing](../../testing/nix/00_index.md) | [Dev Environment Guide](../../guides/dev-environment.md)
