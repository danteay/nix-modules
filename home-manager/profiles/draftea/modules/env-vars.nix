{ pkgs, ... }:
{
  home.file.".envs/draftea-envs.sh" = {
    text = ''
      export HM_PROFILE=draftea
      export GOPRIVATE=github.com/Draftea
    '';
  };

  home.file.".envs/auto-update.sh" = {
    source = ../../dotfiles/draftea/scripts/auto-update.sh;
  };

  home.file.".envs/direnv.sh" = {
    text = ''
      if [ -n "$BASH_VERSION" ] || [ -n "$ZSH_VERSION" ]; then
          eval "$(direnv hook $(basename "$SHELL"))"
      fi
    '';
  };
}
