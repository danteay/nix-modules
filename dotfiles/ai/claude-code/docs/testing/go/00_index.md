# Testing — Go

> Go test setup, patterns, and guides.

---

## Contents

| File | Description |
|------|-------------|
| [Guide](./guide.md) | Full Go testing guide: gotestsum setup, unit tests with testify/mockery, parallel subtests, LocalStack integration, handler tests, TestMain, coverage commands |

---

## Quick Reference

- **Test command:** `gotestsum ./...`
- **Coverage:** `go test -coverprofile=coverage.out ./...`
- **Mocking:** `mockery` (generates EXPECT-style mocks)
- **Integration:** `testcontainers-go` + LocalStack

---

## Cross-References

→ [Testing Index](../00_index.md) | [Go Patterns — Testing](../../patterns/go/testing.md) | [Go Conventions](../../conventions/go/00_index.md)
