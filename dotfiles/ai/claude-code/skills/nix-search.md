# /nix-search

Search for packages in nixpkgs.

## Usage

```
/nix-search <package-name>
```

## Description

Search for available packages in nixpkgs and display relevant information including:
- Package name and version
- Description
- Available outputs
- Package location in nixpkgs

## Steps

When user invokes this skill:

1. Take the package name from the user
2. Run: `nix search nixpkgs <package-name>`
3. Parse and display the results in a readable format
4. If multiple packages match, show all relevant results
5. Suggest how to install the package in home-manager or nix-darwin

## Examples

- `/nix-search golang` - Search for Go packages
- `/nix-search python3` - Search for Python 3 packages
