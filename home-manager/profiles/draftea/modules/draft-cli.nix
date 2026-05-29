{ pkgs, ... }:

{
  home.file = {
    "./.draftea/draft/config.toml".source = ../../../../dotfiles/draftea/draft/config.toml;
    ".draft/dbconnect.yml".source = ../../../../dotfiles/draftea/draft/dbconnect.yml;
  };
}