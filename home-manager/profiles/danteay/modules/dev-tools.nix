{ pkgs, ... }:
{
  home.packages = [
    awscli2
    ejson
    pkl

    (import ../../../modules/derivations/go-migrate.nix { inherit pkgs; })
  ];
}