{ pkgs, ... }:
{
  environment.systemPackages = with pkgs;[
    (writeShellScriptBin "darwin-switch" ''
      nix run nix-darwin -- switch --flake ~/.config/nix-darwin#eduardoay
    '')

    (writeShellScriptBin "darwin-build" ''
      nix run nix-darwin -- build --flake ~/.config/nix-darwin#draftea
    '')
  ];
}