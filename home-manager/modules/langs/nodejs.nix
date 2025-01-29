{ pkgs, ... }:
{
  home.packages = with pkgs; [
    # NodeJS
    nodejs_22
    nodePackages.serverless
    nodePackages.mocha
  ];
}
