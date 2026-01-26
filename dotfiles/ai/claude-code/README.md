# Claude Code Configuration

This directory contains Claude Code configuration files managed through home-manager.

## Structure

```
dotfiles/ai/claude-code/
├── agents/          # Specialized expert agents
├── rules/           # Coding standards and conventions
├── skills/          # Custom commands/skills
├── CLAUDE.md        # Claude Code specific memory/context file
└── README.md        # This file
```

## Components

### Agents (`agents/`)

Specialized expert agents that provide focused assistance:

- **nix-expert.md** - Nix, home-manager, and nix-darwin expertise
- **golang-expert.md** - Go programming best practices
- **devops-expert.md** - Infrastructure and DevOps automation

### Rules (`rules/`)

Coding standards and conventions:

- **coding-standards.md** - General code quality guidelines
- **nix-conventions.md** - Nix-specific conventions
- **security.md** - Security best practices

### Skills (`skills/`)

Custom commands available as `/command-name`:

- `/nix-rebuild` - Rebuild home-manager or nix-darwin
- `/nix-search` - Search for nixpkgs packages
- `/git-cleanup` - Clean up merged branches
- `/go-test-coverage` - Run Go tests with coverage

### Memory (`CLAUDE.md`)

Persistent instructions and context that Claude Code reads for every session. This is Claude Code-specific configuration that gets symlinked to `~/.claude/CLAUDE.md`.

**Note**: The main project AI assistant documentation is located at `/Users/danteay/.config/nix-modules/AI.md` - this is a universal reference guide for all AI assistants (Claude, Gemini, Copilot, etc.).

## Usage

### Enabling in Home Manager

Add to your profile's `default.nix`:

```nix
{
  imports = [
    ../modules/ai/claude-code.nix
  ];
}
```

Then rebuild:

```bash
home-manager switch -b backup --impure --flake ~/.config/nix-modules/home-manager#$(whoami)
```

### Using Custom Skills

In Claude Code, invoke skills with slash commands:

```
/nix-rebuild home
/nix-search golang
/git-cleanup
/go-test-coverage ./internal/...
```

### Adding New Skills

1. Create a new `.md` file in `skills/` directory
2. Use the format:
   ```markdown
   # /skill-name

   Brief description

   ## Usage
   Command syntax

   ## Description
   Detailed explanation

   ## Steps
   Implementation steps
   ```
3. Rebuild home-manager to activate

### Adding New Agents

1. Create a new `.md` file in `agents/` directory
2. Define expertise areas and behavior guidelines
3. Rebuild home-manager to activate

### Adding New Rules

1. Create a new `.md` file in `rules/` directory
2. Document standards and conventions
3. Rebuild home-manager to activate

## Configuration

The Nix module (`home-manager/modules/ai/claude-code.nix`) provides:

- Automatic loading of all agents, rules, and skills
- Hook to run `nixpkgs-fmt` after editing Nix files
- Permission controls for safe operations
- Custom status line and theme settings

## Customization

Edit files in this directory to customize behavior. Changes take effect after:

```bash
home-manager switch -b backup --impure --flake ~/.config/nix-modules/home-manager#$(whoami)
```

## References

- [Claude Code Documentation](https://code.claude.com/docs)
- [Home Manager Claude Code Options](https://mynixos.com/home-manager/option/programs.claude-code.settings)
- [Claude Config Nix Example](https://github.com/flyinggrizzly/claude-config.nix)
