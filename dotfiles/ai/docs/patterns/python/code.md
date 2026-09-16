# Python Code Patterns

> Protocol interfaces, Pydantic models, dependency injection, and service configuration in Python.

---

## Protocol (Structural Interface)

Use `typing.Protocol` to define interfaces without inheritance. Enables duck typing with type safety.

```python
from typing import Protocol, runtime_checkable

@runtime_checkable
class OrderRepository(Protocol):
    async def save(self, order: Order) -> None: ...
    async def find_by_id(self, order_id: str) -> Order | None: ...
    async def find_by_customer(
        self,
        customer_id: str,
        *,
        limit: int = 20,
        cursor: str | None = None,
    ) -> tuple[list[Order], str | None]: ...
```

Benefits over `ABC`:
- No inheritance required — any class matching the signature satisfies the protocol
- Duck typing: existing classes automatically satisfy protocols
- `runtime_checkable` allows `isinstance()` checks

---

## Pydantic Models (Domain + Validation)

```python
from pydantic import BaseModel, Field, field_validator, model_validator
from datetime import datetime, UTC
from enum import StrEnum
import uuid

class OrderStatus(StrEnum):
    PLACED    = "placed"
    CONFIRMED = "confirmed"
    SHIPPED   = "shipped"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"

class OrderItem(BaseModel):
    model_config = {"frozen": True}  # immutable value object

    sku: str = Field(..., min_length=1, max_length=50)
    quantity: int = Field(..., gt=0)
    unit_price_cents: int = Field(..., ge=0)

    @property
    def total_cents(self) -> int:
        return self.quantity * self.unit_price_cents

class Order(BaseModel):
    model_config = {"frozen": True}

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    customer_id: str
    items: list[OrderItem] = Field(..., min_length=1)
    status: OrderStatus = OrderStatus.PLACED
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @field_validator("customer_id")
    @classmethod
    def customer_id_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("customer_id cannot be empty")
        return v

    @model_validator(mode="after")
    def total_must_be_positive(self) -> "Order":
        if self.total_cents <= 0:
            raise ValueError("order total must be positive")
        return self

    @property
    def total_cents(self) -> int:
        return sum(item.total_cents for item in self.items)
```

---

## Constructor Injection

```python
from dataclasses import dataclass

@dataclass
class OrderService:
    _repo: OrderRepository
    _publisher: EventPublisher
    _clock: Callable[[], datetime] = field(default=lambda: datetime.now(UTC))

    async def place(self, cmd: PlaceOrderCmd) -> Order:
        order = Order(
            customer_id=cmd.customer_id,
            items=cmd.items,
        )
        await self._repo.save(order)
        await self._publisher.publish(
            OrderPlaced(
                event_id=str(uuid.uuid4()),
                order_id=order.id,
                customer_id=order.customer_id,
                occurred_at=self._clock(),
            )
        )
        return order
```

**Composition root** (Lambda handler init):

```python
# cmd/http/create_order/handler.py

# Wiring happens once at module load (Lambda cold start)
_config   = Config.load()
_dynamo   = build_dynamo_client(_config)
_sns      = build_sns_client(_config)
_repo     = DynamoOrderRepository(_dynamo, _config.table_name)
_pub      = SNSEventPublisher(_sns, _config.topic_arn)
_service  = OrderService(_repo, _pub)
_worker   = CreateOrderWorker(_service)

def handler(event: dict, context: Any) -> dict:
    return _worker.handle(event)
```

---

## Service Configuration

```python
import os
from dataclasses import dataclass, field
from typing import ClassVar

@dataclass(frozen=True)
class Config:
    # Required
    table_name: str
    topic_arn: str
    queue_url: str

    # Optional with defaults
    region: str = "us-east-2"
    log_level: str = "info"
    service_name: str = "order-service"
    max_retries: int = 3

    REQUIRED: ClassVar[list[str]] = ["TABLE_NAME", "TOPIC_ARN", "QUEUE_URL"]

    @classmethod
    def load(cls) -> "Config":
        missing = [k for k in cls.REQUIRED if not os.environ.get(k)]
        if missing:
            raise EnvironmentError(f"Missing required env vars: {', '.join(missing)}")

        return cls(
            table_name=os.environ["TABLE_NAME"],
            topic_arn=os.environ["TOPIC_ARN"],
            queue_url=os.environ["QUEUE_URL"],
            region=os.getenv("AWS_REGION", "us-east-2"),
            log_level=os.getenv("LOG_LEVEL", "info"),
        )
```

---

## Domain Errors

```python
# domain/errors.py
class DomainError(Exception):
    """Base class for all domain exceptions."""
    def __init__(self, message: str, code: str = "domain_error") -> None:
        super().__init__(message)
        self.code = code

class OrderNotFoundError(DomainError):
    def __init__(self, order_id: str) -> None:
        super().__init__(f"order {order_id!r} not found", "order_not_found")
        self.order_id = order_id

class InsufficientFundsError(DomainError):
    def __init__(self, available: int, required: int) -> None:
        super().__init__(
            f"insufficient funds: available={available}, required={required}",
            "insufficient_funds",
        )

class InvalidStateTransitionError(DomainError):
    def __init__(self, from_status: str, to_status: str) -> None:
        super().__init__(
            f"cannot transition from {from_status!r} to {to_status!r}",
            "invalid_state_transition",
        )
```

---

## Result Type (Functional Error Handling)

For cases where both success and failure are expected domain outcomes:

```python
from dataclasses import dataclass
from typing import Generic, TypeVar

T = TypeVar("T")
E = TypeVar("E", bound=Exception)

@dataclass(frozen=True)
class Ok(Generic[T]):
    value: T
    ok: bool = True

@dataclass(frozen=True)
class Err(Generic[E]):
    error: E
    ok: bool = False

Result = Ok[T] | Err[E]

# Usage
async def place_order(cmd: PlaceOrderCmd) -> Result[Order, DomainError]:
    try:
        order = await service.place(cmd)
        return Ok(order)
    except InsufficientFundsError as e:
        return Err(e)

result = await place_order(cmd)
if result.ok:
    return 201, result.value
else:
    return 422, {"error": result.error.code}
```

---

## Context Manager for Resources

```python
from contextlib import asynccontextmanager

class OrderRepository:
    def __init__(self, dynamo: AsyncDynamoDB, table: str) -> None:
        self._dynamo = dynamo
        self._table  = table

    @asynccontextmanager
    async def transaction(self) -> AsyncGenerator[TransactionContext, None]:
        tx = await self._dynamo.begin_transaction()
        try:
            yield tx
            await tx.commit()
        except Exception:
            await tx.rollback()
            raise

# Usage
async with repo.transaction() as tx:
    await tx.save_order(order)
    await tx.save_outbox_event(event)
```

---

## Cross-References

→ [General Code Patterns](../general/code.md) | [Python Conventions](../../conventions/python/index.md) | [Python Concurrency](./concurrency.md) | [Python Testing](./testing.md)
