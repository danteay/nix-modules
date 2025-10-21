{ pkgs, config ? { }, ... }:
let
  configGit = {
    pull.rebase = true;
    init.defaultBranch = "main";

    push.autoSetupRemote = true;

    core.editor = "hx";
    core.fileMode = false;
    core.ignorecase = false;
  };

  settings = pkgs.lib.recursiveUpdate configGit (config.gitConfig or { });
in
{
  programs.git = {
    enable = true;
    inherit settings;
  };
}
