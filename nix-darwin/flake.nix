{
  description = "Example nix-darwin system flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-darwin.url = "github:nix-darwin/nix-darwin/master";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";
  };

  # Build darwin flake using:
  # $ darwin-rebuild build --flake .#danteay
  outputs = inputs@{ self, nix-darwin, nixpkgs }: {
    darwinConfigurations."danteay" = nix-darwin.lib.darwinSystem {
      modules = [ ./configuration.nix ];
    };
  };
}
