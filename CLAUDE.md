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

### Inspecting evaluation

```bash
# Evaluate without building — useful when refactoring the flake
nix --extra-experimental-features "nix-command flakes" eval --impure \
  ~/.config/nix-modules/home-manager#homeConfigurations.danteay.config.home.username --raw
```

## Architecture

### Flake structure

There are two independent flakes:

- **`home-manager/flake.nix`** — user environment (packages, dotfiles, shell). Uses `nixos-26.05` stable with an `unstable` overlay for select tools (`inetutils`, `direnv` build override). This is the primary flake you'll work with.
- **`nix-darwin/flake.nix`** — macOS system config (Homebrew casks/brews, system packages). Uses `nixpkgs-unstable`.

### Composition pipeline (home-manager)

`home-manager/flake.nix` is intentionally thin. It delegates discovery and composition to `home-manager/helpers/`:

- **`helpers/filesystem.nix`** — `listDirModules` (auto-discovers `*.nix` files in a dir, excluding `*.skip.nix`) and `listProfiles` (lists subdirectories).
- **`helpers/modules.nix`** — `makeCustomModule { path, config }` wraps a parameterized template file into a home-manager module.
- **`helpers/profiles.nix`** — the composer:
  - `collectGlobalModules profiles` — concatenates each profile's `global/*.nix`.
  - `loadUserModules profile` — reads `<profile>/default.nix` via `pkgs.callPackage`, expects `{ modules = [...]; }`.
  - `loadCustomTemplate { template, name, importArgs ? null }` — instantiates a template using config from `<profile>/custom/<name>.nix`. `importArgs = null` treats the profile file as a plain attrset; an attrset calls it as a function.
  - `loadProfileModule { name, importArgs ? {} }` — imports `<profile>/custom/<name>.nix` directly as a complete home-manager module.
  - `buildConfigurations { profiles, commonModules, profileGlobals, moduleSources }` — runs each `moduleSources` loader once per profile and produces the `homeConfigurations` attrset.

Per-profile module list resolves to:
1. `commonModules` — `home-manager/home.nix` ++ `home-manager/global/*.nix`
2. `profileGlobals` — `home-manager/profiles/<profile>/global/*.nix`
3. Output of every entry in `moduleSources` (`loadUserModules`, then the `loadCustomTemplate`/`loadProfileModule` entries listed in `flake.nix`)

`home-manager/modules/` is **not** auto-discovered. It contains parameterized templates (currently `custom/git.nix` and `custom/zsh.nix`) referenced explicitly by `loadCustomTemplate` calls in `flake.nix`.

### Profile customization

Each profile has a `custom/` subdirectory whose files feed the loaders in `moduleSources`:

- `custom/git.nix` — plain attrset; passed as config to `modules/custom/git.nix`.
- `custom/zsh.nix` — function `{ pkgs, ... }: { zshConfig = {...}; }`; passed as config to `modules/custom/zsh.nix`.
- `custom/import-flakes.nix` — function `{ system, ... }: <home-manager module>`; loaded directly via `loadProfileModule`.

#### Zsh template injection

`home-manager/modules/custom/zsh.nix` exposes one private API key — `zshConfig.initExtra`. Anything a profile sets there is **concatenated** between the template's shared shell init and the trailing `clear` statement. All other `zshConfig` keys (`shellAliases`, `oh-my-zsh.*`, etc.) follow `pkgs.lib.recursiveUpdate` override semantics.

The template strips `initExtra` from the merged config before assigning to `programs.zsh` — home-manager treats `programs.zsh.initExtra` as a deprecated alias that auto-appends to `initContent`, which would duplicate the profile content after `clear`.

Theme setup is owned by the profile: each profile's `custom/zsh.nix` injects its own theme source (p10k, etc.) via `initExtra`.

### Adding a new module

- **Global module (every profile gets it):** drop a `.nix` file in `home-manager/global/`. Auto-discovered.
- **Profile-scoped module:** drop a `.nix` file in `home-manager/profiles/<profile>/global/`. Auto-discovered for that profile only.
- **Reusable template referenced explicitly:** drop the template in `home-manager/modules/<category>/` and reference its path from the profile's `default.nix` `modules` list.
- **New per-profile custom slot (git/zsh-style):** add the template under `home-manager/modules/custom/<name>.nix`, then append one loader to `moduleSources` in `flake.nix`:
  ```nix
  (loadCustomTemplate { template = ./modules/custom/<name>.nix; name = "<name>"; importArgs = { inherit pkgs; }; })
  ```
  No changes to helpers required.

### Key directories

| Path | Purpose |
|------|---------|
| `home-manager/global/` | Auto-discovered modules applied to every profile |
| `home-manager/helpers/` | Composition helpers consumed by `flake.nix` |
| `home-manager/modules/custom/` | Parameterized templates instantiated per profile |
| `home-manager/profiles/danteay/` | Personal dev environment |
| `home-manager/profiles/draftea/` | Drafteame org environment (sets `GOPRIVATE`) |
| `dotfiles/` | Source files linked by home-manager |
| `nix-darwin/configuration.nix` | Homebrew casks/brews + system packages |

## Commit style

Use conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`. Commitizen is installed globally.
