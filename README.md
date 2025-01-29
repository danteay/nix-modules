# nix-modules

My personal configuration for nix, home manager and nix-darwin.

## Nix darwin activation

```bash
nix run nix-darwin -- switch --flake ~/.config/nix-darwin#eduardoay
```

## Home manager activation

```bash
home-manager switch --flake --backup ~/.config/home-manager#eduardoay
```
