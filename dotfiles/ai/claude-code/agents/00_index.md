# AI Agent Profiles

> Specialized AI personas for different development tasks.

## Quick Selection

| Task | Agent |
|------|-------|
| Implement feature | [Developer](./developer.md) |
| Design architecture | [Architect](./architect.md) |
| Review PR | [Code Reviewer](./code-reviewer.md) |
| Write tests | [Tester](./tester.md) |
| Integration / E2E / smoke / contract tests | [QA Developer](./qa-developer.md) |
| Debug issue | [Debugger](./debugger.md) |
| Refactor code | [Refactorer](./refactorer.md) |
| Manage infrastructure | [DevOps](./devops.md) |
| Build developer tooling | [DevExp Developer](./devexp-developer.md) |
| Orchestrate dev workflow / PR review | [Orchestrator Dev](./orchestrator-dev.md) |

## Agents

### [Developer](./developer.md)
Primary agent for feature implementation. Use for: HTTP endpoints, repository methods, service logic, use cases, event consumers, tests.

### [Architect](./architect.md)
System design and architecture decisions. Use for: Planning features, architectural reviews, design discussions, technology selection.

### [Code Reviewer](./code-reviewer.md)
Code review with Draftea standards. Use for: PR reviews, standards compliance, security review, documentation quality.

### [Tester](./tester.md)
Testing strategy and test writing. Use for: Test suites, coverage analysis, test pattern guidance, mock strategy.

### [QA Developer](./qa-developer.md)
Senior QA engineer for cloud services. Use for: Integration tests, end-to-end tests, smoke/flow tests, service contract validation, data consistency assertions — language and platform agnostic, blackbox-focused.

### [Debugger](./debugger.md)
Debugging and troubleshooting. Use for: Bug investigation, log/trace analysis, root cause analysis, performance profiling.

### [Refactorer](./refactorer.md)
Code refactoring specialist. Use for: Improving structure, removing duplication, cleanup, updating patterns.

### [DevOps](./devops.md)
Infrastructure and deployment. Use for: AWS infrastructure (Lambda, DynamoDB, S3, SNS, SQS, CloudFormation, SecretsManager), Serverless configs, PKL, secrets, CI/CD, monitoring.

### [DevExp Developer](./devexp-developer.md)
Developer experience and tooling. Use for: CLIs, Taskfile targets, plugins, pipeline configs, Nix dev shells, Claude agents/skills, code generators, scaffolding tools.

### [Orchestrator Dev](./orchestrator-dev.md)
High-level workflow orchestrator for development and PR review. Use for: end-to-end feature development (requirement → branch → implementation → PR), structured PR reviews with interactive discussion.

## Examples (On-Demand)

Load these only when needed:

- [Implementation Scenarios](./examples/implementation-scenarios.md) - Developer scenarios and anti-patterns
- [DevOps Infrastructure](./examples/devops-infrastructure.md) - Complete Serverless configs, PKL, IAM
- [Output Templates](./examples/output-templates.md) - Standard output formats for all agents

## Decision Tree

```
Need to implement a feature?      → Developer
Need to design architecture?      → Architect
Need to review code?              → Code Reviewer
Need to write tests?              → Tester
Need integration/E2E/smoke tests? → QA Developer
Need to debug an issue?           → Debugger
Need to refactor code?            → Refactorer
Need to manage infrastructure?    → DevOps
Need to build developer tooling?  → DevExp Developer
Need to update task automation?   → DevExp Developer
Need to run a full dev workflow?  → Orchestrator Dev
Need to review a PR end-to-end?   → Orchestrator Dev
```

## Cross-References

→ [Documentation Index](../docs/)
