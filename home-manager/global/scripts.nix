{ pkgs, ... }:
let
  updateNodeDeps = builtins.readFile ../../dotfiles/scripts/update-node-deps.sh;
  setServerlessVersion =builtins.readFile ../../dotfiles/scripts/set-serverless-version.sh;
in
{
  home.packages = with pkgs; [
    (writeShellScriptBin "update-node-deps" "${updateNodeDeps}")
    (writeShellScriptBin "set-serverless-version" "${setServerlessVersion}")
  ];
}