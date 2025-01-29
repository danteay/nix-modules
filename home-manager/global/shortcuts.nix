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
      home-manager switch -b backup --impure --flake ~/.config/home-manager#$1
    '')

    # Command alias to clean the nix store and free unneded files from the storage
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
