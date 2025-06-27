{ pkgs, ... }:
{
  home.packages = with pkgs; [
    act
    upx
    ejson
    goimports-reviser
    go-mockery
    awscli2

    (import ../../../modules/derivations/pkl.nix { inherit pkgs; })
    (import ../../../modules/derivations/go-migrate.nix { inherit pkgs; })
  ];
}
