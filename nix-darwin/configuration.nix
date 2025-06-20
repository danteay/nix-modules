{ config, pkgs, ... }:
{
  # List packages installed in system profile. To search by name, run:
  # $ nix-env -qaP | grep wget
  environment.systemPackages = with pkgs; [
    gnupg
  ];

  # Enable alternative shell support in nix-darwin.
  # programs.fish.enable = true;

  # Used for backwards compatibility, please read the changelog before changing.
  # $ darwin-rebuild changelog
  system.stateVersion = 6;
  system.primaryUser = "danteay";

  homebrew = {
    enable = true;

    brews = [
      "gitleaks"
      "gh"
      "golang-migrate"
      "localstack"
    ];

    casks = [
      "arc"
      "hyper"
      "docker"
      "dbeaver-community"
      "linear-linear"
      "1password"
      "1password-cli"
      "discord"
      "telegram"
      "slack"
      "postman"
      "spotify"
      "steam"
      "brave-browser"
      "visual-studio-code"
      "whatsapp"
      "goland"
      "pycharm-ce"
      "zoom"
      "logi-options+"
    ];

    onActivation = {
      autoUpdate = true;
      cleanup = "uninstall";
      upgrade = true;
    };
  };
}