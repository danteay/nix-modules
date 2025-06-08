{ pkgs, config ? { }, ... }:
let
  configGit = {
    enable = true;

    extraConfig = {
      pull.rebase = true;
      init.defaultBranch = "main";

      push.autoSetupRemote = true;

      core.editor = "hx";
      core.fileMode = false;
      core.ignorecase = false;
    };
  };

  mergedConfig = pkgs.lib.recursiveUpdate configGit (config.gitConfig or { });
in
{
  programs.git = mergedConfig;
}
