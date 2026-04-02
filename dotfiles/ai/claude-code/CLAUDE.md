# Claude Code Personal Configuration

This is your personalized configuration for Claude Code.

## Working Style

- I prefer concise, direct communication
- Focus on practical solutions over theoretical discussions
- Show code examples when explaining concepts
- Break down complex tasks into manageable steps

## Preferences

### Code Style

- Follow language-specific idioms and conventions
- Prefer clarity and maintainability over cleverness
- Include tests for new functionality
- Document complex logic and architectural decisions inside `docs` folder of the affected modules

### Nix Configuration

- Use flakes with flake-parts for all new configurations
- Keep modules focused and reusable
- Separate user-specific config from general modules
- Test changes before committing

### Development Workflow

- Use git with conventional commits (check commitizen config file if exists)
- Run formatters and linters before committing
- Keep dependencies minimal and up-to-date
- Prioritize security in all code changes
