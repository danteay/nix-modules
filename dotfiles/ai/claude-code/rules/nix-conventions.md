# Nix Configuration Conventions

## File Organization

- Keep related configurations in dedicated modules
- Use descriptive file names matching their purpose
- Organize modules by functionality or domain
- Separate user-specific configs from general ones

## Nix Expressions

- Use `let ... in` for local bindings
- Prefer `inherit` for cleaner attribute sets
- Use `rec` sparingly, prefer explicit references
- Format code with `nixpkgs-fmt` or `alejandra`
- Add comments for non-obvious configuration choices

## Flakes

- Always specify input versions or use follows
- Lock flake inputs for reproducibility
- Update flakes regularly but deliberately
- Document custom flake outputs
- Use meaningful flake descriptions

## Home Manager Modules

- Export configuration as a function taking { config, pkgs, ... }
- Use `mkIf`, `mkMerge`, and other lib functions appropriately
- Define options for reusable modules
- Provide sensible defaults
- Document module options

## Best Practices

- Test configurations before committing
- Use `nix-build` to validate syntax
- Keep sensitive data out of the nix store
- Leverage overlays for package customization
- Use `builtins.readFile` for external file content
