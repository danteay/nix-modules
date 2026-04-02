# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Purpose

Declarative macOS configuration management using Nix flakes, home-manager, and nix-darwin. Supports two user profiles (`danteay`, `draftea`) with shared global modules and profile-specific customizations.

## Key Commands

### Apply Configurations

```bash
# Apply home-manager config for current user
home-manager switch -b backup --impure --flake ~/.config/nix-modules/home-manager#$(whoami)

# Apply nix-darwin system config (macOS system packages, Homebrew)
cd ~/.config/nix-modules/nix-darwin && sudo nix --extra-experimental-features "nix-command flakes" run nix-darwin#darwin-rebuild -- switch --flake .#danteay

# Update flake inputs (lockfile)
cd ~/.config/nix-modules/home-manager && nix flake update
```

### Shortcuts (configured via home-manager)

```bash
hms          # home-manager switch (equivalent to the full command above)
hms-update   # home-manager switch + flake update
nix-clean    # garbage collect old generations
nds          # nix-darwin switch (available after nix-darwin install)
```

### Installation

```bash
sh install.sh                    # Install all components (Nix, home-manager, nix-darwin)
sh install.sh home_manager       # Install only home-manager
sh install.sh nix_darwin         # Install only nix-darwin
sh install_credentials.sh        # Sync secrets from 1Password (SSH keys, AWS creds, PEMs)
```

## Architecture

### Flake Structure

There are two separate flakes:

- **`home-manager/flake.nix`** — User environment (packages, dotfiles, shell). Uses nixos-25.11 stable with an unstable overlay for select tools. This is the primary flake you'll work with.
- **`nix-darwin/flake.nix`** — macOS system config (Homebrew casks/brews, system packages). Uses nixpkgs-unstable.

### Module Loading Order (home-manager)

For each profile, modules are applied in this order:
1. `home-manager/home.nix` — Base config for all users
2. `home-manager/global/*.nix` — Applied to every profile
3. `home-manager/profiles/<profile>/global/*.nix` — Profile-level globals
4. `home-manager/modules/**` — Shared reusable modules
5. `home-manager/profiles/<profile>/modules/*.nix` — Profile-specific modules
6. `home-manager/profiles/<profile>/custom/*.nix` — Parameterized custom modules

The flake uses `listDirModules` to auto-discover `.nix` files recursively. Files named `*.skip.nix` are excluded.

### Profile Customization

Each profile has a `custom/` subdirectory for parameterized modules:
- `custom/git.nix` — Git user name and email
- `custom/zsh.nix` — Shell init extras, theme config
- `custom/import-flakes.nix` (draftea only) — Organization-specific flake imports

Profile-specific modules go in `profiles/<profile>/modules/`. Shared reusable modules go in `home-manager/modules/`.

### Key Directories

| Path | Purpose |
|------|---------|
| `home-manager/global/` | Modules applied to all profiles (tools, shortcuts, git aliases, etc.) |
| `home-manager/modules/langs/` | Language environments: golang, nodejs, python, java |
| `home-manager/modules/npm/` | node2nix-generated reproducible NPM packages |
| `home-manager/profiles/danteay/` | Personal dev environment |
| `home-manager/profiles/draftea/` | Drafteame org environment (GOPRIVATE set) |
| `dotfiles/` | Source files linked by home-manager |
| `nix-darwin/configuration.nix` | Homebrew casks/brews + system packages |

### Adding a New Module

1. Create a `.nix` file in the appropriate directory (global, profile modules, or shared modules)
2. It will be auto-discovered by `listDirModules` — no manual import needed
3. For parameterized/shared modules, place in `home-manager/modules/` and import explicitly from profiles that need it

### Updating NPM Packages

The `home-manager/modules/npm/` directory uses node2nix for reproducible packages. To add/update:
1. Edit `packages.json`
2. Regenerate: `node2nix -i packages.json`

## Commit Style

Use conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`. Commitizen is installed globally.
