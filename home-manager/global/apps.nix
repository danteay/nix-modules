{ pkgs, ...}:
{
  home.packages = with pkgs; [
    homebank
  ];
}