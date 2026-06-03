{ ... }:
{
  home.file = {
    # Core configuration
    ".claude/CLAUDE.md".source = ../../dotfiles/ai/claude-code/CLAUDE.md;
    ".claude/RTK.md".source = ../../dotfiles/ai/claude-code/RTK.md;
    ".claude/settings.json".source = ../../dotfiles/ai/claude-code/settings.json;
    ".claude/agents".source = ../../dotfiles/ai/claude-code/agents;
    ".claude/commands".source = ../../dotfiles/ai/claude-code/commands;
    ".claude/docs".source = ../../dotfiles/ai/claude-code/docs;

    # RTK user-global filters
    "Library/Application Support/rtk/filters.toml".source =
      ../../dotfiles/ai/rtk/filters.toml;
  };
}
