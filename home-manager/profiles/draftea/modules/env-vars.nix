{ pkgs, ... }:
{
  home.file.".envs/draftea-envs.sh" = {
    text = ''
      export GOPRIVATE=github.com/Draftea
    '';
  };
}
