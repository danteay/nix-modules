# nix-modules

My personal configuration for nix, home manager and nix-darwin.

## Installation

1. Clone the repository:

```bash
git clone github.com/danteay/nix-modules.git ~/.config

## Nix darwin activation

```bash
nix run nix-darwin -- switch --flake ~/.config/nix-darwin#danteay
```

## Home manager activation

```bash
home-manager switch --flake --backup ~/.config/home-manager#danteay
```
