{ pkgs, ... }:
{
  home.packages = with pkgs; [
    awscli2
    ejson
    pkl

    (import ../../../modules/derivations/go-migrate.nix { inherit pkgs; })
  ];
}