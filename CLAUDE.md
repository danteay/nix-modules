# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a personal Nix configuration repository for managing system configurations across macOS using **nix-darwin** and **home-manager**. It provides declarative system and user environment management with multiple user profiles.

## Architecture

### Directory Structure

- **`nix-darwin/`**: macOS system-level configuration via nix-darwin (flake-based)
  - `flake.nix`: Nix-darwin flake configuration defining system configurations
  - `configuration.nix`: Main system configuration file
  - Manages Homebrew packages (brews and casks)
  - System-wide packages and settings

- **`home-manager/`**: User environment configurations using Nix flakes
  - `flake.nix`: Main flake defining inputs (nixpkgs, home-manager, custom flakes like `draft` and `taskrun`)
  - `home.nix`: Base home-manager configuration (username, packages, session variables)
  - `profiles/`: User-specific profiles (e.g., `danteay`, `draftea`)
  - `modules/`: Reusable configuration modules
    - `dev-tools/`: Development tools (containers, general tools, libyaml)
    - `langs/`: Language-specific configurations (golang, nodejs, python)
    - `custom/`: Custom modules for git, zsh, etc.
    - `npm/`: NPM package management
  - `global/`: Global modules applied to all profiles (apps, envs, git shortcuts, shortcuts, tools)

- **`dotfiles/`**: User-specific dotfiles organized by username
  - Contains profile-specific configuration files (SSH configs, scripts, etc.)

### Profile System

The flake.nix uses a profile-based architecture where:
- Each profile in `profiles/` directory gets its own home-manager configuration
- Profiles have a `default.nix` that specifies which modules to load
- Profiles can have custom configurations in `custom/` subdirectory (git.nix, zsh.nix, import-flakes.nix)
- Profiles can have profile-specific global modules in their `global/` subdirectory
- All profiles inherit from the base `home.nix` and general global modules

### Module Loading System

The flake implements custom utility functions:
- `listDirModules`: Recursively loads all `.nix` files from a directory (excludes `*.skip.nix` files)
- `listProfiles`: Discovers all profile directories
- `makeCustomModule`: Creates parameterized modules for git, zsh, etc.

### Nix-Darwin System Configuration

The nix-darwin flake uses a flake-based architecture:
- `flake.nix` defines inputs (nixpkgs, nix-darwin) and outputs (darwinConfigurations)
- Each configuration in `darwinConfigurations` represents a system setup (e.g., `danteay`)
- Configurations import `configuration.nix` which contains the actual system settings
- No system-level installation required - runs directly via `nix run nix-darwin#darwin-rebuild`
- Supports multiple machine configurations by adding more entries to `darwinConfigurations`

## Common Commands

### Initial Setup

```bash
# Clone repository
cd ~/.config
git clone https://github.com/danteay/nix-modules.git
cd nix-modules

# Install everything (Nix core, home-manager, nix-darwin)
sh install.sh

# Or install specific components
sh install.sh nix_core         # Install only Nix
sh install.sh home_manager     # Install only home-manager
sh install.sh nix_darwin       # Install only nix-darwin (macOS)
```

### Post-Installation

```bash
# Set up 1Password accounts and download credentials (SSH keys, AWS config, PEM files)
sh install_credentials.sh
```

### Home Manager

```bash
# Apply home-manager configuration for current user
home-manager switch -b backup --impure --flake ~/.config/nix-modules/home-manager#$(whoami)

# Apply configuration for specific profile
home-manager switch -b backup --impure --flake ~/.config/nix-modules/home-manager#danteay
home-manager switch -b backup --impure --flake ~/.config/nix-modules/home-manager#draftea

# Build without activating
home-manager build --flake ~/.config/nix-modules/home-manager#$(whoami)

# List generations
home-manager generations

# Rollback to previous generation
home-manager generations | head -n 2 | tail -n 1 | awk '{print $NF}' | xargs -I {} {}/activate
```

### Nix Darwin (macOS)

```bash
# Apply nix-darwin configuration using flakes
cd ~/.config/nix-modules/nix-darwin
sudo nix --extra-experimental-features "nix-command flakes" run nix-darwin#darwin-rebuild -- switch --flake .#danteay

# Or from anywhere using the install script
cd ~/.config/nix-modules
sh install.sh configure_darwin

# Build without activating
cd ~/.config/nix-modules/nix-darwin
nix build .#darwinConfigurations.danteay.system

# Show flake outputs
cd ~/.config/nix-modules/nix-darwin
nix flake show
```

### Flake Management

```bash
# Update home-manager flake inputs
cd ~/.config/nix-modules/home-manager
nix flake update

# Update specific input in home-manager
nix flake lock --update-input nixpkgs
nix flake lock --update-input draft
nix flake lock --update-input taskrun

# Update nix-darwin flake inputs
cd ~/.config/nix-modules/nix-darwin
nix flake update

# Update specific input in nix-darwin
nix flake lock --update-input nixpkgs
nix flake lock --update-input nix-darwin

# Show flake outputs
nix flake show
```

## Making Configuration Changes

### Adding a New Profile

1. Create directory: `home-manager/profiles/<username>/`
2. Create `default.nix` with module imports
3. Optionally create `custom/git.nix` and `custom/zsh.nix` for user-specific configs
4. Run: `home-manager switch -b backup --impure --flake ~/.config/nix-modules/home-manager#<username>`

### Adding Packages

**System-wide (macOS):**
- Edit `nix-darwin/configuration.nix`
- Add to `environment.systemPackages`, `homebrew.brews`, or `homebrew.casks`
- Run:
  ```bash
  cd ~/.config/nix-modules/nix-darwin
  sudo nix --extra-experimental-features "nix-command flakes" run nix-darwin#darwin-rebuild -- switch --flake .#danteay
  ```

**User-level:**
- Edit `home-manager/home.nix` for all users
- Or edit specific profile's `default.nix` to add profile-specific modules
- Run: `home-manager switch -b backup --impure --flake ~/.config/nix-modules/home-manager#$(whoami)`

### Creating New Modules

1. Create `.nix` file in appropriate `home-manager/modules/` subdirectory
2. Import in profile's `default.nix` or add to global modules
3. Modules should export Home Manager configuration using `{ config, pkgs, ... }:` pattern

### Adding a New Darwin System Configuration

To add a new system configuration (e.g., for a different machine):

1. Edit `nix-darwin/flake.nix`
2. Add new entry to `darwinConfigurations`:
   ```nix
   darwinConfigurations."new-machine" = nix-darwin.lib.darwinSystem {
     modules = [ ./configuration.nix ];
   };
   ```
3. Optionally create a separate configuration file (e.g., `configuration-new-machine.nix`)
4. Apply with: `sudo nix --extra-experimental-features "nix-command flakes" run nix-darwin#darwin-rebuild -- switch --flake .#new-machine`

## Important Notes

- **Flakes are enabled**: This repo uses experimental flakes feature for both home-manager and nix-darwin
- **Flake-based nix-darwin**: nix-darwin is NOT installed on the system. Instead, it runs directly from the flake using `nix run nix-darwin#darwin-rebuild`
- **No system symlinks**: The old approach of symlinking `/etc/nix-darwin/configuration.nix` is no longer used
- **Impure flag required**: Use `--impure` flag with home-manager commands due to system interactions
- **1Password integration**: `install_credentials.sh` downloads SSH keys, AWS credentials, and PEM files from 1Password vaults
- **Homebrew auto-management**: nix-darwin configuration auto-updates and cleans up Homebrew packages on activation
- **Unstable packages**: The flake overlays Go and go-mockery from nixpkgs-unstable
- **Custom flakes**: Includes custom flakes `draft` and `taskrun` from Drafteame GitHub organization
- **Profile-specific darwin configs**: The nix-darwin flake defines configurations per user (currently `danteay`)
