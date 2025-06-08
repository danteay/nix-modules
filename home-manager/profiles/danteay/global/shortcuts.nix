{ pkgs, ... }:
{
  home.packages = with pkgs; [
    (writeShellScriptBin "sls-update-plugins" ''
      npx npm-check-updates '/serverless-.*/' -u && npm install
    '')
  ];
}