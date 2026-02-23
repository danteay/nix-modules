{ ... }:
{
  home.file = {
    # Core configuration
    ".claude/settings.json" = {
      source = ../../dotfiles/ai/claude-code/settings.json;
      force = true;
    };
    # ".claude.json" = {
    #   source = ../../dotfiles/ai/claude-code/.claude.json;
    #   force = true;
    # };
    ".claude/CLAUDE.md".source = ../../dotfiles/ai/claude-code/CLAUDE.md;
  };
}
