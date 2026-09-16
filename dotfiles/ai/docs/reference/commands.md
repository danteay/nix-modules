# Commands Reference

> Standard task commands across all projects. Actual targets may vary — check the project's `Taskfile.yml`.

## Taskfile (Preferred Task Runner)

All projects use `Taskfile.yml` (task runner). Install: `nix shell nixpkgs#go-task`.

```bash
task --list          # Show all available tasks
task {target}        # Run a task
```

---

## Standard Targets

### Docker Build & Run

```bash
task docker:build             # Compile / build artifacts (it should be able to receive NO_CACHE flag)
task docker:up                # execute docker compose up for project
task docker:down              # down docker compose
task docker:logs -- <service> # it shows logs for specific docker service
```

### Testing

```bash
task test:<lang>:unit
task test:<lang>:coverage

task test             # Run all tests
task test:unit        # Run all by lang golas test:<lang>:unit
task test:coverage    # Run all coverage report by lang test:<lang>:coverage
task test:integration # Integration tests only
task test:e2e         # End-to-end tests
task test:contract    # Contract tests
task test:smoke       # Smoke tests
```

### Code Quality

#### By lang on multi-lang repos

```bash
         # lint + format + typecheck
```

#### General

```bash
task lint:<lang>           # Run linter
task format:<lang>         # format code
task typecheck:[ts|python] # Type check
task verify:<lang>         # lint + format + typecheck

task lint            # execute all by lang lint goals
task format          # execute all by lang format goals
task typecheck       # execute all by lang typecheck goals
task verify          # execute all by lang verify goals
```

### Secrets

```bash
task secrets:encrypt SECRET=<name>                    # ejson encrypt all stage files
task secrets:decrypt SECRET=<name> OUT=<outfile>.json # ejson decrypt for local use
```

### Infrastructure (terraform)

```bash
task tf:init MOD=<path|def=.>     # Initialize module
task tf:workspace MOD=<path|def=.>   # Select active workspace
task tf:plan MOD=<path|def=.>        # Preview infrastructure changes
task tf:apply MOD=<path|def=.>       # Apply infrastructure changes
```

## Cross-References

→ [Deployment Guide](../guides/deployment.md) | [Dev Environment](../guides/dev-environment.md)
