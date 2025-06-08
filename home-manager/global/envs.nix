{ pkgs, ... }:
{
  home.file.".envs/global-envs.sh" = {
    text = ''
      export HOME_MANAGER_HOME="$HOME/.config/nix-modules/home-manager"
    '';
  };
}