# Rust Conventions

> Naming, ownership, error handling, async, and toolchain rules for Rust services.

---

## Naming

| Item | Convention | Example |
|------|------------|---------|
| Types / Traits | `UpperCamelCase` | `OrderRepository`, `PaymentService` |
| Functions / methods | `snake_case` | `place_order`, `get_by_id` |
| Variables | `snake_case` | `order_id`, `retry_count` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_RETRIES`, `DEFAULT_TIMEOUT` |
| Modules | `snake_case` | `order_service`, `payment_handler` |
| Lifetimes | short lowercase | `'a`, `'ctx` |
| Enum variants | `UpperCamelCase` | `OrderStatus::Placed`, `Error::NotFound` |

---

## Error Handling

### Domain Errors with `thiserror`

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum OrderError {
    #[error("order {0} not found")]
    NotFound(String),

    #[error("order already exists: {0}")]
    AlreadyExists(String),

    #[error("invalid state transition: {from} → {to}")]
    InvalidTransition { from: String, to: String },

    #[error("repository error: {0}")]
    Repository(#[from] RepositoryError),
}
```

### Application-Level Errors with `anyhow`

Use `anyhow::Result` in binaries and integration points where context matters more than type:

```rust
use anyhow::{Context, Result};

pub async fn run() -> Result<()> {
    let config = Config::from_env()
        .context("failed to load configuration")?;

    let db = DynamoDb::new(&config.aws)
        .await
        .context("failed to connect to DynamoDB")?;

    Ok(())
}
```

### Rules

- Use `thiserror` for library/domain errors (typed, matchable)
- Use `anyhow` in binary entry points and handlers (rich context)
- Never `unwrap()` or `expect()` in production code — only in tests or truly unreachable branches
- Prefer `?` operator over explicit `match` for error propagation
- Add `.context("...")` when the caller needs more information than the error provides

---

## Ownership and Borrowing

- Prefer passing **references** (`&T`) unless ownership is required
- Use `Arc<T>` for shared ownership across threads (not `Rc<T>` in async code)
- Use `Mutex<T>` / `RwLock<T>` from `tokio::sync` (not `std::sync`) in async contexts
- Clone sparingly — prefer `Arc` for expensive shared state
- Avoid interior mutability (`RefCell`, `Cell`) in public APIs

```rust
// Good — pass reference, no clone
fn process(order: &Order) -> Result<()> { ... }

// Good — shared ownership via Arc
#[derive(Clone)]
pub struct OrderService<R: OrderRepository> {
    repo: Arc<R>,
}
```

---

## Traits (Ports)

Define traits for all external dependencies (repository, publisher, clock):

```rust
#[async_trait::async_trait]
pub trait OrderRepository: Send + Sync {
    async fn find_by_id(&self, id: &str) -> Result<Order, OrderError>;
    async fn save(&self, order: &Order) -> Result<(), OrderError>;
}

#[async_trait::async_trait]
pub trait EventPublisher: Send + Sync {
    async fn publish(&self, event: &DomainEvent) -> Result<(), PublishError>;
}
```

Rules:

- Add `Send + Sync` bounds on trait objects used across async tasks
- Use `#[async_trait]` for async trait methods until native async traits stabilize
- Accept `Arc<GenericTrait>` as dependencies. Always use generics, never dynamic types for dependency injection

---

## Async (Tokio)

```rust
// Tokio entry point
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // ...
}

// Spawn independent tasks
tokio::spawn(async move {
    if let Err(e) = process_event(event).await {
        tracing::error!(error = %e, "event processing failed");
    }
});

// Concurrent futures with join!
let (order, payment) = tokio::join!(
    repo.find_order(id),
    payment_service.get_status(payment_id),
);

// Timeout
tokio::time::timeout(Duration::from_secs(5), operation())
    .await
    .context("operation timed out")?;
```

Rules:

- Never block the async runtime — use `tokio::task::spawn_blocking` for CPU-bound or blocking I/O
- Use `tokio::sync::Semaphore` for concurrency limits
- Always propagate cancellation via `tokio::select!` where applicable

---

## Configuration

Use `serde` + `envy` for environment-based config:

```rust
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Config {
    pub aws_region: String,
    pub table_name: String,
    pub log_level: String,
    #[serde(default = "default_port")]
    pub port: u16,
}

fn default_port() -> u16 { 8080 }

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        envy::from_env::<Self>().map_err(Into::into)
    }
}
```

---

## Structured Logging (tracing)

```rust
use tracing::{info, error, instrument};

#[instrument(skip(repo), fields(order_id = %id))]
pub async fn place_order(id: &str, repo: &dyn OrderRepository) -> Result<Order, OrderError> {
    info!("placing order");

    let order = repo.find_by_id(id).await.map_err(|e| {
        error!(error = %e, "failed to find order");
        e
    })?;

    Ok(order)
}
```

Setup in `main.rs`:

```rust
tracing_subscriber::fmt()
    .json()
    .with_env_filter(EnvFilter::from_default_env())
    .init();
```

---

## Toolchain and Linting

```toml
# rust-toolchain.toml
[toolchain]
channel = "stable"
components = ["rustfmt", "clippy"]
```

```toml
# .clippy.toml or Cargo.toml [lints]
[lints.clippy]
all = "warn"
pedantic = "warn"
unwrap_used = "deny"
expect_used = "deny"
panic = "deny"
```

Formatting: `cargo fmt --all`
Linting: `cargo clippy --all-targets -- -D warnings`
Tests: `cargo test --all`
Check: `cargo check --all-targets`

---

## Cross-References

→ [Patterns (Rust)](../../patterns/rust/code.md) | [Testing (Rust)](../../testing/rust/guide.md) | [General Conventions](../general/common-pitfalls.md)
