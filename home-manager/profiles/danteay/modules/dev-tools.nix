{ pkgs, ... }:
{
  home.packages = [
    (import ../../../modules/langs/pkl.nix { inherit pkgs; })
  ];
}