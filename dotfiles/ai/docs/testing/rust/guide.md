# Testing Guide (Rust)

> Setup, structure, mocking, integration tests with testcontainers, and coverage for Rust projects.

---

## Setup

```toml
# Cargo.toml
[dev-dependencies]
tokio = { version = "1", features = ["full", "test-util"] }
mockall = "0.13"
testcontainers = "0.22"
testcontainers-modules = { version = "0.11", features = ["localstack"] }
assert_matches = "1"
pretty_assertions = "1"
```

---

## Test Commands

```bash
# Run all tests
cargo test

# Run with output (tracing logs visible)
cargo test -- --nocapture

# Run specific test
cargo test order::tests::place_order_saves_and_publishes

# Run integration tests only
cargo test --test '*'

# Run unit tests only (lib targets)
cargo test --lib

# Watch mode
cargo watch -x test

# Coverage (requires cargo-llvm-cov)
cargo llvm-cov
cargo llvm-cov --html           # HTML report
cargo llvm-cov --lcov           # for CI
```

---

## File Organization

```
src/
├── domain/
│   ├── order.rs
│   └── order/
│       └── tests.rs   # or inline #[cfg(test)] mod tests {}
├── use_cases/
│   └── place_order.rs # inline tests for unit tests
└── lib.rs

tests/
├── common/
│   ├── mod.rs         # shared helpers
│   └── factories.rs   # test data builders
├── order_repo_test.rs # integration test
└── handler_test.rs    # HTTP handler integration test
```

---

## Unit Test Pattern

```rust
// src/use_cases/place_order.rs
#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::factories::*;
    use mockall::predicate::*;
    use std::sync::Arc;

    #[tokio::test]
    async fn execute_saves_order_and_publishes_event() {
        // Arrange
        let mut repo = MockOrderRepository::new();
        repo.expect_save()
            .with(always())
            .once()
            .returning(|_| Ok(()));

        let mut publisher = MockEventPublisher::new();
        publisher.expect_publish()
            .once()
            .returning(|_| Ok(()));

        let sut = PlaceOrderUseCase::new(Arc::new(repo), Arc::new(publisher));

        // Act
        let result = sut.execute(test_command()).await;

        // Assert
        assert!(result.is_ok(), "expected Ok, got {result:?}");
    }

    #[tokio::test]
    async fn execute_does_not_publish_when_save_fails() {
        let mut repo = MockOrderRepository::new();
        repo.expect_save()
            .returning(|_| Err(OrderError::Repository("db error".into())));

        let publisher = MockEventPublisher::new();
        // no expect_publish() — asserts it is never called

        let sut = PlaceOrderUseCase::new(Arc::new(repo), Arc::new(publisher));

        let result = sut.execute(test_command()).await;
        assert!(matches!(result, Err(OrderError::Repository(_))));
    }
}
```

---

## Test Factories

```rust
// tests/common/factories.rs (or src/domain/factories.rs under #[cfg(test)])

pub fn test_order() -> Order {
    Order {
        id: OrderId::from_str("order-test-1").unwrap(),
        customer_id: "cust-test".to_string(),
        items: vec![test_item()],
        status: OrderStatus::Pending,
        created_at: chrono::Utc::now(),
    }
}

pub fn test_item() -> OrderItem {
    OrderItem { sku: "SKU-001".to_string(), quantity: 2, price: 500 }
}

pub fn test_command() -> PlaceOrderCommand {
    PlaceOrderCommand {
        customer_id: "cust-test".to_string(),
        items: vec![test_item()],
    }
}
```

---

## Integration Test Setup (LocalStack)

```rust
// tests/common/mod.rs
use testcontainers::runners::AsyncRunner;
use testcontainers_modules::localstack::LocalStack;

pub struct TestContext {
    pub dynamo: aws_sdk_dynamodb::Client,
    pub table_name: String,
    _container: testcontainers::ContainerAsync<LocalStack>,
}

impl TestContext {
    pub async fn new() -> Self {
        let container = LocalStack::default().start().await.unwrap();
        let host = container.get_host().await.unwrap();
        let port = container.get_host_port_ipv4(4566).await.unwrap();

        let config = aws_config::from_env()
            .endpoint_url(format!("http://{}:{}", host, port))
            .region(aws_types::region::Region::new("us-east-1"))
            .credentials_provider(aws_credential_types::Credentials::new(
                "test", "test", None, None, "test",
            ))
            .load()
            .await;

        let dynamo = aws_sdk_dynamodb::Client::new(&config);
        let table_name = "orders-test".to_string();

        create_table(&dynamo, &table_name).await;

        Self { dynamo, table_name, _container: container }
    }

    pub async fn cleanup(&self) {
        // table is in container — container drop cleans everything
    }
}

async fn create_table(client: &aws_sdk_dynamodb::Client, table: &str) {
    use aws_sdk_dynamodb::types::*;

    client.create_table()
        .table_name(table)
        .attribute_definitions(
            AttributeDefinition::builder()
                .attribute_name("id").attribute_type(ScalarAttributeType::S)
                .build().unwrap()
        )
        .key_schema(
            KeySchemaElement::builder()
                .attribute_name("id").key_type(KeyType::Hash)
                .build().unwrap()
        )
        .billing_mode(BillingMode::PayPerRequest)
        .send().await.unwrap();
}
```

---

## Integration Test

```rust
// tests/order_repo_test.rs
mod common;
use common::{TestContext, factories::*};

#[tokio::test]
async fn save_then_find_returns_same_order() {
    let ctx = TestContext::new().await;
    let repo = DynamoDbOrderRepo::new(ctx.dynamo.clone(), ctx.table_name.clone());

    let order = test_order();
    repo.save(&order).await.expect("save failed");

    let found = repo.find_by_id(&order.id.to_string()).await.expect("find failed");
    assert_eq!(found.id, order.id);
    assert_eq!(found.customer_id, order.customer_id);
}

#[tokio::test]
async fn find_returns_not_found_for_missing_id() {
    let ctx = TestContext::new().await;
    let repo = DynamoDbOrderRepo::new(ctx.dynamo.clone(), ctx.table_name.clone());

    let result = repo.find_by_id("nonexistent").await;
    assert!(matches!(result, Err(OrderError::NotFound(_))));
}
```

---

## HTTP Handler Test

```rust
// tests/handler_test.rs
use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt; // for .oneshot()

#[tokio::test]
async fn post_order_returns_201() {
    let app = create_test_app().await; // wire with real LocalStack deps

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/orders")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"customer_id":"cust-1","items":[{"sku":"SKU-1","qty":1}]}"#))
                .unwrap()
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
}
```

---

## Coverage

```bash
# Install
cargo install cargo-llvm-cov

# Run coverage
cargo llvm-cov --html           # generates target/llvm-cov/html/index.html
cargo llvm-cov --lcov --output-path lcov.info  # for CI

# CI threshold check
cargo llvm-cov --fail-under-lines 80
```

CI config:

```yaml
- name: Test with coverage
  run: cargo llvm-cov --lcov --output-path lcov.info --fail-under-lines 80

- name: Upload coverage
  uses: codecov/codecov-action@v4
  with:
    files: lcov.info
```

---

## Cross-References

→ [Testing Strategies](../../testing/general/strategies.md) | [Testing Patterns (Rust)](../../patterns/rust/testing.md) | [Conventions (Rust)](../../conventions/rust/index.md)
