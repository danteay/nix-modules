# Python Conventions

> Naming, type hints, Pydantic, project structure, and tooling for Python services.

## Version

Always use **Python 3.12+** (latest stable). Define in `flake.nix` and `pyproject.toml`:

```nix
packages = [ pkgs.python313 pkgs.poetry pkgs.uv pkgs.ruff pkgs.mypy ];
```

```toml
[tool.poetry.dependencies]
python = "^3.13"
```

---

## Naming

| Construct | Convention | Example |
|-----------|-----------|---------|
| Module / file | snake_case | `order_service.py`, `dynamo_repository.py` |
| Class | PascalCase | `OrderService`, `DynamoRepository` |
| Function / method | snake_case | `place_order`, `find_by_id` |
| Variable | snake_case | `order_id`, `customer_id` |
| Constant (module-level) | UPPER_SNAKE_CASE | `MAX_RETRIES`, `DEFAULT_TIMEOUT` |
| Exception | PascalCase + `Error` suffix | `OrderNotFoundError`, `InsufficientFundsError` |
| Private | `_` prefix | `_build_query`, `_validate_cmd` |
| Type alias | PascalCase | `OrderID`, `CustomerID` |
| Protocol | PascalCase (same as class) | `OrderRepository`, `EventPublisher` |

---

## Type Hints

**Required on all public functions and methods:**

```python
from __future__ import annotations
from typing import Optional
from datetime import datetime

# Functions
def place_order(
    customer_id: str,
    items: list[OrderItem],
    coupon: Optional[str] = None,
) -> Order: ...

# Async functions
async def find_by_id(order_id: str) -> Order | None: ...

# Type aliases
OrderID = str
CustomerID = str
Cursor = str

# Generic types (Python 3.12+)
type Result[T] = T | None
```

Use `from __future__ import annotations` at the top of every file (enables forward references and deferred evaluation).

---

## Pydantic Models

```python
from pydantic import BaseModel, Field, field_validator, model_validator
from enum import StrEnum
from datetime import datetime, UTC
import uuid

class OrderStatus(StrEnum):
    PLACED    = "placed"
    CONFIRMED = "confirmed"
    SHIPPED   = "shipped"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"

class OrderItem(BaseModel):
    model_config = {"frozen": True}   # immutable value object

    sku: str             = Field(..., min_length=1, max_length=50)
    quantity: int        = Field(..., gt=0)
    unit_price_cents: int = Field(..., ge=0)

    @property
    def total_cents(self) -> int:
        return self.quantity * self.unit_price_cents

class Order(BaseModel):
    model_config = {"frozen": True}

    id: str           = Field(default_factory=lambda: str(uuid.uuid4()))
    customer_id: str
    items: list[OrderItem] = Field(..., min_length=1)
    status: OrderStatus    = OrderStatus.PLACED
    created_at: datetime   = Field(default_factory=lambda: datetime.now(UTC))

    @field_validator("customer_id")
    @classmethod
    def customer_id_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("customer_id cannot be empty")
        return v

    @property
    def total_cents(self) -> int:
        return sum(item.total_cents for item in self.items)
```

Use `model_config = {"frozen": True}` for entities that should be immutable after creation.

---

## Protocol (Interface)

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

---

## Error Hierarchy

```python
# domain/errors.py
class DomainError(Exception):
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
```

```python
# In handler: map domain errors to HTTP status
ERROR_STATUS_MAP: dict[str, int] = {
    "order_not_found":     404,
    "already_exists":      409,
    "insufficient_funds":  422,
    "invalid_input":       422,
    "permission_denied":   403,
}

def handle_domain_error(err: DomainError) -> dict:
    return {
        "statusCode": ERROR_STATUS_MAP.get(err.code, 500),
        "body": json.dumps({"error": err.code, "message": str(err)}),
    }
```

---

## Async Patterns

```python
# Always async for I/O
async def place(self, cmd: PlaceOrderCmd) -> Order:
    order = Order(customer_id=cmd.customer_id, items=cmd.items)
    await self._repo.save(order)
    await self._publisher.publish(OrderPlaced(order_id=order.id))
    return order

# Parallel I/O with gather
customer, inventory = await asyncio.gather(
    self._customer_service.get(cmd.customer_id),
    self._inventory.check(cmd.items),
)

# Never block the event loop
import asyncio
await asyncio.sleep(1)   # CORRECT
import time; time.sleep(1)  # WRONG
```

---

## Logging with structlog

```python
import structlog

logger = structlog.get_logger(__name__)

async def place(self, cmd: PlaceOrderCmd) -> Order:
    log = logger.bind(customer_id=cmd.customer_id)

    try:
        order = await self._place(cmd)
        log.info("order_placed", order_id=order.id)
        return order
    except DomainError as err:
        log.warning("order_place_failed", error_code=err.code, error=str(err))
        raise
    except Exception as err:
        log.error("order_place_unexpected_error", exc_info=err)
        raise
```

---

## Tooling

| Tool | Purpose | Command |
|------|---------|---------|
| `ruff` | Lint + format (fast, replaces flake8/black/isort) | `ruff check .` / `ruff format .` |
| `mypy` | Static type checking | `mypy src/` |
| `pytest` | Test runner | `pytest tests/` |
| `pytest-asyncio` | Async test support | auto mode in `pyproject.toml` |
| `pytest-cov` | Coverage | `pytest --cov=src` |
| `testcontainers` | Docker containers in tests | `pip install testcontainers` |

```toml
[tool.ruff]
target-version = "py313"
line-length = 100
select = ["E", "F", "I", "N", "UP", "S", "B", "A", "C4", "PT", "RUF"]
ignore = ["S101"]  # allow assert in tests

[tool.mypy]
strict = true
python_version = "3.13"
plugins = ["pydantic.mypy"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
addopts = ["--strict-markers", "--cov=src", "--cov-fail-under=80"]
```

---

## Cross-References

→ [Python Code Patterns](../../patterns/python/code.md) | [Python Concurrency Patterns](../../patterns/python/concurrency.md) | [Python Testing Patterns](../../patterns/python/testing.md) | [Python Testing Guide](../../testing/python/guide.md) | [Common Pitfalls](../general/common-pitfalls.md)
