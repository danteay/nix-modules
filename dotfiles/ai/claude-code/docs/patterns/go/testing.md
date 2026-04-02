# Go Testing Patterns

> testify, mockery, t.Parallel, test wrappers, table-driven tests, and integration patterns.

---

## Test Naming Convention

```
Test_{TypeOrFunc}_{Method}_{Scenario}
```

```go
func Test_OrderService_Place_Success(t *testing.T) {}
func Test_OrderService_Place_MissingCustomerID(t *testing.T) {}
func Test_OrderService_Place_RepositoryError(t *testing.T) {}
func Test_DynamoRepository_FindByID_NotFound(t *testing.T) {}
func Test_CreateOrderHandler_Post_InvalidBody(t *testing.T) {}
```

---

## Unit Test (testify + mockery)

```go
import (
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/mock"
    "github.com/stretchr/testify/require"
    tmock "github.com/org/service/go/pkg/testutil/mock"
    "github.com/org/service/go/domains/order/mocks"
)

func Test_OrderService_Place_Success(t *testing.T) {
    t.Parallel()

    // Arrange
    mockRepo := mocks.NewMockOrderRepository(t)
    mockPub  := mocks.NewMockEventPublisher(t)

    mockRepo.EXPECT().
        Save(tmock.AnyContext(), mock.MatchedBy(func(o domain.Order) bool {
            return o.CustomerID == "cust-123" && o.Status == "placed"
        })).
        Return(nil).
        Once()

    mockPub.EXPECT().
        Publish(tmock.AnyContext(), mock.AnythingOfType("domain.OrderPlaced")).
        Return(nil).
        Once()

    svc := service.NewOrderService(mockRepo, mockPub, noop.Tracer)

    // Act
    order, err := svc.Place(t.Context(), domain.PlaceOrderCmd{
        CustomerID: "cust-123",
        Items:      []domain.OrderItem{{SKU: "sku-1", Qty: 2}},
    })

    // Assert
    require.NoError(t, err)
    assert.Equal(t, "cust-123", order.CustomerID)
    assert.NotEmpty(t, order.ID)
    // mockRepo and mockPub expectations verified automatically by NewMock(t)
}
```

---

## Testing Parallel Subtests

```go
func Test_OrderService_Place_ErrorCases(t *testing.T) {
    t.Parallel()

    cases := []struct {
        name    string
        cmd     domain.PlaceOrderCmd
        wantErr error
    }{
        {"no customer", domain.PlaceOrderCmd{}, domain.ErrInvalidInput},
        {"no items",    domain.PlaceOrderCmd{CustomerID: "c1"}, domain.ErrInvalidInput},
    }

    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()  // each subtest runs in parallel

            mockRepo := mocks.NewMockOrderRepository(t)
            // No expectations set — service should fail before calling repo

            svc := service.NewOrderService(mockRepo, nil, noop.Tracer)
            _, err := svc.Place(t.Context(), tc.cmd)

            require.ErrorIs(t, err, tc.wantErr)
        })
    }
}
```

---

## Test Wrapper (Integration Tests)

Encapsulates test infrastructure setup/teardown:

```go
// go/pkg/testutil/wrapper.go
type OrderTestWrapper struct {
    t            *testing.T
    repo         domain.OrderRepository
    dynamoClient *dynamodb.Client
    tableName    string
}

func NewOrderTestWrapper(t *testing.T) *OrderTestWrapper {
    t.Helper()

    client := testutil.NewLocalStackDynamoClient(t)  // starts container or uses existing LocalStack
    tableName := fmt.Sprintf("orders-test-%s", t.Name())
    testutil.CreateOrderTable(t, client, tableName)

    t.Cleanup(func() {
        client.DeleteTable(context.Background(), &dynamodb.DeleteTableInput{
            TableName: aws.String(tableName),
        })
    })

    return &OrderTestWrapper{
        t:            t,
        repo:         repository.NewDynamo(client, tableName),
        dynamoClient: client,
        tableName:    tableName,
    }
}

// Helper: create a test order directly in DynamoDB
func (tw *OrderTestWrapper) CreateOrder(t *testing.T, order domain.Order) domain.Order {
    t.Helper()
    err := tw.repo.Save(context.Background(), order)
    require.NoError(t, err)
    return order
}
```

```go
// Integration test using wrapper
func Test_OrderRepository_FindPending_ReturnsOnlyPending(t *testing.T) {
    t.Parallel()
    tw := NewOrderTestWrapper(t)

    tw.CreateOrder(t, domain.Order{ID: "ord-1", Status: "placed"})
    tw.CreateOrder(t, domain.Order{ID: "ord-2", Status: "shipped"})
    tw.CreateOrder(t, domain.Order{ID: "ord-3", Status: "placed"})

    results, err := tw.repo.FindPending(t.Context())

    require.NoError(t, err)
    assert.Len(t, results, 2)
}
```

---

## Handler Test (Real Services, Mocked Infrastructure)

```go
type HandlerTestWrapper struct {
    t        *testing.T
    handler  *handler.Handler
    snsMock  *snsmocks.MockSNSClient
    // Real services:
    repo     domain.OrderRepository
    service  *service.OrderService
}

func NewHandlerTestWrapper(t *testing.T) *HandlerTestWrapper {
    t.Helper()

    // Real infrastructure
    dynamoClient := testutil.NewLocalStackDynamoClient(t)
    testutil.CreateOrderTable(t, dynamoClient, testTableName)
    repo := repository.NewDynamo(dynamoClient, testTableName)

    // Mocked external infrastructure only
    snsMock := snsmocks.NewMockSNSClient(t)
    publisher := events.NewSNSPublisher(snsMock, "arn:test")

    svc     := service.NewOrderService(repo, publisher, noop.Tracer)
    worker  := worker.New(svc)
    handler := handler.New(worker)

    return &HandlerTestWrapper{
        t: t, handler: handler,
        snsMock: snsMock, repo: repo, service: svc,
    }
}

func (tw *HandlerTestWrapper) POST(path string, body any) *httptest.ResponseRecorder {
    tw.t.Helper()
    data, _ := json.Marshal(body)
    req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(data))
    req.Header.Set("Content-Type", "application/json")
    rr := httptest.NewRecorder()
    tw.handler.ServeHTTP(rr, req)
    return rr
}
```

```go
func Test_CreateOrderHandler_Success(t *testing.T) {
    t.Parallel()
    tw := NewHandlerTestWrapper(t)

    // Only mock infrastructure
    tw.snsMock.EXPECT().
        Publish(mock.Anything, mock.MatchedBy(hasEventType("OrderPlaced"))).
        Return(&sns.PublishOutput{MessageId: aws.String("msg-1")}, nil)

    resp := tw.POST("/v1/orders", map[string]any{
        "customer_id": "cust-1",
        "items": []map[string]any{{"sku": "sku-1", "qty": 2}},
    })

    require.Equal(t, http.StatusCreated, resp.Code)
    var body map[string]any
    json.Unmarshal(resp.Body.Bytes(), &body)
    assert.NotEmpty(t, body["data"].(map[string]any)["id"])
}
```

---

## Mockery Configuration (`.mockery.yaml`)

```yaml
with-expecter: true
mockname: "Mock{{.InterfaceName}}"
filename: "mock_{{snakecase .InterfaceName}}.go"
dir: "{{.InterfaceDir}}/mocks"
outpkg: mocks
inpackage: false
packages:
  github.com/org/service/go/domains/order:
    interfaces:
      OrderRepository:
      EventPublisher:
  github.com/org/service/go/pkg/aws/sns:
    interfaces:
      SNSClient:
```

```bash
mockery --all                    # regenerate all mocks
mockery --name OrderRepository   # single interface
```

**Never edit generated mocks.** Re-generate when the interface changes.

---

## Using `t.Context()` and `require.Eventually`

```go
// t.Context() — context tied to test lifetime (cancelled when test ends)
// Available in Go 1.21+
result, err := repo.FindByID(t.Context(), "ord-1")

// require.Eventually — for async assertions (never use time.Sleep)
require.Eventually(t, func() bool {
    order, _ := repo.FindByID(t.Context(), "ord-1")
    return order.Status == "processed"
}, 10*time.Second, 100*time.Millisecond, "order should be processed within 10s")
```

---

## Test Helpers in `testutil`

```go
// go/pkg/testutil/dynamo.go
func NewLocalStackDynamoClient(t *testing.T) *dynamodb.Client {
    t.Helper()
    cfg, _ := config.LoadDefaultConfig(context.Background(),
        config.WithRegion("us-east-2"),
        config.WithEndpointResolverWithOptions(localstackResolver),
    )
    return dynamodb.NewFromConfig(cfg)
}

// go/pkg/testutil/mock/context.go
func AnyContext() interface{} {
    return mock.MatchedBy(func(ctx context.Context) bool { return ctx != nil })
}
```

---

## Cross-References

→ [General Testing Patterns](../general/testing.md) | [Go Testing Guide](../../testing/go/guide.md) | [Mock Generation](../../guides/mock-generation.md) | [Go Conventions](../../conventions/go/index.md)
