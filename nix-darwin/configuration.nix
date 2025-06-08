{ config, pkgs, ... }:

{
  # List packages installed in system profile. To search by name, run:
  # $ nix-env -qaP | grep wget
  environment.systemPackages = with pkgs; [
    # vim

    (writeShellScriptBin "darwin-update" ''
      username=$(whoami)
      cd ~/.config/nix-darwin && nix flake update && nix run nix-darwin -- switch --flake "$HOME/.config/nix-darwin#$username"
    '')

    (writeShellScriptBin "darwin-switch" ''
      username=$(whoami)
      nix run nix-darwin -- switch --flake "$HOME/.config/nix-darwin#$username"
    '')

    gnupg
  ];

  # Enable alternative shell support in nix-darwin.
  # programs.fish.enable = true;

  # Used for backwards compatibility, please read the changelog before changing.
  # $ darwin-rebuild changelog
  system.stateVersion = 6;

  homebrew = {
    enable = true;

    brews = [
      "gitleaks"
      "gh"
      "golang-migrate"
      "localstack"
    ];

    casks = [
      "hyper"
      "docker"
      "dbeaver-community"
      "linear-linear"
      "1password"
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
    ];

    onActivation = {
      autoUpdate = true;
      cleanup = "uninstall";
      upgrade = true;
    };
  };
}