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

  nixpkgs.hostPlatform = "aarch64-darwin";

  nix.settings.trusted-users = [ "root" "danteay" ];

  homebrew = {
    enable = true;

    brews = [
      "gitleaks"
      "gh"
      "aviator-co/tap/av"
      "graphviz"
      "cpulimit"
      "rtk"
      "jj"
      # opencode-v2 ships the same `opencode` binary as the v1 formula; unlink
      # v1 first so the install doesn't fail on the conflict.
      {
        name = "anomalyco/tap/opencode-v2";
        conflicts_with = [ "anomalyco/tap/opencode" ];
      }
    ];

    casks = [
      "ghostty"
      "claude-code"
      "codex"

      "linear"
      "1password"
      "1password-cli"

      "telegram"
      # "whatsapp"
      "slack"
      "discord"

      "vercel"

      "spotify"
      "steam"

      "brave-browser"

      "zed"
      # "goland"
      "jetbrains-toolbox"
      "orbstack"
      "postman"

      "zoom"
    ];

    onActivation = {
      autoUpdate = true;
      cleanup = "uninstall";
      upgrade = true;
      extraFlags = [ "--force" ];
    };
  };
}
