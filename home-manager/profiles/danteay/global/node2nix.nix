{ pkgs, ... }:
{
  home.packages = with pkgs; [
    node2nix
  ];
}