{ pkgs, ... }:
{
  home.packages = with pkgs; [
    python313
    poetry
    uv
  ];
}
