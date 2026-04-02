{ ... }:
{
  home.file = {
    # Core configuration
    ".claude/settings.json".source = ../../dotfiles/ai/claude-code/settings.json;
    ".claude/CLAUDE.md".source = ../../dotfiles/ai/claude-code/CLAUDE.md;
    ".claude/agents".source = ../../dotfiles/ai/claude-code/agents;
    ".claude/docs".source = ../../dotfiles/ai/claude-code/docs;
  };
}
