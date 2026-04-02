# Implementation Scenarios

> Practical examples and anti-patterns for the Developer Agent. Load this file on-demand when implementing specific features.

## Scenario 1: New CRUD Endpoint

**Requirement:** Add a POST /users endpoint

**Implementation order:**

1. **Domain model** (`go/domains/users/domain/models.go`)
2. **Domain errors** (`go/domains/users/domain/errors.go`)
3. **Repository** → Service → UseCase (if needed) → Handler
4. **Tests** at each layer

```go
// 1. Domain model
type User struct {
    ID        string
    Email     string
    Name      string
    CreatedAt time.Time
}

// 2. Domain errors
var (
    ErrInvalidEmail = errors.New("users: invalid email")
    ErrUserExists   = errors.New("users: user already exists")
)

// 3. Service with event publishing
func (s *Service) Create(ctx context.Context, user domain.User) (domain.User, error) {
    newCtx, span := tracer.StartSpan(ctx, "domains.users.service.Create")
    defer span.End()

    created, err := s.repo.Create(newCtx, user)
    if err != nil {
        span.RecordError(err)
        return domain.User{}, err
    }

    // Entity event in service layer
    event, _ := types.NewEvent(UserPayload{ID: created.ID}, "user.created", created.ID, "user")
    _ = s.publisher.Publish(newCtx, event)

    return created, nil
}
```

## Scenario 2: Complex Workflow (UseCase)

**Requirement:** Process bet placement (multiple services)

```go
type UseCase struct {
    betService     BetService
    walletService  WalletService
    limitsService  LimitsService
}

func (u *UseCase) Execute(ctx context.Context, input Input) (Output, error) {
    newCtx, span := tracer.StartSpan(ctx, "domains.bets.usecases.placebet.Execute")
    defer span.End()

    // 1. Check limits
    if err := u.limitsService.CheckLimits(newCtx, input.UserID, input.Amount); err != nil {
        return Output{}, err
    }

    // 2. Reserve funds
    if err := u.walletService.ReserveFunds(newCtx, input.UserID, input.Amount); err != nil {
        return Output{}, err
    }

    // 3. Create bet
    bet, err := u.betService.Create(newCtx, domain.Bet{
        UserID: input.UserID,
        Amount: input.Amount,
    })
    if err != nil {
        _ = u.walletService.ReleaseReservation(newCtx, input.UserID, input.Amount)
        return Output{}, err
    }

    return Output{BetID: bet.ID}, nil
}
```

## Scenario 3: Event Consumer

**Requirement:** Consume user.created events

```go
func Worker(r *Resources) consumer.HandlerFunc {
    return func(ctx context.Context, msg types.Message) error {
        newCtx, span := tracer.StartSpan(ctx, "notifications.usercreated.Worker")
        defer span.End()

        var event types.Event[UserCreatedPayload]
        if err := json.Unmarshal(msg.Body(), &event); err != nil {
            return consumer.ErrParseMessage
        }

        return r.UseCase.Execute(newCtx, Input{
            UserID: event.Payload.ID,
            Email:  event.Payload.Email,
        })
    }
}
```

## Anti-Patterns to Avoid

### Layer Skipping
```go
// WRONG: Handler calling repository directly
func Worker(r *Resources) echo.HandlerFunc {
    return func(ec echo.Context) error {
        user, err := r.Repository.Get(ctx, id)  // Skip service layer!
    }
}
```

### String Error Comparison
```go
// WRONG
if strings.Contains(err.Error(), "not found") { ... }

// CORRECT
if errors.Is(err, domain.ErrNotFound) { ... }
```

### Missing Tracing
```go
// WRONG: No tracing
func (s *Service) Create(ctx context.Context, user User) (User, error) {
    return s.repo.Create(ctx, user)
}

// CORRECT
func (s *Service) Create(ctx context.Context, user User) (User, error) {
    newCtx, span := tracer.StartSpan(ctx, "domains.users.service.Create")
    defer span.End()
    // ...
}
```

### Business Logic in Handler
```go
// WRONG: 50 lines of business logic in handler
func Worker(r *Resources) echo.HandlerFunc {
    return func(ec echo.Context) error {
        if user.Balance < order.Amount && user.Type != "premium" {
            // Complex business rules here...
        }
    }
}
// CORRECT: Move to service layer
```

## Example Prompts

**Good:**
- "Implement a new Lambda handler for drift-checks processing"
- "Add caching layer to a service method using Redis with 5-minute TTL"
- "Create an SNS/SQS consumer to handle drift-check events"

**Bad (use different agent):**
- "Review this PR" → code-reviewer
- "Design architecture" → architect
- "Debug timeout" → debugger
