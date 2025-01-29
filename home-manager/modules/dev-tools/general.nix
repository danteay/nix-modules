{ pkgs, ... }:
{
  home.packages = with pkgs; [
    commitizen
    pre-commit
    husky
  ];
}
