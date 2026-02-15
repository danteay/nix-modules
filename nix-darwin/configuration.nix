{ config, pkgs, ... }:
{
  # List packages installed in system profile. To search by name, run:
  # $ nix-env -qaP | grep wget
  environment.systemPackages = with pkgs; [
    gnupg

    (writeShellScriptBin "nds" ''
      sudo nix --extra-experimental-features "nix-command flakes" run nix-darwin#darwin-rebuild -- switch --flake $HOME/.config/nix-modules/nix-darwin#danteay
    '')
  ];

  # Enable alternative shell support in nix-darwin.
  # programs.fish.enable = true;

  # Used for backwards compatibility, please read the changelog before changing.
  # $ darwin-rebuild changelog
  system.stateVersion = 6;
  system.primaryUser = "danteay";

  nixpkgs.hostPlatform = "aarch64-darwin";

  homebrew = {
    enable = true;

    brews = [
      "gitleaks"
      "gh"
      "graphviz"
      "cpulimit"
      "gemini-cli"
    ];

    casks = [
      "ghostty"
      "claude-code"
      "copilot-cli"

      # "obsidian"
      # "raycast"

      "linear-linear"
      "1password"
      "1password-cli"

      "telegram"
      "whatsapp"
      "slack"
      "discord"

      "spotify"
      "steam"

      "brave-browser"
      # "firefox"
      # "chatgpt-atlas"

      "visual-studio-code"
      "goland"
      "pycharm"
      "jetbrains-toolbox"
      "orbstack"
      "dbeaver-community"
      "postman"

      # "zoom"
      "logi-options+"
    ];

    onActivation = {
      autoUpdate = true;
      cleanup = "uninstall";
      upgrade = true;
    };
  };
}