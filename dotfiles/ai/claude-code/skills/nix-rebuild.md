# /nix-rebuild

Rebuild and switch home-manager or nix-darwin configuration.

## Usage

```
/nix-rebuild [home|darwin]
```

## Description

This skill helps rebuild Nix configurations:

- `home` - Rebuilds home-manager configuration for current user
- `darwin` - Rebuilds nix-darwin system configuration (requires sudo)

## Steps

When user invokes this skill:

1. Determine which configuration to rebuild (home-manager or nix-darwin)
2. If home-manager:
   - Run: `home-manager switch -b backup --impure --flake ~/.config/nix-modules/home-manager#$(whoami)`
3. If nix-darwin:
   - Change to nix-darwin directory
   - Run: `sudo nix --extra-experimental-features "nix-command flakes" run nix-darwin#darwin-rebuild -- switch --flake .#danteay`
4. Report any errors or successful completion
5. Show what changed in the new generation

## Examples

- `/nix-rebuild home` - Rebuild home-manager config
- `/nix-rebuild darwin` - Rebuild nix-darwin config
