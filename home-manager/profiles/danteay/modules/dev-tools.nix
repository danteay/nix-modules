{ pkgs, ... }:
{
  home.packages = [
    awscli2

    (import ../../../modules/langs/pkl.nix { inherit pkgs; })
  ];
}