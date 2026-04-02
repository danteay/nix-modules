# Go Conventions

> Naming, error handling, project structure, tooling, and idioms for Go services.

## Version

Always use the **latest stable Go release**. Define in `flake.nix` and `go.mod`:

```nix
packages = [ pkgs.go pkgs.golangci-lint pkgs.gotools pkgs.mockery ];
```

```go
// go.mod
module github.com/org/service

go 1.25
```

---

## Naming

| Construct | Convention | Example |
|-----------|-----------|---------|
| Package | lowercase, single word, no underscores | `service`, `repository`, `domain` |
| File | snake_case | `order_service.go`, `dynamo_repository.go` |
| Type / Interface | PascalCase | `OrderService`, `EventPublisher` |
| Exported function / method | PascalCase | `PlaceOrder`, `FindByID` |
| Unexported function / method | camelCase | `buildQuery`, `validateInput` |
| Variable | camelCase | `orderID`, `customerID`, `ctx` |
| Constant | PascalCase (exported), camelCase (unexported) | `StatusPending`, `maxRetries` |
| Error variable | `Err` prefix | `ErrNotFound`, `ErrInvalidInput` |
| Context | always named `ctx` as first parameter | — |
| ID fields | `{Entity}ID` | `OrderID`, `CustomerID` |
| Test helper | `Test` prefix or use `testutil` package | `TestMain`, `testutil.NewClient` |

---

## Error Handling

### Sentinel Errors

```go
// domain/errors.go — the canonical error types
var (
    ErrNotFound           = errors.New("not found")
    ErrAlreadyExists      = errors.New("already exists")
    ErrInvalidInput       = errors.New("invalid input")
    ErrInsufficientFunds  = errors.New("insufficient funds")
    ErrInvalidState       = errors.New("invalid state transition")
    ErrPermissionDenied   = errors.New("permission denied")
)
```

### Wrapping and Propagation

```go
// Wrap at every layer boundary with context
func (r *DynamoRepository) FindByID(ctx context.Context, id domain.OrderID) (domain.Order, error) {
    result, err := r.client.GetItem(ctx, &dynamodb.GetItemInput{...})
    if err != nil {
        // Translate infrastructure errors to domain errors
        var notFound *types.ResourceNotFoundException
        if errors.As(err, &notFound) {
            return domain.Order{}, fmt.Errorf("find order %s: %w", id, domain.ErrNotFound)
        }
        return domain.Order{}, fmt.Errorf("dynamo get item %s: %w", id, err)
    }
    if result.Item == nil {
        return domain.Order{}, fmt.Errorf("order %s: %w", id, domain.ErrNotFound)
    }
    return unmarshal(result.Item)
}

// Handler checks error type
func mapError(err error) int {
    switch {
    case errors.Is(err, domain.ErrNotFound):         return http.StatusNotFound
    case errors.Is(err, domain.ErrAlreadyExists):    return http.StatusConflict
    case errors.Is(err, domain.ErrInvalidInput):     return http.StatusUnprocessableEntity
    case errors.Is(err, domain.ErrPermissionDenied): return http.StatusForbidden
    default:                                          return http.StatusInternalServerError
    }
}
```

### Never Do

```go
_ = repo.Save(ctx, order)        // WRONG: ignored error
if err != nil { return err }     // OK but add context
if err != nil { panic(err) }     // WRONG: panic in business logic
```

---

## Interfaces

Define interfaces at the consumer. Keep them small.

```go
// service/order_service.go — service defines what it needs
type orderRepository interface {
    Save(ctx context.Context, order domain.Order) error
    FindByID(ctx context.Context, id domain.OrderID) (domain.Order, error)
}

// One-method interfaces are common and encouraged
type eventPublisher interface {
    Publish(ctx context.Context, event any) error
}
```

**Accept interfaces, return concrete types:**

```go
// GOOD — accepts interface (flexible), returns concrete (safe)
func NewOrderService(repo orderRepository, pub eventPublisher) *OrderService

// WRONG — returns interface (hides useful methods)
func NewOrderService(repo orderRepository) OrderServiceInterface
```

---

## Context

```go
// Always first parameter, always named ctx
func (s *Service) Place(ctx context.Context, cmd PlaceOrderCmd) (Order, error)

// Never store in structs
type Service struct {
    ctx context.Context  // WRONG
}

// Pass context to all I/O functions
order, err := s.repo.FindByID(ctx, id)  // CORRECT
order, err := s.repo.FindByID(context.Background(), id)  // WRONG (loses cancellation)
```

---

## Logging with slog

```go
import "log/slog"

// Structured, leveled logging (Go 1.21+)
slog.InfoContext(ctx, "order placed",
    slog.String("order_id", order.ID.String()),
    slog.String("customer_id", order.CustomerID.String()),
    slog.Int("item_count", len(order.Items)),
)

slog.ErrorContext(ctx, "failed to save order",
    slog.String("order_id", order.ID.String()),
    slog.Any("error", err),
)

// Use WithGroup for request-scoped fields
logger := slog.Default().With(
    slog.String("request_id", requestID),
    slog.String("user_id", userID),
)
```

---

## OpenTelemetry Tracing

```go
func (s *OrderService) Place(ctx context.Context, cmd PlaceOrderCmd) (Order, error) {
    ctx, span := s.tracer.Start(ctx, "OrderService.Place",
        trace.WithAttributes(
            attribute.String("customer.id", cmd.CustomerID.String()),
        ),
    )
    defer span.End()

    order, err := s.doPlace(ctx, cmd)
    if err != nil {
        span.RecordError(err)
        span.SetStatus(codes.Error, err.Error())
        return Order{}, err
    }

    span.SetAttributes(attribute.String("order.id", order.ID.String()))
    return order, nil
}
```

---

## Code Style Rules

```go
// Group imports: stdlib, external, internal
import (
    "context"
    "fmt"
    "time"

    "github.com/aws/aws-sdk-go-v2/service/dynamodb"
    "go.opentelemetry.io/otel/trace"

    "github.com/org/service/go/domains/order/domain"
)

// Use named returns only for documentation or defer, not for brevity
func divide(a, b float64) (result float64, err error) { ... }  // only if named return adds clarity

// Prefer early returns over nested ifs
func process(order Order) error {
    if order.ID == "" {
        return fmt.Errorf("order id: %w", domain.ErrInvalidInput)
    }
    if order.CustomerID == "" {
        return fmt.Errorf("customer id: %w", domain.ErrInvalidInput)
    }
    return doProcess(order)  // happy path at bottom
}
```

---

## Tooling

| Tool | Purpose | Run |
|------|---------|-----|
| `golangci-lint` | Comprehensive linting | `golangci-lint run ./...` |
| `goimports` | Format + organize imports | `goimports -w ./...` |
| `mockery` | Generate mocks | `mockery --all` |
| `govulncheck` | CVE scan | `govulncheck ./...` |
| `go vet` | Static analysis | `go vet ./...` |
| `staticcheck` | Advanced static analysis | included in golangci-lint |

**`.golangci.yml` minimum linters:**

```yaml
linters:
  enable:
    - errcheck
    - govet
    - staticcheck
    - gosec
    - revive
    - goimports
    - misspell
    - noctx
    - exhaustive   # exhaustive switch on enums
    - wrapcheck    # ensure errors are wrapped
```

---

## Cross-References

→ [Go Code Patterns](../../patterns/go/code.md) | [Go Concurrency Patterns](../../patterns/go/concurrency.md) | [Go Testing Patterns](../../patterns/go/testing.md) | [Go Testing Guide](../../testing/go/guide.md) | [Common Pitfalls](../general/common-pitfalls.md)
