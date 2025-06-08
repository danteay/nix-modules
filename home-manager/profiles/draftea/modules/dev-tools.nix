{ pkgs, ... }:
{
  home.packages = with pkgs; [
    act
    upx
    ejson
    goimports-reviser
    go-mockery

    (import ../../../modules/langs/pkl.nix { inherit pkgs; })
  ];
}
