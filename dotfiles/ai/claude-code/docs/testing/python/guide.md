# Python Testing Guide

> Comprehensive guide: pytest setup, unit tests, integration tests, async testing, and coverage.

---

## Setup

```nix
packages = with pkgs; [ python313 poetry uv pytest go-task ];
```

```toml
# pyproject.toml
[tool.poetry.dev-dependencies]
pytest            = "^8.0"
pytest-asyncio    = "^0.24"
pytest-cov        = "^5.0"
pytest-mock       = "^3.14"
testcontainers    = "^4.0"
anyio             = {extras = ["trio"], version = "^4.0"}

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths    = ["tests"]
addopts      = [
    "--strict-markers",
    "-ra",
    "--cov=src",
    "--cov-report=html:coverage",
    "--cov-fail-under=80",
]
markers = [
    "unit: fast, no I/O",
    "integration: requires real infrastructure",
    "e2e: full system tests",
    "smoke: post-deploy health checks",
]
```

```bash
# Run all tests
pytest

# Run only unit tests
pytest -m unit

# Run with verbose output
pytest -v

# Run specific test
pytest tests/unit/test_order_service.py::test_place_success -v

# Run coverage only
pytest --cov=src --cov-report=term-missing
```

---

## Unit Tests

### File Organization

```
tests/
├── conftest.py              # Shared fixtures (session/module/function scope)
├── factories.py             # Test data builders
├── unit/
│   └── test_order_service.py
├── integration/
│   ├── conftest.py          # Integration-specific fixtures (containers)
│   └── test_order_repository.py
└── e2e/
    └── test_place_order_flow.py
```

### conftest.py (Shared Fixtures)

```python
# tests/conftest.py
import pytest
from unittest.mock import AsyncMock, MagicMock

@pytest.fixture
def mock_order_repo() -> MagicMock:
    repo = MagicMock(spec=OrderRepository)
    repo.save           = AsyncMock(return_value=None)
    repo.find_by_id     = AsyncMock(return_value=None)
    repo.find_by_customer = AsyncMock(return_value=([], None))
    return repo

@pytest.fixture
def mock_publisher() -> MagicMock:
    pub = MagicMock(spec=EventPublisher)
    pub.publish = AsyncMock(return_value=None)
    return pub

@pytest.fixture
def order_service(mock_order_repo, mock_publisher) -> OrderService:
    return OrderService(mock_order_repo, mock_publisher)
```

### Unit Test File

```python
# tests/unit/test_order_service.py
import pytest
from tests.factories import make_place_order_cmd, make_order_item

class TestOrderServicePlace:
    async def test_creates_order_with_placed_status(
        self, order_service, mock_order_repo
    ) -> None:
        cmd = make_place_order_cmd()
        order = await order_service.place(cmd)

        assert order.status == OrderStatus.PLACED
        assert order.customer_id == cmd.customer_id
        mock_order_repo.save.assert_called_once()

    async def test_publishes_order_placed_event(
        self, order_service, mock_publisher
    ) -> None:
        cmd = make_place_order_cmd()
        order = await order_service.place(cmd)

        mock_publisher.publish.assert_called_once()
        event = mock_publisher.publish.call_args[0][0]
        assert isinstance(event, OrderPlaced)
        assert event.order_id == order.id

    async def test_raises_when_customer_id_empty(self, order_service) -> None:
        cmd = make_place_order_cmd(customer_id="")
        with pytest.raises(ValidationError, match="customer_id"):
            await order_service.place(cmd)

    @pytest.mark.parametrize("items", [[], None])
    async def test_raises_when_no_items(self, order_service, items) -> None:
        cmd = make_place_order_cmd(items=items)
        with pytest.raises(ValidationError, match="items"):
            await order_service.place(cmd)

    async def test_propagates_repository_error(
        self, order_service, mock_order_repo
    ) -> None:
        mock_order_repo.save.side_effect = ConnectionError("DB unavailable")
        cmd = make_place_order_cmd()

        with pytest.raises(ConnectionError, match="DB unavailable"):
            await order_service.place(cmd)
```

---

## Factories

```python
# tests/factories.py
import uuid
from datetime import datetime, UTC
from src.domain.models import Order, OrderItem, OrderStatus, PlaceOrderCmd

def make_order_item(
    sku: str = "sku-test-001",
    quantity: int = 1,
    unit_price_cents: int = 1000,
) -> OrderItem:
    return OrderItem(sku=sku, quantity=quantity, unit_price_cents=unit_price_cents)

def make_order(
    customer_id: str = "cust-test",
    status: OrderStatus = OrderStatus.PLACED,
    item_count: int = 1,
    **kwargs,
) -> Order:
    return Order(
        id=str(uuid.uuid4()),
        customer_id=customer_id,
        items=[make_order_item() for _ in range(item_count)],
        status=status,
        created_at=datetime.now(UTC),
        **kwargs,
    )

def make_place_order_cmd(**kwargs) -> PlaceOrderCmd:
    defaults = dict(customer_id="cust-test", items=[make_order_item()])
    return PlaceOrderCmd(**{**defaults, **kwargs})
```

---

## Integration Tests

### conftest.py (Container Setup)

```python
# tests/integration/conftest.py
import pytest
import pytest_asyncio
import aioboto3
from testcontainers.localstack import LocalStackContainer
from uuid import uuid4

@pytest.fixture(scope="session")
def localstack():
    with LocalStackContainer(services=["dynamodb", "sns", "sqs"]) as ls:
        yield ls

@pytest.fixture(scope="session")
def localstack_url(localstack) -> str:
    return localstack.get_url()

@pytest_asyncio.fixture
async def dynamo_session(localstack_url: str):
    session = aioboto3.Session()
    async with session.resource(
        "dynamodb",
        endpoint_url=localstack_url,
        region_name="us-east-2",
        aws_access_key_id="test",
        aws_secret_access_key="test",
    ) as dynamo:
        yield dynamo

@pytest_asyncio.fixture
async def orders_table(dynamo_session):
    """Fresh table per test."""
    name = f"orders-test-{uuid4().hex[:8]}"
    table = await dynamo_session.create_table(
        TableName=name,
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[
            {"AttributeName": "pk", "AttributeType": "S"},
        ],
        KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}],
    )
    yield table
    await table.delete()

@pytest_asyncio.fixture
async def order_repo(orders_table) -> DynamoOrderRepository:
    return DynamoOrderRepository(orders_table)
```

### Integration Test File

```python
# tests/integration/test_order_repository.py
import pytest
from tests.factories import make_order

@pytest.mark.integration
class TestDynamoOrderRepository:
    async def test_save_and_find_by_id(self, order_repo) -> None:
        order = make_order()
        await order_repo.save(order)

        found = await order_repo.find_by_id(order.id)
        assert found is not None
        assert found.customer_id == order.customer_id
        assert found.status == order.status

    async def test_find_by_id_returns_none_when_missing(self, order_repo) -> None:
        result = await order_repo.find_by_id("does-not-exist")
        assert result is None

    async def test_find_pending_returns_only_placed_orders(self, order_repo) -> None:
        placed  = make_order(status=OrderStatus.PLACED)
        shipped = make_order(status=OrderStatus.SHIPPED)
        await order_repo.save(placed)
        await order_repo.save(shipped)

        results = await order_repo.find_pending()
        assert len(results) == 1
        assert results[0].id == placed.id
```

---

## Async Testing Notes

```python
# pytest-asyncio in "auto" mode handles async tests without decorators
# Just write async def test_...() and it works

# For tests requiring specific event loop policy:
@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"

# Mocking async context managers
from unittest.mock import AsyncMock, MagicMock

mock_repo = MagicMock()
mock_tx = AsyncMock()
mock_repo.transaction.return_value.__aenter__ = AsyncMock(return_value=mock_tx)
mock_repo.transaction.return_value.__aexit__  = AsyncMock(return_value=False)
```

---

## Coverage

```bash
# Run with coverage
pytest --cov=src --cov-report=html --cov-report=term-missing

# View HTML report
open coverage/index.html

# Coverage by module
pytest --cov=src --cov-report=term-missing | grep -v "100%"

# Fail if below threshold (enforced in pyproject.toml)
# --cov-fail-under=80
```

---

## Cross-References

→ [Python Testing Patterns](../../patterns/python/testing.md) | [General Strategies](../general/strategies.md) | [Python Conventions](../../conventions/python/index.md)
