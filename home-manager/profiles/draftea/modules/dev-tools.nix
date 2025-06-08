{ pkgs, ... }:
{
  home.packages = with pkgs; [
    act
    upx
    ejson
    goimports-reviser
    go-mockery
    awscli2

    (import ../../../modules/langs/pkl.nix { inherit pkgs; })
  ];
}
