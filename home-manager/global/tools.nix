{ pkgs, ... }:
{
  home.packages = with pkgs; [
    sd      # replace of sed
    fd      # replace of find
    jq      # query json files
    yq-go   # query and modify yaml files
    bat     # better version of cat
    ripgrep
    fzf
    direnv
  ];
}
