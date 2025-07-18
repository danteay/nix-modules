{ pkgs, ... }:
{
  home.packages = with pkgs; [
    # Command to load or change to a specific home-manager profile configured on flake.nix
    #
    # Example:
    #
    # $ hms draftea
    #
    (writeShellScriptBin "hms" ''
      profile="$1"

      if [ -z "$profile" ]; then
        profile=$(whoami)
      fi

      home-manager switch -b backup --impure --flake $HOME_MANAGER_HOME#$profile
    '')

    (writeShellScriptBin "hms-update" ''
      profile="$HM_PROFILE"

      if [ -z "$profile" ]; then
        profile=draftea
      fi

      cd "$HOME_MANAGER_HOME"
      nix flake update

      hms "$profile"
    '')

    # Command alias to clean the nix store and free unneeded files from the storage
    #
    # Example:
    #
    # $ nix-clean
    #
    (writeShellScriptBin "nix-clean" ''
      nix-store --gc
    '')

    # Command to help kill a process binded to a port on the local machine
    #
    # Example:
    #
    # $ kill-port 8080
    #
    (writeShellScriptBin "kill-port" ''
      kill $(lsof -t -i:$1)
    '')
  ];
}
