{ pkgs, ... }:
{
  home.packages = with pkgs; [
    awscli
  ];

  home.file = {
    ".aws/config".source = ../../../../dotfiles/danteay/aws/config;
    ".aws/credentials".source = ../../../../dotfiles/danteay/aws/credentials;
  };
}
