# Testing Patterns (Rust)

> Unit tests, integration tests with testcontainers, mocking traits, and async test setup in Rust.

---

## Test File Organization

```
src/
├── use_cases/
│   ├── place_order.rs
│   └── place_order/
│       └── tests.rs    # or inline #[cfg(test)] mod
tests/
├── integration/
│   ├── order_repo_test.rs
│   └── handler_test.rs
```

Inline unit tests (same file, `#[cfg(test)]` module) are idiomatic for Rust. Use `tests/` for integration tests that test the public API of your crate.

---

## Unit Test Structure

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use mockall::predicate::*;
    use mockall::mock;

    mock! {
        OrderRepository {}

        #[async_trait::async_trait]
        impl OrderRepository for OrderRepository {
            async fn find_by_id(&self, id: &str) -> Result<Order, OrderError>;
            async fn save(&self, order: &Order) -> Result<(), OrderError>;
        }
    }

    #[tokio::test]
    async fn place_order_saves_and_publishes() {
        // Arrange
        let mut mock_repo = MockOrderRepository::new();
        mock_repo
            .expect_save()
            .once()
            .returning(|_| Ok(()));

        let mut mock_publisher = MockEventPublisher::new();
        mock_publisher
            .expect_publish()
            .once()
            .returning(|_| Ok(()));

        let use_case = PlaceOrderUseCase::new(
            Arc::new(mock_repo),
            Arc::new(mock_publisher),
        );

        // Act
        let result = use_case.execute(PlaceOrderCommand {
            customer_id: "cust-1".to_string(),
            items: vec![test_item()],
        }).await;

        // Assert
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn place_order_returns_error_when_repo_fails() {
        let mut mock_repo = MockOrderRepository::new();
        mock_repo
            .expect_save()
            .returning(|_| Err(OrderError::Repository(RepositoryError::DynamoDb("timeout".into()))));

        let use_case = PlaceOrderUseCase::new(Arc::new(mock_repo), Arc::new(MockEventPublisher::new()));

        let result = use_case.execute(test_command()).await;
        assert!(matches!(result, Err(OrderError::Repository(_))));
    }
}
```

---

## Mocking with `mockall`

```toml
# Cargo.toml
[dev-dependencies]
mockall = "0.13"
tokio = { version = "1", features = ["full", "test-util"] }
```

```rust
use mockall::{automock, predicate::eq};

#[automock]  // generates MockOrderRepository
#[async_trait::async_trait]
pub trait OrderRepository: Send + Sync {
    async fn find_by_id(&self, id: &str) -> Result<Order, OrderError>;
}

// In tests
let mut mock = MockOrderRepository::new();
mock.expect_find_by_id()
    .with(eq("order-123"))
    .returning(|_| Ok(test_order()));
```

---

## Test Factories / Builders

```rust
#[cfg(test)]
pub mod factories {
    use super::*;

    pub fn test_order() -> Order {
        Order {
            id: OrderId::new(),
            customer_id: "cust-test".to_string(),
            items: vec![test_item()],
            status: OrderStatus::Pending,
            created_at: chrono::Utc::now(),
        }
    }

    pub fn test_item() -> OrderItem {
        OrderItem {
            sku: "SKU-001".to_string(),
            quantity: 1,
            price: 1000,
        }
    }

    pub fn test_command() -> PlaceOrderCommand {
        PlaceOrderCommand {
            customer_id: "cust-test".to_string(),
            items: vec![test_item()],
        }
    }
}
```

---

## Integration Tests with `testcontainers`

```toml
# Cargo.toml
[dev-dependencies]
testcontainers = "0.22"
testcontainers-modules = { version = "0.11", features = ["localstack"] }
```

```rust
// tests/integration/order_repo_test.rs
use testcontainers::runners::AsyncRunner;
use testcontainers_modules::localstack::LocalStack;

#[tokio::test]
async fn save_and_find_order() {
    // Start LocalStack
    let container = LocalStack::default().start().await.unwrap();
    let host = container.get_host().await.unwrap();
    let port = container.get_host_port_ipv4(4566).await.unwrap();

    let endpoint = format!("http://{}:{}", host, port);
    let config = aws_config::from_env()
        .endpoint_url(&endpoint)
        .region(aws_config::Region::new("us-east-1"))
        .load()
        .await;

    let client = aws_sdk_dynamodb::Client::new(&config);

    // Create table
    create_test_table(&client).await;

    // Test
    let repo = DynamoDbOrderRepo::new(client, "orders-test".to_string());
    let order = factories::test_order();

    repo.save(&order).await.unwrap();

    let found = repo.find_by_id(&order.id.to_string()).await.unwrap();
    assert_eq!(found.id, order.id);
}

async fn create_test_table(client: &aws_sdk_dynamodb::Client) {
    client.create_table()
        .table_name("orders-test")
        .attribute_definitions(
            aws_sdk_dynamodb::types::AttributeDefinition::builder()
                .attribute_name("id")
                .attribute_type(aws_sdk_dynamodb::types::ScalarAttributeType::S)
                .build()
                .unwrap()
        )
        .key_schema(
            aws_sdk_dynamodb::types::KeySchemaElement::builder()
                .attribute_name("id")
                .key_type(aws_sdk_dynamodb::types::KeyType::Hash)
                .build()
                .unwrap()
        )
        .billing_mode(aws_sdk_dynamodb::types::BillingMode::PayPerRequest)
        .send()
        .await
        .unwrap();
}
```

---

## Tokio Test Utilities

```rust
use tokio::time::{advance, pause};

#[tokio::test]
async fn timeout_triggers_after_deadline() {
    pause(); // pause the Tokio clock

    let result = tokio::time::timeout(
        Duration::from_secs(5),
        async {
            advance(Duration::from_secs(6)).await; // advance time
            Ok::<(), ()>(())
        }
    ).await;

    assert!(result.is_err()); // should have timed out
}
```

---

## Running Tests

```bash
# All tests
cargo test

# Unit tests only (no integration tests directory)
cargo test --lib

# Integration tests only
cargo test --test '*'

# Specific test
cargo test place_order_saves_and_publishes

# With output
cargo test -- --nocapture

# Coverage (via cargo-tarpaulin or cargo-llvm-cov)
cargo llvm-cov --html
cargo llvm-cov --lcov --output-path lcov.info
```

---

## Cross-References

→ [Testing Strategies](../../testing/general/strategies.md) | [Testing Guide (Rust)](../../testing/rust/guide.md) | [Code Patterns (Rust)](./code.md)
