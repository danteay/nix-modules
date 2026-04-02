# Code Patterns (Rust)

> Constructor injection, builder pattern, functional options via builder, config, and domain modeling in Rust.

---

## Dependency Injection

Use constructor injection with trait objects:

```rust
use std::sync::Arc;

pub struct PlaceOrderUseCase {
    repo: Arc<dyn OrderRepository>,
    publisher: Arc<dyn EventPublisher>,
}

impl PlaceOrderUseCase {
    pub fn new(
        repo: Arc<dyn OrderRepository>,
        publisher: Arc<dyn EventPublisher>,
    ) -> Self {
        Self { repo, publisher }
    }

    pub async fn execute(&self, cmd: PlaceOrderCommand) -> Result<Order, OrderError> {
        let order = Order::new(cmd)?;
        self.repo.save(&order).await?;
        self.publisher.publish(&DomainEvent::OrderPlaced(order.clone())).await?;
        Ok(order)
    }
}
```

Wire at the entry point only:

```rust
// main.rs
let repo: Arc<dyn OrderRepository> = Arc::new(DynamoDbOrderRepo::new(&config).await?);
let publisher: Arc<dyn EventPublisher> = Arc::new(SnsPublisher::new(&config));
let use_case = PlaceOrderUseCase::new(repo, publisher);
```

---

## Builder Pattern

For structs with many optional fields:

```rust
#[derive(Debug, Default)]
pub struct OrderBuilder {
    customer_id: Option<String>,
    items: Vec<OrderItem>,
    discount_code: Option<String>,
}

impl OrderBuilder {
    pub fn customer_id(mut self, id: impl Into<String>) -> Self {
        self.customer_id = Some(id.into());
        self
    }

    pub fn item(mut self, item: OrderItem) -> Self {
        self.items.push(item);
        self
    }

    pub fn discount_code(mut self, code: impl Into<String>) -> Self {
        self.discount_code = Some(code.into());
        self
    }

    pub fn build(self) -> Result<Order, OrderError> {
        let customer_id = self.customer_id
            .ok_or(OrderError::MissingField("customer_id"))?;

        if self.items.is_empty() {
            return Err(OrderError::MissingField("items"));
        }

        Ok(Order { customer_id, items: self.items, discount_code: self.discount_code })
    }
}

impl Order {
    pub fn builder() -> OrderBuilder {
        OrderBuilder::default()
    }
}
```

---

## Domain Modeling

### Value Objects (newtype pattern)

```rust
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct OrderId(String);

impl OrderId {
    pub fn new() -> Self {
        Self(uuid::Uuid::new_v4().to_string())
    }

    pub fn from_str(s: &str) -> Result<Self, OrderError> {
        if s.is_empty() {
            return Err(OrderError::InvalidId);
        }
        Ok(Self(s.to_string()))
    }
}

impl std::fmt::Display for OrderId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
```

### Aggregate

```rust
#[derive(Debug, Clone)]
pub struct Order {
    pub id: OrderId,
    pub customer_id: String,
    pub items: Vec<OrderItem>,
    pub status: OrderStatus,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum OrderStatus {
    Pending,
    Placed,
    Shipped,
    Cancelled,
}

impl Order {
    pub fn place(&mut self) -> Result<DomainEvent, OrderError> {
        if self.status != OrderStatus::Pending {
            return Err(OrderError::InvalidTransition {
                from: format!("{:?}", self.status),
                to: "Placed".to_string(),
            });
        }
        self.status = OrderStatus::Placed;
        Ok(DomainEvent::OrderPlaced { order_id: self.id.clone() })
    }
}
```

---

## Service Configuration

```rust
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Config {
    pub aws_region: String,
    pub table_name: String,
    pub sns_topic_arn: String,
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
}

fn default_max_retries() -> u32 { 3 }

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        envy::from_env::<Self>()
            .map_err(|e| anyhow::anyhow!("invalid config: {}", e))
    }
}
```

---

## Error Mapping at Layer Boundaries

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum OrderError {
    #[error("order {0} not found")]
    NotFound(String),
    #[error("repository error: {0}")]
    Repository(#[from] RepositoryError),
}

#[derive(Debug, Error)]
pub enum RepositoryError {
    #[error("dynamodb error: {0}")]
    DynamoDb(String),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

// Map at adapter boundary — don't leak RepositoryError to HTTP handlers
impl From<OrderError> for HttpError {
    fn from(e: OrderError) -> Self {
        match e {
            OrderError::NotFound(id) => HttpError::not_found(format!("order {id} not found")),
            OrderError::Repository(_) => HttpError::internal("database error"),
        }
    }
}
```

---

## Idiomatic Rust

```rust
// Use ? for early return, not match/if let for single error path
pub async fn get_order(id: &str) -> Result<Order, OrderError> {
    let order = repo.find_by_id(id).await?;
    Ok(order)
}

// Use iterators over manual loops
let total: u64 = order.items.iter()
    .map(|item| item.price * item.quantity as u64)
    .sum();

// Use Option combinators
let discount = order.discount_code
    .as_ref()
    .and_then(|code| discounts.get(code))
    .map(|d| d.percentage)
    .unwrap_or(0);

// Destructuring in function params
fn apply_discount(&mut self, Discount { code, percentage }: Discount) {
    // ...
}
```

---

## Cross-References

→ [Conventions (Rust)](../../conventions/rust/index.md) | [Concurrency (Rust)](./concurrency.md) | [Testing (Rust)](../../testing/rust/guide.md)
