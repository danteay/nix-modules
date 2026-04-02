# Dev Environment Guide

> Nix + flake-parts dev shells for consistent, reproducible development environments.

## Philosophy

- **No global tool installation** — all tools provided via `nix develop`
- **Reproducible** — `flake.lock` pins exact versions; everyone gets the same environment
- **Per-project** — each project has its own dev shell; no version conflicts
- **direnv integration** — shell activates automatically on `cd` into project directory

---

## Quick Start

```bash
# Enter dev shell manually
nix develop

# With direnv (automatic activation)
echo "use flake" > .envrc
direnv allow
```

---

## Standard flake.nix (flake-parts)

```nix
{
  description = "My Service";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-25.11";
    flake-parts.url = "github:hercules-ci/flake-parts";
  };

  outputs = inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [ "aarch64-darwin" "x86_64-linux" "aarch64-linux" ];
      imports = [ ./nix/dev-shell.nix ];
    };
}
```

---

## Dev Shell per Language

### Go

```nix
# nix/dev-shell.nix
{ inputs, ... }: {
  perSystem = { pkgs, ... }: {
    devShells.default = pkgs.mkShell {
      packages = with pkgs; [
        go_1_24          # Go compiler (latest stable)
        golangci-lint    # Linting
        gotools          # goimports, godoc, etc.
        mockery          # Mock generation
        go-task          # Task runner
        pkl              # PKL config language
        ejson            # Secret encryption
        awscli2          # AWS CLI
        jq               # JSON processing
        httpie           # HTTP client for testing
      ];

      shellHook = ''
        export GOPATH="$HOME/go"
        export GOBIN="$GOPATH/bin"
        export PATH="$GOBIN:$PATH"
        echo "Go dev shell: $(go version)"
      '';
    };
  };
}
```

### Python

```nix
{ inputs, ... }: {
  perSystem = { pkgs, ... }: {
    devShells.default = pkgs.mkShell {
      packages = with pkgs; [
        python313         # Python 3.13 (latest stable)
        poetry            # Dependency management
        uv                # Fast pip replacement
        ruff              # Linting + formatting
        mypy              # Type checking
        go-task
        pkl
        ejson
        awscli2
      ];

      shellHook = ''
        export PYTHONDONTWRITEBYTECODE=1
        export PYTHONUNBUFFERED=1
        echo "Python dev shell: $(python --version)"
      '';
    };
  };
}
```

### TypeScript / Node.js

```nix
{ inputs, ... }: {
  perSystem = { pkgs, ... }: {
    devShells.default = pkgs.mkShell {
      packages = with pkgs; [
        nodejs_22         # Node.js LTS
        pnpm              # Fast package manager (preferred)
        nodePackages.typescript
        nodePackages.ts-node
        go-task
        pkl
        ejson
        awscli2
      ];

      shellHook = ''
        export NODE_ENV=development
        echo "Node dev shell: $(node --version)"
      '';
    };
  };
}
```

### Multi-Language (Monorepo)

```nix
{ inputs, ... }: {
  perSystem = { pkgs, ... }: {
    devShells = {
      default = pkgs.mkShell {
        # Common tools for all contributors
        packages = with pkgs; [ go-task pkl ejson awscli2 jq ];
      };

      go = pkgs.mkShell {
        packages = with pkgs; [ go_1_24 golangci-lint mockery go-task ];
      };

      python = pkgs.mkShell {
        packages = with pkgs; [ python313 poetry uv ruff mypy go-task ];
      };
    };
  };
}
```

Enter specific shell: `nix develop .#go` or `nix develop .#python`

---

## direnv Integration

`.envrc` file at project root:

```bash
# Activate Nix dev shell automatically
use flake

# Optional: load .env file
dotenv_if_exists .env.local
```

```bash
# First time setup
direnv allow

# After flake.nix changes
direnv reload
```

---

## flake-parts Modules

Extract reusable dev shell components:

```nix
# nix/modules/aws-tools.nix
{ ... }: {
  perSystem = { pkgs, ... }: {
    devShells.aws = pkgs.mkShell {
      packages = with pkgs; [ awscli2 awsls aws-vault ejson ];
      shellHook = "export AWS_DEFAULT_REGION=us-east-2";
    };
  };
}
```

Import in the root flake:
```nix
imports = [ ./nix/dev-shell.nix ./nix/modules/aws-tools.nix ];
```

---

## Adding Tools

1. Search: `nix search nixpkgs <tool>`
2. Add to `packages` in `nix/dev-shell.nix`
3. Run `nix develop` to verify
4. Commit `flake.lock` after `nix flake update` to share exact version with team

---

## Updating Dependencies

```bash
# Update all flake inputs
nix flake update

# Update specific input
nix flake update nixpkgs

# Check what changed
git diff flake.lock
```

Always commit `flake.lock` — it's the reproducibility contract.

---

## Cross-References

→ [Nix Conventions](../conventions/nix.md) | [Project Structure](../reference/project-structure.md) | [Commands](../reference/commands.md)
