{ pkgs, ... }:
{
  homebrew = {
    enable = true;

    brews = [
      "gitleaks"
    ];

    casks = [
      "ghostty"
      "docker"
      "dbeaver-community"
    ];
  };
}