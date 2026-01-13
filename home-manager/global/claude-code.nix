{ ... }:
{
  home.file = {
    # Core configuration
    ".claude/setting.json".source = ../../dotfiles/ai/claude-code/settings.json;
    ".claude/CLAUDE.md".source = ../../dotfiles/ai/claude-code/CLAUDE.md;

    # Agents
    ".claude/agents/devops-expert.md".source = ../../dotfiles/ai/claude-code/agents/devops-expert.md;
    ".claude/agents/golang-expert.md".source = ../../dotfiles/ai/claude-code/agents/golang-expert.md;
    ".claude/agents/nix-expert.md".source = ../../dotfiles/ai/claude-code/agents/nix-expert.md;
    ".claude/agents/senior-software-architect.md".source = ../../dotfiles/ai/claude-code/agents/senior-software-architect.md;

    # Rules
    ".claude/rules/coding-standards.md".source = ../../dotfiles/ai/claude-code/rules/coding-standards.md;
    ".claude/rules/nix-conventions.md".source = ../../dotfiles/ai/claude-code/rules/nix-conventions.md;
    ".claude/rules/security.md".source = ../../dotfiles/ai/claude-code/rules/security.md;

    # Skills
    ".claude/skills/git-cleanup.md".source = ../../dotfiles/ai/claude-code/skills/git-cleanup.md;
    ".claude/skills/go-test-coverage.md".source = ../../dotfiles/ai/claude-code/skills/go-test-coverage.md;
    ".claude/skills/nix-rebuild.md".source = ../../dotfiles/ai/claude-code/skills/nix-rebuild.md;
    ".claude/skills/nix-search.md".source = ../../dotfiles/ai/claude-code/skills/nix-search.md;
  };
}