# Concurrency Patterns (Rust)

> Tokio tasks, channels, semaphores, worker pools, and SQS consumers in Rust.

---

## Tokio Tasks

```rust
use tokio::task::JoinHandle;

// Spawn a background task
let handle: JoinHandle<Result<(), MyError>> = tokio::spawn(async move {
    process_event(event).await
});

// Await and handle error
match handle.await {
    Ok(Ok(())) => {},
    Ok(Err(e)) => tracing::error!(error = %e, "task failed"),
    Err(e) => tracing::error!(error = %e, "task panicked"),  // JoinError
}

// Concurrent tasks — join_all
use futures::future::join_all;

let handles: Vec<JoinHandle<_>> = events
    .into_iter()
    .map(|event| tokio::spawn(process_event(event)))
    .collect();

let results = join_all(handles).await;
```

---

## tokio::join! for Known-Count Concurrent Work

```rust
// Concurrent, heterogeneous futures
let (order_result, payment_result) = tokio::join!(
    order_repo.find_by_id(&order_id),
    payment_service.get_status(&payment_id),
);

let order = order_result?;
let payment = payment_result?;
```

---

## JoinSet for Dynamic Task Collections

```rust
use tokio::task::JoinSet;

let mut set = JoinSet::new();

for item in items {
    set.spawn(async move { process_item(item).await });
}

while let Some(result) = set.join_next().await {
    match result {
        Ok(Ok(())) => {},
        Ok(Err(e)) => tracing::error!(error = %e, "item failed"),
        Err(e) => tracing::error!(error = %e, "task panicked"),
    }
}
```

---

## Semaphore (Concurrency Limiting)

```rust
use std::sync::Arc;
use tokio::sync::Semaphore;

let semaphore = Arc::new(Semaphore::new(10)); // max 10 concurrent

let mut handles = vec![];
for item in items {
    let sem = semaphore.clone();
    handles.push(tokio::spawn(async move {
        let _permit = sem.acquire().await.expect("semaphore closed");
        process_item(item).await
        // _permit dropped here — slot freed
    }));
}

futures::future::join_all(handles).await;
```

---

## Worker Pool

```rust
use tokio::sync::mpsc;

pub async fn worker_pool<T, F, Fut>(
    items: Vec<T>,
    workers: usize,
    handler: F,
) where
    T: Send + 'static,
    F: Fn(T) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = ()> + Send,
{
    let handler = Arc::new(handler);
    let (tx, rx) = mpsc::channel::<T>(workers * 2);
    let rx = Arc::new(tokio::sync::Mutex::new(rx));

    let mut worker_handles = vec![];
    for _ in 0..workers {
        let rx = rx.clone();
        let handler = handler.clone();
        worker_handles.push(tokio::spawn(async move {
            loop {
                let item = {
                    let mut rx = rx.lock().await;
                    rx.recv().await
                };
                match item {
                    Some(item) => handler(item).await,
                    None => break,
                }
            }
        }));
    }

    for item in items {
        tx.send(item).await.expect("receiver dropped");
    }
    drop(tx); // signal workers to stop

    futures::future::join_all(worker_handles).await;
}
```

---

## Channels

```rust
use tokio::sync::{mpsc, oneshot, broadcast};

// Multi-producer, single-consumer (task queue)
let (tx, mut rx) = mpsc::channel::<Order>(100);

// Oneshot — single response to a request
let (resp_tx, resp_rx) = oneshot::channel::<Result<Order, OrderError>>();

// Broadcast — fan-out to multiple receivers
let (broadcast_tx, _) = broadcast::channel::<DomainEvent>(16);
let mut sub = broadcast_tx.subscribe();

// Receive
tokio::spawn(async move {
    while let Some(order) = rx.recv().await {
        process_order(order).await;
    }
});
```

---

## SQS Consumer (Lambda / Long-Polling)

```rust
use aws_lambda_events::event::sqs::{SqsEvent, SqsBatchResponse, SqsBatchItemFailure};
use lambda_runtime::{run, service_fn, LambdaEvent, Error};

async fn handler(event: LambdaEvent<SqsEvent>) -> Result<SqsBatchResponse, Error> {
    let semaphore = Arc::new(Semaphore::new(5));
    let mut handles = vec![];

    for record in event.payload.records {
        let sem = semaphore.clone();
        let id = record.message_id.clone().unwrap_or_default();

        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await.unwrap();
            match process_record(&record).await {
                Ok(()) => None,
                Err(e) => {
                    tracing::error!(message_id = %id, error = %e, "record failed");
                    Some(SqsBatchItemFailure { item_identifier: id })
                }
            }
        }));
    }

    let failures: Vec<SqsBatchItemFailure> = futures::future::join_all(handles)
        .await
        .into_iter()
        .filter_map(|r| r.ok().flatten())
        .collect();

    Ok(SqsBatchResponse { batch_item_failures: failures })
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(service_fn(handler)).await
}
```

---

## Shared State Across Tasks

```rust
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct AppState {
    pub cache: Arc<RwLock<HashMap<String, Order>>>,
    pub config: Arc<Config>,
}

// Read — non-exclusive
let order = state.cache.read().await.get(&id).cloned();

// Write — exclusive
state.cache.write().await.insert(id, order);
```

Rules:
- Prefer `Arc<T>` over cloning large structs
- Use `tokio::sync::RwLock` (not `std::sync::RwLock`) in async contexts
- Keep lock held time short — do not await inside a lock guard

---

## Cross-References

→ [Concurrency Concepts](../general/concurrency.md) | [Code Patterns (Rust)](./code.md) | [Testing (Rust)](../../testing/rust/guide.md)
