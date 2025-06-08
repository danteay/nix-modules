{ pkgs, ... }:

{
  home.file = {
    "./.draftea/draft/config.toml".source = ../../../../dotfiles/draftea/draft/config.toml;
  };
}