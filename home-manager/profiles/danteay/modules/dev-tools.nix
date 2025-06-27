{ pkgs, ... }:
{
  home.packages = [
    awscli2

    (import ../../../modules/derivations/pkl.nix { inherit pkgs; })
    (import ../../../modules/derivations/go-migrate.nix { inherit pkgs; })
  ];
}