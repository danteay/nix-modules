{ pkgs, ... }:
{
  homebrew = {
    enable = true;
    brews = [  ];
    casks = [
      "ghostty"
      "docker"
      "dbeaver-community"
    ];
  };
}