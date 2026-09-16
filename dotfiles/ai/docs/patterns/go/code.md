# Go Code Patterns

> Constructor injection, functional options, provider pattern, and service configuration in Go.

---

## Constructor Injection

All dependencies are passed to the constructor. Zero hidden dependencies.

```go
// domain interface (defined where it's consumed)
type OrderRepository interface {
    Save(ctx context.Context, order domain.Order) error
    FindByID(ctx context.Context, id domain.OrderID) (domain.Order, error)
}

type EventPublisher interface {
    Publish(ctx context.Context, event domain.Event) error
}

// service receives deps via constructor
type OrderService struct {
    repo      OrderRepository
    publisher EventPublisher
    tracer    trace.Tracer
    clock     func() time.Time  // injectable for testing
}

func NewOrderService(
    repo OrderRepository,
    publisher EventPublisher,
    tracer trace.Tracer,
) *OrderService {
    return &OrderService{
        repo:      repo,
        publisher: publisher,
        tracer:    tracer,
        clock:     time.Now,
    }
}
```

---

## Functional Options

For constructors with many optional parameters:

```go
type clientOptions struct {
    timeout    time.Duration
    retries    int
    baseURL    string
    httpClient *http.Client
    logger     *slog.Logger
}

type Option func(*clientOptions)

func WithTimeout(d time.Duration) Option {
    return func(o *clientOptions) { o.timeout = d }
}

func WithRetries(n int) Option {
    return func(o *clientOptions) { o.retries = n }
}

func WithHTTPClient(c *http.Client) Option {
    return func(o *clientOptions) { o.httpClient = c }
}

func NewClient(baseURL string, opts ...Option) *Client {
    o := &clientOptions{
        timeout: 30 * time.Second,  // defaults
        retries: 3,
        baseURL: baseURL,
    }
    for _, opt := range opts {
        opt(o)
    }
    if o.httpClient == nil {
        o.httpClient = &http.Client{Timeout: o.timeout}
    }
    return &Client{opts: o}
}

// Usage
client := NewClient("https://api.example.com",
    WithTimeout(10*time.Second),
    WithRetries(5),
)
```

---

## Interface Segregation

Define small interfaces at the consumer side:

```go
// WRONG — fat interface forces consumers to mock everything
type Store interface {
    SaveOrder(ctx context.Context, o Order) error
    FindOrder(ctx context.Context, id string) (Order, error)
    SaveUser(ctx context.Context, u User) error
    FindUser(ctx context.Context, id string) (User, error)
    RunMigration(ctx context.Context) error
}

// CORRECT — small interfaces, defined at consumer
// In order service:
type orderSaver interface {
    SaveOrder(ctx context.Context, o Order) error
}
type orderFinder interface {
    FindOrder(ctx context.Context, id string) (Order, error)
}

// Service only depends on what it needs
type OrderService struct {
    saver  orderSaver
    finder orderFinder
}
```

---

## Service Configuration

Typed config struct with validation at startup:

```go
type Config struct {
    // DynamoDB
    TableName string
    GSIName   string

    // SNS
    TopicARN string

    // SQS
    QueueURL string

    // Service
    Region      string
    LogLevel    string
    ServiceName string

    // Computed / defaults
    MaxRetries int
    Timeout    time.Duration
}

func LoadConfig() (Config, error) {
    cfg := Config{
        ServiceName: "order-service",
        Region:      getEnv("AWS_REGION", "us-east-2"),
        LogLevel:    getEnv("LOG_LEVEL", "info"),
        MaxRetries:  3,
        Timeout:     30 * time.Second,
    }

    var missing []string
    cfg.TableName = os.Getenv("TABLE_NAME")
    if cfg.TableName == "" { missing = append(missing, "TABLE_NAME") }

    cfg.TopicARN = os.Getenv("TOPIC_ARN")
    if cfg.TopicARN == "" { missing = append(missing, "TOPIC_ARN") }

    if len(missing) > 0 {
        return Config{}, fmt.Errorf("missing required env vars: %s", strings.Join(missing, ", "))
    }
    return cfg, nil
}

func getEnv(key, fallback string) string {
    if v := os.Getenv(key); v != "" { return v }
    return fallback
}
```

**Entry point (fail fast):**

```go
func main() {
    cfg, err := config.Load()
    if err != nil {
        slog.Error("config", "err", err)
        os.Exit(1)
    }

    // Wire all dependencies
    dynamoClient := aws.NewDynamoClient(cfg.Region)
    snsClient    := aws.NewSNSClient(cfg.Region)
    tracer       := otel.NewTracer(cfg.ServiceName)

    repo      := repository.NewDynamo(dynamoClient, cfg.TableName)
    publisher := events.NewSNSPublisher(snsClient, cfg.TopicARN)
    service   := service.NewOrderService(repo, publisher, tracer)
    worker    := worker.New(service)
    handler   := handler.New(worker)

    lambda.Start(handler.Handle)
}
```

---

## Provider Pattern

Register multiple providers with a common lifecycle:

```go
type Provider interface {
    Name() string
    Init(ctx context.Context, cfg Config) error
    Close(ctx context.Context) error
}

type Registry struct {
    providers []Provider
}

func (r *Registry) Register(p Provider) {
    r.providers = append(r.providers, p)
}

func (r *Registry) Start(ctx context.Context, cfg Config) error {
    for _, p := range r.providers {
        if err := p.Init(ctx, cfg); err != nil {
            return fmt.Errorf("init provider %s: %w", p.Name(), err)
        }
    }
    return nil
}

func (r *Registry) Shutdown(ctx context.Context) {
    for i := len(r.providers) - 1; i >= 0; i-- {
        if err := r.providers[i].Close(ctx); err != nil {
            slog.Error("close provider", "name", r.providers[i].Name(), "err", err)
        }
    }
}
```

---

## Error Wrapping and Propagation

```go
// Domain errors — sentinel values in domain package
var (
    ErrNotFound      = errors.New("not found")
    ErrAlreadyExists = errors.New("already exists")
    ErrInvalidInput  = errors.New("invalid input")
)

// Wrap with context at every layer boundary
func (r *DynamoRepository) FindByID(ctx context.Context, id string) (Order, error) {
    result, err := r.client.GetItem(ctx, input)
    if err != nil {
        var notFound *types.ResourceNotFoundException
        if errors.As(err, &notFound) {
            return Order{}, fmt.Errorf("order %s: %w", id, domain.ErrNotFound)
        }
        return Order{}, fmt.Errorf("dynamo get item %s: %w", id, err)
    }
    return unmarshal(result.Item)
}

// Check in handler
if errors.Is(err, domain.ErrNotFound) {
    return http.StatusNotFound, nil
}
```

---

## Table-Driven Tests (Pattern for Code With Many Cases)

```go
func Test_Validate_OrderCmd(t *testing.T) {
    t.Parallel()

    tests := []struct {
        name    string
        cmd     PlaceOrderCmd
        wantErr error
    }{
        {
            name:    "valid command",
            cmd:     PlaceOrderCmd{CustomerID: "cust-1", Amount: 100},
            wantErr: nil,
        },
        {
            name:    "missing customer id",
            cmd:     PlaceOrderCmd{Amount: 100},
            wantErr: domain.ErrInvalidInput,
        },
        {
            name:    "zero amount",
            cmd:     PlaceOrderCmd{CustomerID: "cust-1", Amount: 0},
            wantErr: domain.ErrInvalidInput,
        },
    }

    for _, tc := range tests {
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            err := validate(tc.cmd)
            if tc.wantErr != nil {
                require.ErrorIs(t, err, tc.wantErr)
            } else {
                require.NoError(t, err)
            }
        })
    }
}
```

---

## Cross-References

→ [General Code Patterns](../general/code.md) | [Go Conventions](../../conventions/go/index.md) | [Go Concurrency](./concurrency.md) | [Go Testing](./testing.md)
