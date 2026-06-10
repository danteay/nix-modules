{ pkgs, ... }:
{
  home.file.".envs/draftea-envs.sh" = {
    text = ''
      export DK_MOD_TIDY=1
    '';
  };
}
