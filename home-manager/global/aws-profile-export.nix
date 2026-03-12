{ pkgs, ... }:
{
  home.file.".local/bin/use-aws-profile" = {
    source = ./../../dotfiles/scripts/export-aws-profile.sh;
    executable = true;
  };

  programs.zsh.initContent = ''
    function use-aws-profile() {
      source "$HOME/.local/bin/use-aws-profile" "$@"
    }
  '';
}
