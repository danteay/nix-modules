# Python Testing Patterns

> pytest, fixtures, parametrize, AsyncMock, factories, and integration patterns.

---

## Test Naming Convention

```
test_{module}_{method}_{scenario}
```

```python
def test_order_service_place_success(): ...
def test_order_service_place_missing_customer_id(): ...
def test_order_service_place_repository_error(): ...
def test_dynamo_repository_find_by_id_not_found(): ...
```

---

## Unit Test with pytest-mock

```python
import pytest
from unittest.mock import AsyncMock
from pytest_mock import MockerFixture

@pytest.mark.asyncio
async def test_order_service_place_success(mocker: MockerFixture) -> None:
    # Arrange
    mock_repo = mocker.create_autospec(OrderRepository, instance=True)
    mock_pub  = mocker.create_autospec(EventPublisher, instance=True)
    mock_repo.save = AsyncMock(return_value=None)
    mock_pub.publish = AsyncMock(return_value=None)

    svc = OrderService(mock_repo, mock_pub)

    # Act
    order = await svc.place(PlaceOrderCmd(
        customer_id="cust-123",
        items=[OrderItem(sku="sku-1", quantity=2, unit_price_cents=500)],
    ))

    # Assert
    assert order.customer_id == "cust-123"
    assert order.status == OrderStatus.PLACED
    mock_repo.save.assert_called_once_with(order)
    mock_pub.publish.assert_called_once()
    published_event = mock_pub.publish.call_args[0][0]
    assert isinstance(published_event, OrderPlaced)
    assert published_event.order_id == order.id
```

---

## Fixtures and conftest.py

```python
# tests/conftest.py
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock

@pytest.fixture
def mock_order_repo() -> MagicMock:
    repo = MagicMock(spec=OrderRepository)
    repo.save = AsyncMock(return_value=None)
    repo.find_by_id = AsyncMock(return_value=None)
    return repo

@pytest.fixture
def mock_event_publisher() -> MagicMock:
    pub = MagicMock(spec=EventPublisher)
    pub.publish = AsyncMock(return_value=None)
    return pub

@pytest.fixture
def order_service(mock_order_repo, mock_event_publisher) -> OrderService:
    return OrderService(mock_order_repo, mock_event_publisher)

# Test-scoped event loop for asyncio
@pytest.fixture(scope="session")
def event_loop_policy():
    return asyncio.DefaultEventLoopPolicy()
```

```python
# tests/unit/test_order_service.py
@pytest.mark.asyncio
async def test_place_success(order_service, mock_order_repo, mock_event_publisher) -> None:
    order = await order_service.place(valid_place_cmd())

    assert order.status == OrderStatus.PLACED
    mock_order_repo.save.assert_called_once()
    mock_event_publisher.publish.assert_called_once()
```

---

## Parametrize (Table-Driven Tests)

```python
@pytest.mark.parametrize("cmd,expected_error", [
    (
        PlaceOrderCmd(customer_id="", items=[valid_item()]),
        "customer_id cannot be empty",
    ),
    (
        PlaceOrderCmd(customer_id="cust-1", items=[]),
        "items must not be empty",
    ),
    (
        PlaceOrderCmd(customer_id="cust-1", items=[item_with_zero_qty()]),
        "quantity must be positive",
    ),
])
@pytest.mark.asyncio
async def test_place_order_validation_errors(
    order_service: OrderService,
    cmd: PlaceOrderCmd,
    expected_error: str,
) -> None:
    with pytest.raises(ValidationError, match=expected_error):
        await order_service.place(cmd)
```

---

## Integration Test with testcontainers

```python
# tests/integration/conftest.py
import pytest
import pytest_asyncio
from testcontainers.localstack import LocalStackContainer

@pytest.fixture(scope="session")
def localstack():
    with LocalStackContainer(services=["dynamodb", "sns", "sqs"]) as ls:
        yield ls

@pytest_asyncio.fixture(scope="session")
async def dynamo_client(localstack):
    endpoint = localstack.get_url()
    client = aioboto3.Session().resource(
        "dynamodb",
        endpoint_url=endpoint,
        region_name="us-east-2",
    )
    async with client as dynamo:
        yield dynamo

@pytest_asyncio.fixture
async def order_table(dynamo_client):
    """Create a fresh table for each test function."""
    table_name = f"orders-test-{uuid4().hex[:8]}"
    table = await dynamo_client.create_table(
        TableName=table_name,
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[{"AttributeName": "pk", "AttributeType": "S"}],
        KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}],
    )
    yield table
    await table.delete()

@pytest_asyncio.fixture
async def order_repo(order_table) -> DynamoOrderRepository:
    return DynamoOrderRepository(order_table)
```

```python
# tests/integration/test_order_repository.py
@pytest.mark.asyncio
async def test_save_and_find(order_repo: DynamoOrderRepository) -> None:
    order = Order(customer_id="cust-1", items=[valid_item()])
    await order_repo.save(order)

    found = await order_repo.find_by_id(order.id)
    assert found is not None
    assert found.customer_id == order.customer_id
    assert found.status == order.status

@pytest.mark.asyncio
async def test_find_by_id_not_found(order_repo: DynamoOrderRepository) -> None:
    result = await order_repo.find_by_id("nonexistent-id")
    assert result is None
```

---

## Factory Functions (Test Data Builders)

```python
# tests/factories.py
from datetime import datetime, UTC
import uuid

def make_order_item(
    sku: str = "sku-001",
    quantity: int = 1,
    unit_price_cents: int = 1000,
) -> OrderItem:
    return OrderItem(sku=sku, quantity=quantity, unit_price_cents=unit_price_cents)

def make_order(
    customer_id: str = "cust-test",
    status: OrderStatus = OrderStatus.PLACED,
    item_count: int = 1,
) -> Order:
    return Order(
        id=str(uuid.uuid4()),
        customer_id=customer_id,
        items=[make_order_item() for _ in range(item_count)],
        status=status,
        created_at=datetime.now(UTC),
    )

def make_place_order_cmd(**overrides) -> PlaceOrderCmd:
    defaults = dict(
        customer_id="cust-test",
        items=[make_order_item()],
    )
    return PlaceOrderCmd(**{**defaults, **overrides})
```

---

## Async Context Manager Mocking

```python
# Mocking a repository used as async context manager
from unittest.mock import AsyncMock, MagicMock

mock_repo = MagicMock()
mock_tx = AsyncMock()
mock_repo.transaction.return_value.__aenter__ = AsyncMock(return_value=mock_tx)
mock_repo.transaction.return_value.__aexit__ = AsyncMock(return_value=False)

# Test
async with mock_repo.transaction() as tx:
    await tx.save(order)

mock_tx.save.assert_called_once_with(order)
```

---

## pytest.ini / pyproject.toml Configuration

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"          # automatically handles async tests
testpaths = ["tests"]
addopts = [
    "--strict-markers",
    "-ra",                     # show extra summary for all except passed
    "--cov=src",
    "--cov-report=html:coverage",
    "--cov-fail-under=80",
]
markers = [
    "unit: fast tests with no I/O",
    "integration: tests requiring real infrastructure",
    "e2e: full system tests",
    "smoke: post-deploy health checks",
]
```

---

## Cross-References

→ [General Testing Patterns](../general/testing.md) | [Python Testing Guide](../../testing/python/guide.md) | [Mock Generation](../../guides/mock-generation.md) | [Python Conventions](../../conventions/python/index.md)
