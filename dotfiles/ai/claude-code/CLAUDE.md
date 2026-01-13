# Claude Code Personal Configuration

This is your personalized configuration for Claude Code.

## Working Style

- I prefer concise, direct communication
- Focus on practical solutions over theoretical discussions
- Show code examples when explaining concepts
- Break down complex tasks into manageable steps

## Project Context

This configuration is part of a personal Nix configuration repository managing:

- macOS system configuration via nix-darwin
- User environment via home-manager
- Multiple user profiles (danteay, draftea)
- Development tools and language environments

## Preferences

### Code Style

- Follow language-specific idioms and conventions
- Prefer clarity and maintainability over cleverness
- Include tests for new functionality
- Document complex logic and architectural decisions inside `docs` folder of the affected modules

### Nix Configuration

- Use flakes for all new configurations
- Keep modules focused and reusable
- Separate user-specific config from general modules
- Test changes before committing

### Development Workflow

- Use git with conventional commits (check commitizen config file if exists)
- Run formatters and linters before committing
- Keep dependencies minimal and up-to-date
- Prioritize security in all code changes

## Available Custom Skills

- `/nix-rebuild` - Rebuild home-manager or nix-darwin configurations
- `/nix-search` - Search for packages in nixpkgs
- `/git-cleanup` - Clean up merged and stale Git branches
- `/go-test-coverage` - Run Go tests with coverage analysis

## Expert Agents Available

- **nix-expert**: For Nix, home-manager, and nix-darwin help
- **golang-expert**: For Go programming assistance
- **devops-expert**: For infrastructure and DevOps tasks
- **senior-software-architect**: For system design, cloud architecture, and building resilient/scalable solutions
