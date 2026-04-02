# Nix Conventions

> Nix flakes, flake-parts, home-manager modules, and dev shell conventions.

## Core Preferences

- **Flakes** for all new configurations (no `nix-env`, no channels)
- **flake-parts** for composable flake modules (preferred over monolithic `flake.nix`)
- **home-manager** for user-environment configuration
- Latest stable nixpkgs (`nixos-25.11`) with unstable overlay for bleeding-edge tools
- **nixfmt** for formatting, **statix** for linting

---

## Dev Shell (flake-parts)

Every project includes a Nix dev shell. Use `flake-parts` to keep it modular:

```nix
# flake.nix
{
  inputs = {
    nixpkgs.url    = "github:nixos/nixpkgs/nixos-25.11";
    flake-parts.url = "github:hercules-ci/flake-parts";
  };

  outputs = inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [ "aarch64-darwin" "x86_64-linux" "aarch64-linux" ];
      imports = [ ./nix/dev-shell.nix ];
    };
}
```

```nix
# nix/dev-shell.nix
{ inputs, ... }: {
  perSystem = { pkgs, ... }: {
    devShells.default = pkgs.mkShell {
      packages = with pkgs; [
        go_1_25
        golangci-lint
        gotools
        mockery
        go-task
        pkl
        ejson
        awscli2
        serverless
      ];

      shellHook = ''
        export GOPATH="$HOME/go"
        echo "Dev shell ready: $(go version)"
      '';
    };
  };
}
```

### Language-Specific Dev Shells

```nix
# Python
packages = with pkgs; [ python313 poetry uv ruff mypy go-task ];

# TypeScript / Node
packages = with pkgs; [ nodejs_24 pnpm nodePackages.typescript go-task ];
```

---

## flake-parts Module Structure

```nix
# nix/modules/aws-tools.nix
{ ... }: {
  perSystem = { pkgs, ... }: {
    devShells.aws = pkgs.mkShell {
      packages = with pkgs; [ awscli2 ejson aws-vault ];
      shellHook = "export AWS_DEFAULT_REGION=us-east-2";
    };
  };
}
```

Import in root flake:

```nix
imports = [
  ./nix/dev-shell.nix
  ./nix/modules/aws-tools.nix
];
```

---

## Home-Manager Modules

### Module Structure

```nix
# home-manager/modules/{name}/default.nix
{ config, pkgs, lib, ... }:
let
  cfg = config.modules.myModule;
in {
  options.modules.myModule = {
    enable = lib.mkEnableOption "my module";
    extraPackages = lib.mkOption {
      type = lib.types.listOf lib.types.package;
      default = [];
    };
  };

  config = lib.mkIf cfg.enable {
    home.packages = [ pkgs.myTool ] ++ cfg.extraPackages;
  };
}
```

### Auto-Discovery

The home-manager flake uses `listDirModules` — place any `.nix` file in the right directory and it loads automatically. Name files `*.skip.nix` to exclude.

### Profile Customization

```nix
# profiles/danteay/custom/git.nix
{ ... }: {
  programs.git = {
    userName  = "Eduardo Aguilar";
    userEmail = "danteay@example.com";
  };
}
```

---

## Naming Conventions

| Construct | Convention | Example |
|-----------|-----------|---------|
| Flake input | camelCase | `nixpkgs`, `flakeParts` |
| Module option | camelCase | `modules.myTool.enable` |
| File | kebab-case | `dev-shell.nix`, `go-tools.nix` |
| Shell variable | UPPER_SNAKE | `GOPATH`, `HOME_MANAGER_HOME` |

---

## Common Patterns

### Conditional Packages

```nix
home.packages = with pkgs; [
  ripgrep
  fd
] ++ lib.optionals stdenv.isDarwin [
  darwin.apple_sdk.frameworks.Security
];
```

### Unstable Overlay in Stable

```nix
nixpkgs.overlays = [
  (_: _: { go = inputs.unstable.legacyPackages.${system}.go_1_24; })
];
```

### Reading External Files

```nix
programs.zsh.initContent = builtins.readFile ./zsh/init.zsh;
```

---

## Formatting and Linting

```bash
nixfmt flake.nix nix/        # format
statix check .                # lint
deadnix .                     # dead code
nix flake check               # evaluate (catches errors)
```

---

## Rules

- Never use `nix-env -i` — declare packages in home-manager or dev shells
- Pin nixpkgs via flake lock — run `nix flake update` deliberately, commit the result
- Keep modules focused — one concern per file
- Don't inline large text blocks — use `builtins.readFile`

---

## Cross-References

→ [Dev Environment Guide](../../guides/dev-environment.md) | [Project Structure](../../reference/project-structure.md)
