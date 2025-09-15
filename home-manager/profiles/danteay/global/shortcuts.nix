{ pkgs, ... }:
{
  home.packages = with pkgs; [
    (writeShellScriptBin "sls-update-plugins" ''
      npx npm-check-updates '/serverless-.*/' -u && npm install
    '')

    (writeShellScriptBin "go-docker" ''
      docker run --rm -v "$(pwd):/workspace" -w /workspace --memory=2g --cpus=2 golang:1.25-alpine $@
    '')
  ];
}