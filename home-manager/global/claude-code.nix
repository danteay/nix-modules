{ pkgs, config, ... }:
let
  claudeRoot = "${config.home.homeDirectory}/.claude";

  # Agent and command bodies cite the knowledge base as @CLAUDE_DOCS@ and sibling
  # agents as @CLAUDE_AGENTS@. Both have to become real absolute paths: the Read
  # tool resolves a relative path against the project directory, not against the
  # prompt file, and `.claude/agents` is a Nix store symlink, so `agents/../docs`
  # escapes into /nix/store. The username differs per profile, so substitute at
  # build time rather than hardcoding a path in the markdown.
  # substituteInPlace is a stdenv shell function, so it cannot be run via
  # `find -exec` — that silently substitutes nothing. Loop in bash instead, then
  # assert the placeholders are gone so a future mistake fails the build.
  withPaths = name: src: pkgs.runCommand "claude-code-${name}" { } ''
    cp -r ${src} $out
    chmod -R u+w $out
    while IFS= read -r -d "" file; do
      substituteInPlace "$file" \
        --replace-quiet '@CLAUDE_DOCS@' '${claudeRoot}/docs' \
        --replace-quiet '@CLAUDE_AGENTS@' '${claudeRoot}/agents'
    done < <(find $out -name '*.md' -print0)

    if grep -rl '@CLAUDE_DOCS@\|@CLAUDE_AGENTS@' $out; then
      echo "claude-code-${name}: unsubstituted placeholders above" >&2
      exit 1
    fi
  '';
in
{
  home.file = {
    # Core configuration
    ".claude/CLAUDE.md".source = ../../dotfiles/ai/claude-code/CLAUDE.md;
    ".claude/settings.json".source = ../../dotfiles/ai/claude-code/settings.json;
    ".claude/agents".source = withPaths "agents" ../../dotfiles/ai/claude-code/agents;
    ".claude/commands".source = withPaths "commands" ../../dotfiles/ai/claude-code/commands;
    ".claude/docs".source = ../../dotfiles/ai/claude-code/docs;
  };
}
