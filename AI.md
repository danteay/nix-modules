# Nix Modules Configuration Repository

**Document Type**: AI Assistant Reference Guide
**Repository Type**: Personal Nix Configuration Management
**Primary Technologies**: Nix, home-manager, nix-darwin
**Target Platform**: macOS
**Last Updated**: 2026-01-26

---

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [Repository Overview](#repository-overview)
3. [Key Concepts](#key-concepts)
4. [Directory Structure](#directory-structure)
5. [Available Profiles](#available-profiles)
6. [Module System](#module-system)
7. [Common Commands](#common-commands)
8. [Configuration Changes Guide](#configuration-changes-guide)
9. [Flake Dependencies](#flake-dependencies)
10. [Architectural Patterns](#architectural-patterns)
11. [Important Notes](#important-notes)

---

## Quick Reference

### Repository Location

```
/Users/danteay/.config/nix-modules/
```

### Primary Commands

| Action | Command |
|--------|---------|
| Apply home-manager config | `home-manager switch -b backup --impure --flake ~/.config/nix-modules/home-manager#$(whoami)` |
| Apply nix-darwin config | `cd ~/.config/nix-modules/nix-darwin && sudo nix --extra-experimental-features "nix-command flakes" run nix-darwin#darwin-rebuild -- switch --flake .#danteay` |
| Update flake inputs | `cd ~/.config/nix-modules/home-manager && nix flake update` |
| List generations | `home-manager generations` |
| Install everything | `sh install.sh` |

### Available Profiles

| Profile | Purpose | User |
|---------|---------|------|
| `danteay` | Personal development environment | Eduardo Aguilar |
| `draftea` | Drafteame organization work | Organization user |

### Key Files

| File | Purpose |
|------|---------|
| `home-manager/flake.nix` | Main flake with profile configurations |
| `home-manager/home.nix` | Base configuration for all profiles |
| `nix-darwin/configuration.nix` | macOS system configuration |
| `install.sh` | Installation script for all components |
| `install_credentials.sh` | 1Password credentials setup |

---

## Repository Overview

### What This Repository Does

This is a **declarative configuration management system** for macOS using:

- **nix-darwin**: System-level configuration (Homebrew, system packages, system settings)
- **home-manager**: User environment configuration (dotfiles, user packages, shell setup)
- **Nix flakes**: Reproducible dependency management

### Main Features

1. **Multi-profile support**: Multiple independent user environments in a single repository
2. **Declarative configuration**: All system and user settings defined in Nix
3. **Reproducible environments**: Flake locks ensure consistent package versions
4. **Modular architecture**: Reusable modules organized by function
5. **Claude Code integration**: AI assistant configuration included
6. **1Password integration**: Automated credential management

---

## Key Concepts

### What is Nix?

Nix is a **declarative package manager** that ensures:
- Reproducible builds
- Isolated environments
- Atomic upgrades and rollbacks
- No dependency conflicts

### What is home-manager?

**home-manager** manages user-specific configuration:
- Dotfiles (`.bashrc`, `.zshrc`, etc.)
- User packages
- User services
- Application configurations

### What is nix-darwin?

**nix-darwin** manages macOS system-level configuration:
- System packages
- Homebrew packages (brews and casks)
- System settings and preferences
- Launch agents and daemons

### What are Flakes?

**Flakes** are a Nix feature providing:
- Reproducible dependencies (via `flake.lock`)
- Standardized project structure
- Composable configurations
- Version pinning

### Profile System

A **profile** is a complete user environment configuration:
- Each profile has its own module set
- Profiles share common base configuration
- Profiles can have custom settings (git, zsh, etc.)
- Multiple profiles can coexist in the same repository

---

## Directory Structure

### High-Level Layout

```
nix-modules/
├── dotfiles/           # User-specific configuration files
├── home-manager/       # User environment (flake-based)
└── nix-darwin/         # System configuration (flake-based)
```

### Detailed Structure

```
/Users/danteay/.config/nix-modules/
│
├── AI.md                           # This file - AI assistant reference
├── README.md                       # User-facing installation guide
├── LICENSE                         # GNU License
├── install.sh                      # Main installation script
├── install_credentials.sh          # 1Password credential downloader
│
├── dotfiles/                       # User-specific dotfiles
│   ├── ai/
│   │   └── claude-code/            # Claude Code AI assistant config
│   │       ├── agents/             # Custom agents (4 agents)
│   │       ├── rules/              # Coding rules (3 rule files)
│   │       ├── skills/             # Custom skills (4 skills)
│   │       └── settings/           # Claude Code settings
│   ├── danteay/                    # danteay profile dotfiles
│   └── draftea/                    # draftea profile dotfiles
│
├── home-manager/                   # User environment configuration
│   ├── flake.nix                   # Main flake definition
│   ├── flake.lock                  # Locked dependency versions
│   ├── home.nix                    # Base configuration (all profiles)
│   │
│   ├── global/                     # Modules for ALL profiles
│   │   ├── apps.nix                # User applications
│   │   ├── claude-code.nix         # Claude Code setup
│   │   ├── envs.nix                # Environment variables
│   │   ├── git-shortcuts.nix       # 26+ git commands
│   │   ├── npm.nix                 # Global NPM packages
│   │   ├── shortcuts.nix           # Utility shortcuts
│   │   └── tools.nix               # CLI tools
│   │
│   ├── modules/                    # Shared reusable modules
│   │   ├── custom/                 # Parameterized modules
│   │   │   ├── git.nix             # Git config module
│   │   │   └── zsh.nix             # Zsh + P10K theme
│   │   ├── derivations/            # Custom package builds
│   │   │   ├── go-migrate.nix      # DB migration tool
│   │   │   └── pkl.nix             # Picklang language
│   │   ├── dev-tools/              # Development tools
│   │   │   ├── containers.nix      # Docker/compose
│   │   │   ├── general.nix         # General dev tools
│   │   │   └── libyaml.nix         # YAML tools
│   │   ├── langs/                  # Language environments
│   │   │   ├── golang.nix          # Go environment
│   │   │   ├── nodejs.nix          # Node.js environment
│   │   │   ├── python.nix          # Python environment
│   │   │   └── java.nix            # Java environment
│   │   └── npm/                    # NPM package management
│   │       ├── default.nix         # Node2nix generated
│   │       ├── node-packages.nix   # Generated packages
│   │       ├── node-env.nix        # Node environment
│   │       └── packages.json       # Source package list
│   │
│   └── profiles/                   # User-specific profiles
│       │
│       ├── danteay/                # Personal dev profile
│       │   ├── default.nix         # Module imports
│       │   ├── custom/             # Custom configurations
│       │   │   ├── git.nix         # Git user/email
│       │   │   └── zsh.nix         # Shell config
│       │   ├── global/             # Profile-specific globals (11 files)
│       │   │   ├── docker-shortcuts.nix
│       │   │   ├── helix.nix
│       │   │   ├── nix-your-shell.nix
│       │   │   ├── node2nix.nix
│       │   │   ├── scripts.nix
│       │   │   ├── shortcuts.nix
│       │   │   ├── ssh.nix
│       │   │   ├── zsh-agnoster.nix
│       │   │   └── zsh-powerlevel10k.nix
│       │   └── modules/            # Profile-specific modules
│       │       ├── localstack/     # LocalStack config
│       │       └── dev-tools/      # Custom dev tools
│       │
│       └── draftea/                # Organization profile
│           ├── default.nix         # Module imports
│           ├── custom/             # Custom configurations
│           │   ├── import-flakes.nix # Draft/taskrun imports
│           │   └── zsh.nix         # Shell config
│           └── modules/            # Profile-specific modules
│               ├── dev-tools/      # Org dev tools
│               ├── draft-cli/      # Draft CLI
│               ├── env-vars/       # Environment vars
│               ├── npm/            # Org NPM packages
│               ├── pems/           # Certificates
│               └── shortcuts/      # SSH shortcuts
│
└── nix-darwin/                     # macOS system config
    ├── flake.nix                   # System flake
    ├── flake.lock                  # Locked dependencies
    └── configuration.nix           # System settings + Homebrew
```

### Directory Purpose Summary

| Directory | Purpose | Scope |
|-----------|---------|-------|
| `dotfiles/` | User-specific files (SSH configs, scripts, etc.) | Per-user |
| `home-manager/global/` | Modules applied to all profiles | All profiles |
| `home-manager/modules/` | Reusable shared modules | All profiles |
| `home-manager/profiles/` | Profile-specific configurations | Per-profile |
| `nix-darwin/` | macOS system-level configuration | System-wide |

---

## Available Profiles

### Profile: danteay

**Purpose**: Personal software development environment

| Attribute | Value |
|-----------|-------|
| **User** | Eduardo Aguilar |
| **Git Config** | Eduardo Aguilar (user/email) |
| **Shell Theme** | Powerlevel10k |
| **Main Focus** | Personal development, LocalStack, AWS tools |

**Installed Packages**:

- **Languages**: Go (with tools), Node.js 22, Python 3.13
- **Dev Tools**: Docker, docker-compose, commitizen, pre-commit, husky
- **AWS Tools**: awscli2, ejson, pkl
- **Database**: go-migrate v4.18.3
- **Testing**: LocalStack with Terraform Local
- **NPM Packages**: `@egcli/lr`, `serverless-3.40.0` (pinned)

**Special Features**:

- 11 profile-specific global modules
- Docker shortcuts
- Helix editor configuration
- LocalStack integration
- Custom shell aliases

### Profile: draftea

**Purpose**: Drafteame organization development environment

| Attribute | Value |
|-----------|-------|
| **Organization** | Drafteame |
| **Environment** | `GOPRIVATE=github.com/Drafteame` |
| **Shell Theme** | Powerlevel10k |
| **Main Focus** | Organization work, Draft CLI, internal tools |

**Installed Packages**:

- **Languages**: Go, Node.js 22, Python 3.13
- **Dev Tools**: Docker, docker-compose, commitizen
- **Custom Flakes**: `draft`, `taskrun` (from Drafteame GitHub)
- **NPM Packages**: `json-keys-diff`
- **CLI Tools**: Draft CLI with configuration

**Special Features**:

- Custom flake imports (draft, taskrun)
- SSH bastion aliases (prod/dev)
- Certificate management (PEMs)
- Organization-specific environment variables

---

## Module System

### Module Categories

| Category | Location | Purpose | Examples |
|----------|----------|---------|----------|
| **Global** | `home-manager/global/` | Applied to all profiles | git shortcuts, CLI tools |
| **Shared** | `home-manager/modules/` | Reusable across profiles | language configs, dev tools |
| **Profile Global** | `profiles/<user>/global/` | Profile-specific globals | SSH config, custom shortcuts |
| **Profile Modules** | `profiles/<user>/modules/` | Profile-only modules | LocalStack, Draft CLI |
| **Custom Config** | `profiles/<user>/custom/` | Profile overrides | git.nix, zsh.nix |

### Module Loading Order

The configuration is built in layers:

1. **Base Layer**: `home.nix` (common to all profiles)
2. **General Global**: `home-manager/global/*.nix`
3. **Profile Global**: `profiles/<user>/global/*.nix`
4. **Shared Modules**: `home-manager/modules/` (explicitly imported)
5. **Profile Modules**: `profiles/<user>/modules/*.nix`
6. **Custom Config**: `profiles/<user>/custom/*.nix`

### Utility Functions

The flake implements custom utility functions:

| Function | Purpose | Usage |
|----------|---------|-------|
| `listDirModules` | Recursively loads all `.nix` files from a directory | Auto-discovers modules |
| `listProfiles` | Discovers all profile directories | Auto-discovers profiles |
| `makeCustomModule` | Creates parameterized modules | Git, Zsh customization |

**Important**: Files ending in `*.skip.nix` are excluded from automatic loading.

### Global Modules Reference

#### Applied to All Profiles (`home-manager/global/`)

| Module | Purpose | Provides |
|--------|---------|----------|
| `apps.nix` | User applications | homebank |
| `claude-code.nix` | AI assistant setup | Claude Code configuration |
| `envs.nix` | Environment variables | $HOME_MANAGER_HOME |
| `git-shortcuts.nix` | Git helper commands | 26+ git aliases (rmb, newb, useb, etc.) |
| `npm.nix` | Global NPM packages | @egcli/lr, serverless |
| `shortcuts.nix` | Utility commands | hms, hms-update, nix-clean, kill-port |
| `tools.nix` | CLI utilities | fd, ripgrep, fzf, jq, yq-go, bat, direnv |

### Shared Modules Reference

#### Development Tools (`modules/dev-tools/`)

| Module | Provides |
|--------|----------|
| `containers.nix` | Docker, docker-compose |
| `general.nix` | node2nix, commitizen, pre-commit, husky |
| `libyaml.nix` | YAML handling tools |

#### Language Configurations (`modules/langs/`)

| Module | Provides | Environment Variables |
|--------|----------|----------------------|
| `golang.nix` | Go, gotools, mage, revive, golangci-lint, graphviz | GOROOT, GOPATH |
| `nodejs.nix` | Node.js 22, mocha | - |
| `python.nix` | Python 3.13, poetry, uv | - |
| `java.nix` | Java development environment | - |

#### Custom Modules (`modules/custom/`)

| Module | Purpose | Features |
|--------|---------|----------|
| `git.nix` | Git configuration | Recursive merge of profile-specific config |
| `zsh.nix` | Shell configuration | Powerlevel10k theme, auto-sources `.envs/` |

#### Custom Derivations (`modules/derivations/`)

| Module | Package | Version | Platforms |
|--------|---------|---------|-----------|
| `go-migrate.nix` | Database migration tool | v4.18.3 | Multi-platform |
| `pkl.nix` | Picklang config language | Latest | Multi-platform |

---

## Common Commands

### Initial Setup

#### Install Everything

```bash
# Clone repository
cd ~/.config
git clone https://github.com/danteay/nix-modules.git
cd nix-modules

# Install Nix core + home-manager + nix-darwin
sh install.sh
```

#### Install Specific Components

```bash
# Install only Nix
sh install.sh nix_core

# Install only home-manager
sh install.sh home_manager

# Install only nix-darwin (macOS)
sh install.sh nix_darwin
```

#### Post-Installation Setup

```bash
# Download credentials from 1Password (SSH keys, AWS config, PEM files)
sh install_credentials.sh
```

### Home Manager Operations

#### Apply Configuration

```bash
# Apply for current user
home-manager switch -b backup --impure --flake ~/.config/nix-modules/home-manager#$(whoami)

# Apply for specific profile
home-manager switch -b backup --impure --flake ~/.config/nix-modules/home-manager#danteay
home-manager switch -b backup --impure --flake ~/.config/nix-modules/home-manager#draftea
```

#### Build Without Activating

```bash
home-manager build --flake ~/.config/nix-modules/home-manager#$(whoami)
```

#### Rollback

```bash
# List all generations
home-manager generations

# Rollback to previous generation
home-manager generations | head -n 2 | tail -n 1 | awk '{print $NF}' | xargs -I {} {}/activate
```

### Nix Darwin Operations (macOS)

#### Apply System Configuration

```bash
# From nix-darwin directory
cd ~/.config/nix-modules/nix-darwin
sudo nix --extra-experimental-features "nix-command flakes" run nix-darwin#darwin-rebuild -- switch --flake .#danteay

# Or from anywhere using install script
cd ~/.config/nix-modules
sh install.sh configure_darwin
```

#### Build Without Activating

```bash
cd ~/.config/nix-modules/nix-darwin
nix build .#darwinConfigurations.danteay.system
```

#### Show Flake Outputs

```bash
cd ~/.config/nix-modules/nix-darwin
nix flake show
```

### Flake Management

#### Update All Inputs

```bash
# Update home-manager flake inputs
cd ~/.config/nix-modules/home-manager
nix flake update

# Update nix-darwin flake inputs
cd ~/.config/nix-modules/nix-darwin
nix flake update
```

#### Update Specific Input

```bash
# Home Manager
cd ~/.config/nix-modules/home-manager
nix flake lock --update-input nixpkgs
nix flake lock --update-input draft
nix flake lock --update-input taskrun

# Nix Darwin
cd ~/.config/nix-modules/nix-darwin
nix flake lock --update-input nixpkgs
nix flake lock --update-input nix-darwin
```

#### Show Flake Outputs

```bash
# From home-manager or nix-darwin directory
nix flake show
```

---

## Configuration Changes Guide

### Adding a New Profile

**Steps**:

1. Create profile directory: `home-manager/profiles/<username>/`
2. Create `default.nix` with module imports
3. (Optional) Create `custom/git.nix` for git user/email
4. (Optional) Create `custom/zsh.nix` for shell customization
5. Apply configuration

**Example**:

```bash
mkdir -p home-manager/profiles/newuser/{custom,global,modules}
touch home-manager/profiles/newuser/default.nix
# Edit default.nix to import desired modules
home-manager switch -b backup --impure --flake ~/.config/nix-modules/home-manager#newuser
```

### Adding System-Wide Packages (macOS)

**Location**: `nix-darwin/configuration.nix`

**Steps**:

1. Edit `nix-darwin/configuration.nix`
2. Add to appropriate section:
   - `environment.systemPackages` for Nix packages
   - `homebrew.brews` for Homebrew formulas
   - `homebrew.casks` for Homebrew casks
3. Apply configuration

**Example**:

```bash
cd ~/.config/nix-modules/nix-darwin
# Edit configuration.nix
sudo nix --extra-experimental-features "nix-command flakes" run nix-darwin#darwin-rebuild -- switch --flake .#danteay
```

### Adding User-Level Packages

**Location**: `home-manager/home.nix` (all users) or profile-specific

**Steps**:

1. **For all users**: Edit `home-manager/home.nix`
2. **For specific profile**: Edit `home-manager/profiles/<user>/default.nix`
3. Add package to `home.packages = [ pkgs.packagename ];`
4. Apply configuration

**Example**:

```bash
# Edit home.nix or profile default.nix
home-manager switch -b backup --impure --flake ~/.config/nix-modules/home-manager#$(whoami)
```

### Creating New Modules

**Steps**:

1. Create `.nix` file in appropriate `home-manager/modules/` subdirectory
2. Export Home Manager configuration: `{ config, pkgs, ... }: { ... }`
3. Import in profile's `default.nix` or add to global modules
4. (Optional) Use `*.skip.nix` suffix to exclude from automatic loading

**Module Template**:

```nix
{ config, pkgs, ... }:

{
  # Your configuration here
  home.packages = with pkgs; [
    # packages
  ];

  programs.myprogram = {
    enable = true;
    # settings
  };
}
```

### Managing NPM Packages

**Tool**: node2nix (for reproducibility)

**Steps**:

1. Navigate to profile's npm module: `home-manager/profiles/<user>/modules/npm/`
2. Edit `packages.json` to add/remove packages
3. Regenerate with node2nix:

```bash
cd home-manager/profiles/<user>/modules/npm
node2nix -i packages.json
```

4. Rebuild home-manager

**Current NPM Packages**:

| Profile | Packages |
|---------|----------|
| danteay | `@egcli/lr`, `serverless-3.40.0` |
| draftea | `json-keys-diff` |

### Managing Environment Variables

**Location**: `~/.config/nix-modules/dotfiles/<username>/.envs/`

**How It Works**:

- Files in `.envs/` directory are automatically sourced by zsh on shell initialization
- Each profile's zsh configuration auto-sources all files from this directory
- Use for profile-specific environment variables, API keys, shell configuration

**Steps**:

1. Create file in `dotfiles/<username>/.envs/`
2. Add environment variable exports
3. Reload shell or restart terminal

**Example**:

```bash
# Create environment file
echo 'export MY_VAR="value"' > dotfiles/danteay/.envs/custom.env

# Reload shell
exec zsh
```

### Adding a New Darwin System Configuration

**Use Case**: Different machine or configuration

**Steps**:

1. Edit `nix-darwin/flake.nix`
2. Add new entry to `darwinConfigurations`:

```nix
darwinConfigurations."new-machine" = nix-darwin.lib.darwinSystem {
  modules = [ ./configuration.nix ];
};
```

3. (Optional) Create separate configuration file: `configuration-new-machine.nix`
4. Apply with:

```bash
sudo nix --extra-experimental-features "nix-command flakes" run nix-darwin#darwin-rebuild -- switch --flake .#new-machine
```

---

## Flake Dependencies

### Home Manager Flake Inputs

| Input | Source | Version/Branch | Purpose |
|-------|--------|----------------|---------|
| `nixpkgs` | NixOS/nixpkgs | Release 25.05 (stable) | Base package set |
| `unstable-pkgs` | NixOS/nixpkgs | unstable | Bleeding-edge packages |
| `home-manager` | nix-community/home-manager | Latest | User environment manager |
| `draft` | Drafteame/draft | Latest | Drafteame custom flake |
| `taskrun` | Drafteame/taskrun | Latest | Drafteame task runner |

**Overlays**:

- Go: overlaid from `unstable-pkgs` (latest version)
- go-mockery: overlaid from `unstable-pkgs` (latest version)

**Follows Pattern**:

- `home-manager` follows main `nixpkgs`
- `draft` follows main `nixpkgs`
- `taskrun` follows main `nixpkgs`

This ensures no conflicting dependencies.

### Nix Darwin Flake Inputs

| Input | Source | Version/Branch | Purpose |
|-------|--------|----------------|---------|
| `nixpkgs` | NixOS/nixpkgs | unstable | System packages |
| `nix-darwin` | LnL7/nix-darwin | master | macOS configuration |

**System State Version**: 6

---

## Architectural Patterns

### Design Philosophy

| Principle | Implementation |
|-----------|----------------|
| **Separation of Concerns** | Base config, global modules, and profile-specific modules clearly separated |
| **Modularity** | Each module focuses on a single domain (language, tool category, config) |
| **Reusability** | Common modules shared across profiles, profile-specific overrides when needed |
| **Reproducibility** | Flake locks, node2nix, explicit versioning ensure consistent environments |
| **Flexibility** | Profile system allows completely different user environments from single codebase |

### Configuration Flow

```
1. Base Layer (home.nix)
   ↓
2. General Global Modules (home-manager/global/*.nix)
   ↓
3. Profile Global Modules (profiles/<user>/global/*.nix)
   ↓
4. Shared Modules (home-manager/modules/*)
   ↓
5. Profile-Specific Modules (profiles/<user>/modules/*.nix)
   ↓
6. Custom Config (profiles/<user>/custom/*.nix)
   ↓
7. Final Configuration
```

### Module Loading Pattern

```nix
# Nix code showing automatic module discovery
(listDirModules ./global)                      # General global modules
++ (listDirModules "${profilePath}/global")    # Profile global modules
++ commonModules                                # Explicitly defined shared modules
++ (listDirModules "${profilePath}/modules")   # Profile-specific modules
++ customModules                                # Parameterized modules (git, zsh)
```

**Key Features**:

- Automatic discovery via `listDirModules`
- Files ending in `*.skip.nix` are excluded
- Recursive directory scanning
- Parameterized module support

### Best Practices

| Practice | Rationale | Implementation |
|----------|-----------|----------------|
| **Use skip pattern** | Exclude work-in-progress modules | Name files `*.skip.nix` |
| **Keep modules focused** | Single responsibility principle | One domain per module |
| **Profile-specific in profile** | Avoid polluting global modules | Use profile directories |
| **Overlay for version pinning** | Get latest versions when needed | Overlay unstable packages |
| **Node2nix for NPM** | Reproducible NPM packages | Never install globally |
| **Environment files in .envs/** | Automatic sourcing | Use `.envs/` directory |
| **Test before committing** | Avoid breaking changes | Run `home-manager switch` first |

---

## Important Notes

### Core Architecture

| Feature | Details |
|---------|---------|
| **Flakes Enabled** | Experimental flakes feature used for both home-manager and nix-darwin |
| **Flake-Based nix-darwin** | NOT installed system-wide; runs via `nix run nix-darwin#darwin-rebuild` |
| **No System Symlinks** | Old `/etc/nix-darwin/configuration.nix` approach not used |
| **Impure Flag Required** | Use `--impure` with home-manager commands due to system interactions |

### Package Management

| Strategy | Implementation |
|----------|----------------|
| **Mixed Versioning** | Base on nixpkgs 25.05 (stable) with unstable overlay |
| **Unstable Overlays** | Go and go-mockery from nixpkgs-unstable |
| **Node2nix Integration** | Profile-specific NPM packages via node2nix |
| **Homebrew Auto-Management** | Nix-darwin auto-updates and cleans up Homebrew (28+ apps) |
| **Custom Derivations** | go-migrate v4.18.3, pkl with multi-platform support |

### Profile Features

| Feature | Details |
|---------|---------|
| **Multi-Profile Support** | Single flake, completely independent user environments |
| **Profile-Specific Globals** | Each profile can have its own global modules directory |
| **Custom Flakes** | Includes `draft` and `taskrun` from Drafteame GitHub |
| **Flake Follows Pattern** | Custom flakes follow main nixpkgs (avoid conflicts) |

### Development Tools

| Tool | Purpose |
|------|---------|
| **Claude Code** | AI assistant with agents, skills, rules in `dotfiles/ai/claude-code/` |
| **1Password** | `install_credentials.sh` downloads SSH keys, AWS creds, PEM files |
| **Environment Files** | Auto-sourcing of `.envs/` directory for profile-specific vars |
| **Git Shortcuts** | 26+ helper commands (rmb, branch, rebase-c, newb, useb, etc.) |
| **Darwin Configs** | Per-user system configurations (currently: danteay) |

### Module System Features

| Feature | Details |
|---------|---------|
| **Recursive Loading** | `listDirModules` auto-discovers and loads all `.nix` files |
| **Skip Pattern** | Files ending in `*.skip.nix` excluded from auto-loading |
| **Parameterized Modules** | Git and zsh modules support profile customization via `makeCustomModule` |
| **Organized by Category** | Modules grouped: dev-tools, langs, custom, derivations |

### Claude Code Integration

**Location**: `dotfiles/ai/claude-code/`

**Available Agents**:

| Agent | Expertise |
|-------|-----------|
| `nix-expert` | Nix, home-manager, nix-darwin |
| `golang-expert` | Go programming |
| `devops-expert` | Infrastructure and DevOps |
| `senior-software-architect` | System design and architecture |

**Available Skills**:

| Skill | Function |
|-------|----------|
| `/nix-rebuild` | Rebuild home-manager or nix-darwin configurations |
| `/nix-search` | Search for packages in nixpkgs |
| `/git-cleanup` | Clean up merged and stale Git branches |
| `/go-test-coverage` | Run Go tests with coverage analysis |

**Rules Applied**:

- **Coding Standards**: Testing, documentation, commit conventions
- **Nix Conventions**: File organization, flake best practices
- **Security Rules**: Secrets management, OWASP best practices

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| "Flakes not enabled" error | Add `--extra-experimental-features "nix-command flakes"` to command |
| Home-manager activation fails | Use `--impure` flag with `home-manager switch` |
| Permission denied during darwin rebuild | Run with `sudo` and ensure user has admin rights |
| Module not loading | Check file doesn't end in `.skip.nix` |
| Conflicting package versions | Run `nix flake update` to refresh lock file |

### Useful Debugging Commands

```bash
# Check flake inputs
nix flake metadata

# Check flake configuration
nix flake show

# Validate flake syntax
nix flake check

# Show what will be built
home-manager build --flake ~/.config/nix-modules/home-manager#$(whoami) --dry-run

# View detailed error messages
home-manager switch --show-trace --flake ~/.config/nix-modules/home-manager#$(whoami)
```

---

## Additional Resources

### Related Documentation

- [Nix Manual](https://nixos.org/manual/nix/stable/)
- [Home Manager Manual](https://nix-community.github.io/home-manager/)
- [Nix-Darwin Manual](https://daiderd.com/nix-darwin/manual/)
- [Nix Flakes](https://nixos.wiki/wiki/Flakes)

### Repository Links

- **Repository**: https://github.com/danteay/nix-modules
- **Drafteame Draft Flake**: https://github.com/Drafteame/draft
- **Drafteame Taskrun Flake**: https://github.com/Drafteame/taskrun

---

**End of AI Assistant Reference Guide**
