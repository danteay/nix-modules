# /go-test-coverage

Run Go tests with coverage report and analysis.

## Usage

```
/go-test-coverage [package-path]
```

## Description

This skill runs Go tests with coverage analysis:
- Executes tests with coverage tracking
- Generates coverage report
- Highlights uncovered code sections
- Suggests areas needing test improvement

## Steps

When user invokes this skill:

1. Determine package path (default to ./... for all packages)
2. Run: `go test -coverprofile=coverage.out -covermode=atomic [package-path]`
3. Generate HTML coverage report: `go tool cover -html=coverage.out -o coverage.html`
4. Parse coverage statistics
5. Display summary:
   - Total coverage percentage
   - Per-package coverage breakdown
   - Files with lowest coverage
6. Open coverage.html for detailed review
7. Suggest specific functions/files that need tests

## Examples

- `/go-test-coverage` - Test all packages
- `/go-test-coverage ./internal/...` - Test internal packages only
