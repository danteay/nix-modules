{ pkgs, ... }:
let
  updateNodeDeps = builtins.readFile ../../../../dotfiles/eduardoay/scripts/update-node-deps.sh;
  setServerlessVersion =builtins.readFile ../../../../dotfiles/eduardoay/scripts/set-serverless-version.sh;
in
{
  home.packages = with pkgs; [
    (writeShellScriptBin "update-node-deps" "${updateNodeDeps}")
    (writeShellScriptBin "set-serverless-version" "${setServerlessVersion}")
  ];
}