# Conventions — Go

> Go-specific coding standards: naming, error handling, interfaces, logging, and tooling.

---

## Contents

| File | Description |
|------|-------------|
| [Go Conventions](./index.md) | Full Go conventions: naming table, project structure, error handling (sentinel + wrapping), interfaces (accept/return concrete), context rules, slog structured logging, OpenTelemetry tracing, import grouping, golangci-lint config |

---

## Key Rules (Quick Reference)

- Errors: wrap with `%w`, sentinel errors for `errors.Is`, `mapError` at boundaries
- Interfaces: accept interfaces in function parameters, return concrete types
- Context: first param in all I/O functions, never `context.Background()` inside business logic
- Logging: `slog` with structured fields, JSON in prod, never `log.Print`
- Linting: `golangci-lint` with `errcheck`, `gocritic`, `gosec` enabled

---

## Cross-References

→ [Conventions Index](../00_index.md) | [Go Patterns](../../patterns/go/00_index.md) | [Go Testing](../../testing/go/00_index.md)
