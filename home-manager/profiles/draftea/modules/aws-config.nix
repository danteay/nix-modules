{ pkgs, ... }:
{
  home.packages = with pkgs; [
    awscli
  ];

  home.file = {
    ".aws/config".source = ../../../../dotfiles/draftea/aws/config;
    ".aws/credentials".source = ../../../../dotfiles/draftea/aws/credentials;
  };
}
