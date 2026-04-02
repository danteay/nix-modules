# AI Agent Profiles

> Specialized AI personas for different development tasks in the Draftea Platform IDP.

## Available Agents

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| [developer](./developer.md) | Feature implementation | Implementing features, writing code |
| [architect](./architect.md) | System design | Planning features, architecture reviews |
| [code-reviewer](./code-reviewer.md) | Code review | PR reviews, standards compliance |
| [tester](./tester.md) | Testing | Writing tests, coverage analysis |
| [debugger](./debugger.md) | Debugging | Investigating bugs, root cause analysis |
| [refactorer](./refactorer.md) | Refactoring | Improving code structure |
| [devops](./devops.md) | Infrastructure | AWS, Serverless, PKL, secrets |
| [devexp-developer](./devexp-developer.md) | Developer tooling | CLIs, Taskfile, pipelines, Nix |

## How to Use

### With Claude Code
```bash
# Reference an agent profile
cat agents/architect.md
```

### With Other AI Tools
- **Cursor:** Settings → Rules for AI → paste agent content
- **Copilot:** Reference in `.github/copilot-instructions.md`
- **Generic:** Copy agent content as context

## Structure

Each agent contains:
- **Role** - What the agent does and delegates
- **Key References** - Docs to read first
- **Workflow/Checklist** - How to approach tasks
- **Constraints** - What to avoid
- **Cross-References** - Related documentation

## Examples (On-Demand)

The `examples/` directory contains detailed content loaded only when needed:
- [implementation-scenarios.md](./examples/implementation-scenarios.md) - Developer examples
- [devops-infrastructure.md](./examples/devops-infrastructure.md) - Infrastructure examples
- [output-templates.md](./examples/output-templates.md) - Output formats

## Relationship to docs/

- **agents/** - AI personas (HOW to behave)
- **docs/** - Development patterns (WHAT to do)

Agents reference docs for technical details, keeping agent files focused on behavior.
