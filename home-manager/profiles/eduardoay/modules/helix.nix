{ pkgs, ... }:

{
  home.packages = with pkgs; [
    helix
    helix-gpt
  ];

  home.file = {
    ".config/helix".source = ../../../../dotfiles/eduardoay/helix;
  };
}