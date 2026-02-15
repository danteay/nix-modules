{ pkgs, ... }:
let
  extraZsh = builtins.readFile ../../../../dotfiles/scripts/extra-zsh.sh;
in
{
  enableP10K = true;

  zshConfig = {
    shellAliases = {
      myip = "ifconfig en0 | grep inet | grep -v inet6 | awk '{print $2}'";
    };

    initContent = extraZsh;
  };
}