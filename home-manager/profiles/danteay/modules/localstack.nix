{ pkgs, ... }:
{
  home.packages = with pkgs; [
#    localstack
    terraform-local
  ];
}