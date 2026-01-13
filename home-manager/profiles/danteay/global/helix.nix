{ pkgs, ... }:
{
  home.packages = with pkgs; [
    helix
  ];

  home.file = {
    ".config/helix".source = ../../../../dotfiles/danteay/helix;
  };
}