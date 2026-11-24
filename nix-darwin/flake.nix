{
  description = "Example nix-darwin system flake";

  inputs = {
    nixpkgs.url = "https://flakehub.com/f/NixOS/nixpkgs/0.2605";
    nix-darwin.url = "github:nix-darwin/nix-darwin/nix-darwin-26.05";
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
