# Go Testing Guide

> Comprehensive guide: unit tests, integration tests, handler tests, and tooling in Go.

---

## Setup

```nix
# nix dev shell — testing tools
packages = with pkgs; [
  go_1_24
  mockery         # mock generation
  gotestsum       # better test output
  go-test-coverage
];
```

```bash
# Run all tests
go test ./...

# Run with race detector (always in CI)
go test -race ./...

# Run with coverage
go test ./... -coverprofile=coverage.out -covermode=atomic
go tool cover -html=coverage.out -o coverage.html

# Run specific test
go test ./go/domains/order/service/... -run Test_OrderService_Place -v

# Run with gotestsum (nicer output)
gotestsum --format testdox ./...
```

---

## Unit Tests

### File Organization

```
service/
├── order_service.go
└── order_service_test.go   # same package OR service_test (external)
```

Use `package service_test` (external) for pure blackbox tests. Use `package service` when you need access to unexported helpers.

### Test Structure

```go
package service_test

import (
    "testing"

    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/mock"
    "github.com/stretchr/testify/require"

    "github.com/org/service/go/domains/order/domain"
    "github.com/org/service/go/domains/order/mocks"
    "github.com/org/service/go/domains/order/service"
    "github.com/org/service/go/pkg/testutil/tmock"
)

func Test_OrderService_Place_Success(t *testing.T) {
    t.Parallel()

    // Arrange
    mockRepo := mocks.NewMockOrderRepository(t)
    mockPub  := mocks.NewMockEventPublisher(t)

    mockRepo.EXPECT().
        Save(tmock.AnyContext(), mock.MatchedBy(func(o domain.Order) bool {
            return o.CustomerID == "cust-123"
        })).
        Return(nil).Once()

    mockPub.EXPECT().
        Publish(tmock.AnyContext(), mock.AnythingOfType("domain.OrderPlaced")).
        Return(nil).Once()

    svc := service.New(mockRepo, mockPub)

    // Act
    order, err := svc.Place(t.Context(), domain.PlaceOrderCmd{
        CustomerID: "cust-123",
        Items:      []domain.OrderItem{{SKU: "sku-1", Qty: 1}},
    })

    // Assert
    require.NoError(t, err)
    assert.Equal(t, "cust-123", order.CustomerID)
    assert.NotEmpty(t, order.ID)
    // expectations verified automatically by t-based mocks
}
```

### Parallel Subtests

```go
func Test_OrderService_Place_ValidationErrors(t *testing.T) {
    t.Parallel()

    cases := []struct {
        name    string
        cmd     domain.PlaceOrderCmd
        wantErr error
    }{
        {"no customer", domain.PlaceOrderCmd{Items: []domain.OrderItem{{SKU: "s1"}}}, domain.ErrInvalidInput},
        {"no items",    domain.PlaceOrderCmd{CustomerID: "c1"}, domain.ErrInvalidInput},
    }

    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()

            svc := service.New(nil, nil)  // nil deps — should fail before using them
            _, err := svc.Place(t.Context(), tc.cmd)

            require.ErrorIs(t, err, tc.wantErr)
        })
    }
}
```

---

## Integration Tests

### LocalStack DynamoDB

```go
// go/pkg/testutil/localstack.go
package testutil

import (
    "context"
    "fmt"
    "os"
    "testing"

    "github.com/aws/aws-sdk-go-v2/aws"
    "github.com/aws/aws-sdk-go-v2/config"
    "github.com/aws/aws-sdk-go-v2/credentials"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

func NewDynamoClient(t *testing.T) *dynamodb.Client {
    t.Helper()
    endpoint := os.Getenv("LOCALSTACK_URL")
    if endpoint == "" {
        endpoint = "http://localhost:4566"
    }

    cfg, err := config.LoadDefaultConfig(context.Background(),
        config.WithRegion("us-east-2"),
        config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider("test", "test", "")),
        config.WithEndpointResolverWithOptions(
            aws.EndpointResolverWithOptionsFunc(func(service, region string, options ...interface{}) (aws.Endpoint, error) {
                return aws.Endpoint{URL: endpoint}, nil
            }),
        ),
    )
    require.NoError(t, err)
    return dynamodb.NewFromConfig(cfg)
}

func CreateOrderTable(t *testing.T, client *dynamodb.Client, tableName string) {
    t.Helper()
    _, err := client.CreateTable(context.Background(), &dynamodb.CreateTableInput{
        TableName:   aws.String(tableName),
        BillingMode: types.BillingModePayPerRequest,
        AttributeDefinitions: []types.AttributeDefinition{
            {AttributeName: aws.String("pk"), AttributeType: types.ScalarAttributeTypeS},
            {AttributeName: aws.String("sk"), AttributeType: types.ScalarAttributeTypeS},
        },
        KeySchema: []types.KeySchemaElement{
            {AttributeName: aws.String("pk"), KeyType: types.KeyTypeHash},
            {AttributeName: aws.String("sk"), KeyType: types.KeyTypeRange},
        },
    })
    require.NoError(t, err)
    t.Cleanup(func() {
        client.DeleteTable(context.Background(), &dynamodb.DeleteTableInput{
            TableName: aws.String(tableName),
        })
    })
}
```

### Test Wrapper Pattern

```go
// go/domains/order/repository/repository_test.go
package repository_test

type testWrapper struct {
    t      *testing.T
    repo   domain.OrderRepository
    client *dynamodb.Client
    table  string
}

func newTestWrapper(t *testing.T) *testWrapper {
    t.Helper()
    client := testutil.NewDynamoClient(t)
    table  := fmt.Sprintf("orders-%s", strings.ReplaceAll(t.Name(), "/", "-"))
    testutil.CreateOrderTable(t, client, table)

    return &testWrapper{
        t:      t,
        repo:   repository.NewDynamo(client, table),
        client: client,
        table:  table,
    }
}

func (tw *testWrapper) createOrder(t *testing.T, order domain.Order) {
    t.Helper()
    err := tw.repo.Save(context.Background(), order)
    require.NoError(t, err)
}

func Test_Repository_FindPending(t *testing.T) {
    t.Parallel()
    tw := newTestWrapper(t)

    tw.createOrder(t, domain.Order{ID: "1", Status: "placed"})
    tw.createOrder(t, domain.Order{ID: "2", Status: "shipped"})

    results, err := tw.repo.FindPending(t.Context())
    require.NoError(t, err)
    require.Len(t, results, 1)
    assert.Equal(t, "1", results[0].ID)
}
```

---

## Handler Tests (Real Services)

```go
type handlerTestWrapper struct {
    t       *testing.T
    handler http.Handler
    snsMock *snsmocks.MockSNSClient
    repo    domain.OrderRepository
}

func newHandlerTestWrapper(t *testing.T) *handlerTestWrapper {
    t.Helper()

    // Real infrastructure
    dynamoClient := testutil.NewDynamoClient(t)
    testutil.CreateOrderTable(t, dynamoClient, testTableName)
    repo := repository.NewDynamo(dynamoClient, testTableName)

    // Mocked external infra only
    snsMock   := snsmocks.NewMockSNSClient(t)
    publisher := events.NewSNSPublisher(snsMock, "arn:aws:sns:us-east-2:000000000000:orders")

    // Real business logic
    svc     := service.New(repo, publisher)
    worker  := worker.New(svc)
    handler := handler.New(worker)

    return &handlerTestWrapper{t: t, handler: handler, snsMock: snsMock, repo: repo}
}

func (tw *handlerTestWrapper) post(path string, body any) *httptest.ResponseRecorder {
    tw.t.Helper()
    data, _ := json.Marshal(body)
    req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(data))
    req.Header.Set("Content-Type", "application/json")
    rr := httptest.NewRecorder()
    tw.handler.ServeHTTP(rr, req)
    return rr
}

func Test_Handler_CreateOrder_Success(t *testing.T) {
    t.Parallel()
    tw := newHandlerTestWrapper(t)

    tw.snsMock.EXPECT().
        Publish(mock.Anything, mock.MatchedBy(func(in *sns.PublishInput) bool {
            var event map[string]any
            json.Unmarshal([]byte(aws.ToString(in.Message)), &event)
            return event["type"] == "OrderPlaced"
        })).
        Return(&sns.PublishOutput{}, nil)

    resp := tw.post("/v1/orders", map[string]any{
        "customer_id": "cust-1",
        "items":       []map[string]any{{"sku": "sku-1", "qty": 2}},
    })

    require.Equal(t, http.StatusCreated, resp.Code)
}
```

---

## TestMain (Suite-Level Setup)

```go
// go/domains/order/repository/main_test.go
func TestMain(m *testing.M) {
    // Start LocalStack once for all tests in this package
    pool, err := dockertest.NewPool("")
    if err != nil { log.Fatal(err) }

    resource, err := pool.RunWithOptions(&dockertest.RunOptions{
        Repository: "localstack/localstack",
        Tag:        "latest",
        Env:        []string{"SERVICES=dynamodb"},
    })
    if err != nil { log.Fatal(err) }

    os.Setenv("LOCALSTACK_URL", fmt.Sprintf("http://localhost:%s", resource.GetPort("4566/tcp")))

    code := m.Run()

    pool.Purge(resource)
    os.Exit(code)
}
```

---

## Coverage

```bash
# Generate and view coverage
go test ./... -coverprofile=coverage.out -covermode=atomic -race
go tool cover -func=coverage.out | grep total
go tool cover -html=coverage.out -o coverage.html

# Fail if below threshold (in CI)
COVERAGE=$(go tool cover -func=coverage.out | awk '/total:/ {gsub(/%/, ""); print $3}')
if [ $(echo "$COVERAGE < 80" | bc) -eq 1 ]; then
  echo "Coverage ${COVERAGE}% below 80% threshold"
  exit 1
fi
```

---

## Cross-References

→ [Go Testing Patterns](../../patterns/go/testing.md) | [General Strategies](../general/strategies.md) | [Mock Generation](../../guides/mock-generation.md)
