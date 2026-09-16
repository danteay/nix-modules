{ pkgs, config, lib, ... }:
let
  cfg = {
    enforce = true;
    minLines = 200;
  };

  docsRoot = "${config.home.homeDirectory}/.config/opencode/docs";

  # Agent and command bodies cite the shared knowledge base as @OPENCODE_DOCS@.
  # It has to become a real absolute path: OpenCode's read tool resolves relative
  # paths against the project directory, not the prompt file, and expands neither
  # `~` nor `$HOME`. The username differs per profile, so substitute at build time.
  withDocsPath = name: src: pkgs.runCommand "opencode-${name}" { } ''
    mkdir -p $out
    cp ${src}/*.md $out/
    chmod u+w $out/*.md
    substituteInPlace $out/*.md --replace-quiet '@OPENCODE_DOCS@' '${docsRoot}'

    # Fail the build rather than shipping a prompt that cites a literal placeholder.
    if grep -rl '@OPENCODE_DOCS@' $out; then
      echo "opencode-${name}: unsubstituted placeholders above" >&2
      exit 1
    fi
  '';
in
{
  home.file = {
    ".config/opencode/pricing.json".source = ../../dotfiles/ai/opencode/pricing.json;
    ".config/opencode/opencode.json".source = ../../dotfiles/ai/opencode/opencode.json;
    ".config/opencode/agents".source = withDocsPath "agents" ../../dotfiles/ai/opencode/agents;
    ".config/opencode/commands".source = withDocsPath "commands" ../../dotfiles/ai/opencode/commands;

    # Shared knowledge base, single source of truth in dotfiles/ai/claude-code/docs —
    # the same tree ~/.claude/docs uses. Mounted here so the review agents' absolute
    # references resolve, and allowed in opencode.json's external_directory permission.
    ".config/opencode/docs".source = ../../dotfiles/ai/claude-code/docs;

    ".envs/opencode.sh".text = ''
      export DESVIO_ENABLED=${if cfg.enforce then "1" else "0"}
      export DESVIO_MIN_LINES=${toString cfg.minLines}
      export DESVIO_LOG_DIR="${config.home.homeDirectory}/.local/share/desvio"

      alias desvio-outline="bash ~/.config/opencode/bin/go-outline.sh"
      alias desvio-report="bun run ~/.config/opencode/scripts/report.ts"
      alias desvio-baseline="bash ~/.config/opencode/scripts/baseline.sh"
      alias desvio-off="export DESVIO_ENABLED=0 && echo 'desvio routing disabled; usage logging and worker exclusions remain active'"
    '';
  };

  # Bun follows store symlinks and cannot resolve config/node_modules from there.
  # Materialize runtime sources after the old generation's links are removed.
  home.activation.opencodeRuntime = lib.hm.dag.entryAfter [ "linkGeneration" ] ''
    run ${pkgs.bash}/bin/bash ${../../dotfiles/ai/opencode/scripts/bootstrap.sh} \
      ${../../dotfiles/ai/opencode} ${lib.escapeShellArg "${config.home.homeDirectory}/.config/opencode"} --skip-install
  '';

  home.packages = with pkgs; [
    bun            # plugin + custom tool runtime, and runs report.ts
    ripgrep        # repo_grep, go_outline, baseline.sh
    fd             # baseline.sh (optional, falls back to rg)
    jq
  ];
}
