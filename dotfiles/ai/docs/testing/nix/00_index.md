# Testing — Nix

> Nix expression tests, flake checks, NixOS VM tests, and home-manager module validation.

---

## Contents

| File | Description |
|------|-------------|
| [Guide](./guide.md) | Nix testing guide: flake checks, nixosTest VM tests, home-manager dry-run, expression evaluation tests, alejandra/statix/deadnix linting, CI pipeline |

---

## Quick Reference

- **Validate flake:** `nix flake check`
- **Format check:** `alejandra --check .`
- **Lint:** `statix check .`
- **VM test:** `nix build .#checks.x86_64-linux.module-test`

---

## Cross-References

→ [Testing Index](../00_index.md) | [Nix Patterns](../../patterns/nix/00_index.md) | [Nix Conventions](../../conventions/nix/00_index.md)
