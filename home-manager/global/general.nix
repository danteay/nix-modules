{ pkgs, ... }:
{
  home.packages = with pkgs; [
    node2nix
    commitizen
    pre-commit
    husky
  ];
}
