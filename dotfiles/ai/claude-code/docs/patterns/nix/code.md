# Code Patterns (Nix)

> Module patterns, overlay composition, dev shell recipes, and flake-parts best practices.

---

## flake-parts Module Pattern

Structure Nix flakes using `flake-parts` for composable, per-system configuration:

```nix
# flake.nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
  };

  outputs = inputs @ { flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [ "x86_64-linux" "aarch64-darwin" ];

      imports = [
        ./nix/dev-shells.nix
        ./nix/packages.nix
        ./nix/checks.nix
      ];
    };
}
```

---

## Dev Shell Module

```nix
# nix/dev-shells.nix
{ inputs, ... }: {
  perSystem = { pkgs, system, ... }: {
    devShells.default = pkgs.mkShell {
      name = "my-project";

      buildInputs = with pkgs; [
        go_1_23
        golangci-lint
        gotools
        just
        docker
      ];

      shellHook = ''
        export GOPATH="$PWD/.gopath"
        export PATH="$GOPATH/bin:$PATH"
        echo "Dev shell ready. Run 'just' for available commands."
      '';
    };

    # Language-specific shells
    devShells.python = pkgs.mkShell {
      buildInputs = with pkgs; [
        python312
        uv
        ruff
        mypy
      ];
    };
  };
}
```

---

## Package Module

```nix
# nix/packages.nix
{ inputs, ... }: {
  perSystem = { pkgs, ... }: {
    packages.default = pkgs.buildGoModule {
      pname = "my-service";
      version = "0.1.0";
      src = ../.;
      vendorHash = "sha256-...";
    };

    packages.docker = pkgs.dockerTools.buildLayeredImage {
      name = "my-service";
      tag = "latest";
      config.Cmd = [ "${pkgs.my-service}/bin/my-service" ];
    };
  };
}
```

---

## Home-Manager Module Pattern

```nix
# modules/my-tool.nix
{ config, lib, pkgs, ... }:
let
  cfg = config.programs.myTool;
in {
  options.programs.myTool = {
    enable = lib.mkEnableOption "My Tool";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.myTool;
      description = "The myTool package to use.";
    };

    settings = lib.mkOption {
      type = lib.types.attrs;
      default = {};
      description = "Extra settings for myTool.";
    };
  };

  config = lib.mkIf cfg.enable {
    home.packages = [ cfg.package ];

    xdg.configFile."myTool/config.toml".text =
      lib.generators.toTOML {} cfg.settings;
  };
}
```

---

## Overlay Pattern

Use overlays to override or extend packages:

```nix
# overlays/default.nix
final: prev: {
  # Override a package
  somePackage = prev.somePackage.overrideAttrs (old: {
    version = "2.0.0";
    src = prev.fetchurl {
      url = "https://example.com/v2.0.0.tar.gz";
      sha256 = "sha256-...";
    };
  });

  # Add a new package
  myCustomTool = prev.callPackage ./pkgs/myCustomTool.nix {};
}

# Use in flake
nixpkgs.overlays = [ (import ./overlays) ];
```

---

## listDirModules Pattern

Auto-import all modules in a directory (skip files with `.skip.nix`):

```nix
# lib/listDirModules.nix
dir:
let
  entries = builtins.readDir dir;
  isModule = name: type:
    (type == "regular" && lib.hasSuffix ".nix" name && !lib.hasSuffix ".skip.nix" name)
    || (type == "directory" && builtins.pathExists "${dir}/${name}/default.nix");
in
  lib.mapAttrsToList
    (name: type: "${dir}/${name}")
    (lib.filterAttrs isModule entries)
```

---

## `lib.mkIf` Conditional Configuration

```nix
{ config, lib, pkgs, ... }: {
  config = lib.mkMerge [
    # Always applied
    { home.packages = [ pkgs.git ]; }

    # Conditionally applied
    (lib.mkIf config.programs.neovim.enable {
      home.packages = [ pkgs.tree-sitter ];
    })

    (lib.mkIf pkgs.stdenv.isDarwin {
      home.packages = [ pkgs.darwin.apple_sdk.frameworks.Security ];
    })
  ];
}
```

---

## Reading External Files

```nix
# Read shell scripts or config files into Nix strings
{ pkgs, ... }: {
  programs.zsh.initExtra = builtins.readFile ./zshrc;

  xdg.configFile."nvim/init.lua".source = ./init.lua;

  home.file.".gitconfig".text = builtins.readFile ./gitconfig;
}
```

---

## Derivation Pinning

Always pin `nixpkgs` in flakes — never use `nixpkgs` from `NIX_PATH`:

```nix
# Good — pinned via flake.lock
inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";

# Use `follows` to avoid multiple nixpkgs versions
inputs.home-manager = {
  url = "github:nix-community/home-manager/release-25.05";
  inputs.nixpkgs.follows = "nixpkgs";
};
```

Update: `nix flake update` (all) or `nix flake lock --update-input nixpkgs` (single).

---

## NixOS / nix-darwin Module

```nix
# darwin/modules/homebrew.nix
{ config, lib, ... }: {
  homebrew = {
    enable = true;
    onActivation.autoUpdate = false;
    onActivation.cleanup = "zap";

    brews = lib.mkIf config.my.work.enable [
      "awscli"
    ];

    casks = [
      "firefox"
      "1password"
    ];
  };
}
```

---

## Cross-References

→ [Conventions (Nix)](../../conventions/nix/index.md) | [Testing (Nix)](../../testing/nix/guide.md) | [Dev Environment Guide](../../guides/dev-environment.md)
