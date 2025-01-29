{
  description = "Example nix-darwin system flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-darwin.url = "github:LnL7/nix-darwin/master";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = inputs@{ self, nix-darwin, nixpkgs, ... }:
  let
    system = builtins.currentSystem;
    pkgs = nixpkgs.legacyPackages.${system};
  in
  {
    # Build darwin flake using:
    # $ darwin-rebuild build --flake .#Eduardos-MacBook-Pro-2
    darwinConfigurations."eduardoay" = nix-darwin.lib.darwinSystem {
      modules = [
        ./modules/configuration.nix
        ./modules/packages.nix
        ./modules/brews.nix
      ];
    };
  };
}
