{ pkgs, config ? { }, ... }:
let
  configGit = {
    enable = true;

    extraConfig = {
      pull.rebase = true;
      init.defaultBranch = "main";

      push.autoSetupRemote = true;

      core.editor = "vi";
      core.fileMode = false;
      core.ignorecase = false;
    };
  };

  mergedConfig = lpkgs.ib.recursiveUpdate configGit (config.gitConfig or { });
in
{
  programs.git = mergedConfig;
}
