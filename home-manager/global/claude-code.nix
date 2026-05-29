{ ... }:
{
  home.file = {
    # Core configuration
    # NOTE: settings.json is intentionally NOT managed by Nix so Claude Code
    # can write to it (OAuth tokens, MCP server state, etc.)
    ".claude/CLAUDE.md".source = ../../dotfiles/ai/claude-code/CLAUDE.md;
    ".claude/agents".source = ../../dotfiles/ai/claude-code/agents;
    ".claude/commands".source = ../../dotfiles/ai/claude-code/commands;
    ".claude/docs".source = ../../dotfiles/ai/claude-code/docs;
  };
}
