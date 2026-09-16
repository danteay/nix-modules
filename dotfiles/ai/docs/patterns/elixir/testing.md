# Testing Patterns (Elixir)

> ExUnit, Mox, factories with ExMachina, async tests, and integration tests in Elixir.

---

## Test File Organization

```
test/
├── test_helper.exs          # Mox setup, ExUnit config
├── support/
│   ├── factories.ex         # ExMachina factories
│   ├── fixtures.ex          # Static test data
│   └── mocks.ex             # Mox mock definitions
├── unit/
│   ├── domain/
│   │   └── order_test.exs
│   └── use_cases/
│       └── place_order_test.exs
└── integration/
    ├── adapters/
    │   └── order_repo_test.exs
    └── pipelines/
        └── order_consumer_test.exs
```

---

## ExUnit Structure

```elixir
defmodule MyApp.UseCases.PlaceOrderTest do
  use ExUnit.Case, async: true
  import Mox

  setup :verify_on_exit!

  describe "execute/1" do
    test "saves order and publishes event on success" do
      # Arrange
      expect(MockOrderRepo, :save, fn order ->
        assert order.customer_id == "cust-1"
        :ok
      end)

      expect(MockEventPublisher, :publish, fn event ->
        assert match?(%{type: "OrderPlaced"}, event)
        :ok
      end)

      # Act
      result = MyApp.UseCases.PlaceOrder.execute(%{
        customer_id: "cust-1",
        items: [%{sku: "SKU-1", quantity: 1, price: 1000}]
      })

      # Assert
      assert {:ok, %MyApp.Domain.Order{} = order} = result
      assert order.customer_id == "cust-1"
      assert order.status == :pending
    end

    test "returns error when repo fails" do
      stub(MockOrderRepo, :save, fn _order -> {:error, :db_error} end)
      stub(MockEventPublisher, :publish, fn _ -> :ok end)

      result = MyApp.UseCases.PlaceOrder.execute(valid_attrs())

      assert {:error, :db_error} = result
    end
  end

  defp valid_attrs do
    %{customer_id: "cust-test", items: [%{sku: "SKU-1", quantity: 1, price: 500}]}
  end
end
```

---

## Mox Setup

```elixir
# test/support/mocks.ex
Mox.defmock(MockOrderRepo, for: MyApp.Ports.OrderRepository)
Mox.defmock(MockEventPublisher, for: MyApp.Ports.EventPublisher)

# test/test_helper.exs
ExUnit.start()

# Configure test environment to use mocks
Application.put_env(:my_app, :order_repo, MockOrderRepo)
Application.put_env(:my_app, :event_publisher, MockEventPublisher)
```

Mox rules:
- Use `expect/3` for strict "called exactly N times" assertions
- Use `stub/3` for "may be called any number of times" (background calls)
- Use `setup :verify_on_exit!` to assert all `expect` calls were made
- Use `allow/3` in async tests to share mocks across processes

---

## Factories with ExMachina

```elixir
# test/support/factories.ex
defmodule MyApp.Factory do
  use ExMachina

  def order_factory do
    %MyApp.Domain.Order{
      id: sequence(:id, &"order-#{&1}"),
      customer_id: sequence(:customer_id, &"cust-#{&1}"),
      items: [build(:order_item)],
      status: :pending,
      created_at: DateTime.utc_now()
    }
  end

  def order_item_factory do
    %MyApp.Domain.OrderItem{
      sku: sequence(:sku, &"SKU-#{&1}"),
      quantity: 1,
      price: 1000
    }
  end

  def placed_order_factory do
    build(:order, status: :placed)
  end
end

# mix.exs
{:ex_machina, "~> 2.8", only: :test}

# Usage in tests
import MyApp.Factory

order = build(:order)
placed_order = build(:placed_order, customer_id: "specific-cust")
```

---

## Async Tests

```elixir
# Most unit tests can run async: true
use ExUnit.Case, async: true

# Integration tests touching shared state must be async: false
use ExUnit.Case, async: false
```

Rules:
- Use `async: true` for all pure function / Mox tests
- Use `async: false` for database, external service, or global state tests
- Use `Ecto.Adapters.SQL.Sandbox` for async DB tests with Ecto

---

## Integration Tests with Ecto + Sandbox

```elixir
# config/test.exs
config :my_app, MyApp.Repo,
  pool: Ecto.Adapters.SQL.Sandbox

# test/support/data_case.ex
defmodule MyApp.DataCase do
  use ExUnit.CaseTemplate

  using do
    quote do
      import Ecto
      import Ecto.Query
      alias MyApp.Repo
    end
  end

  setup tags do
    :ok = Ecto.Adapters.SQL.Sandbox.checkout(MyApp.Repo)

    unless tags[:async] do
      Ecto.Adapters.SQL.Sandbox.mode(MyApp.Repo, {:shared, self()})
    end

    :ok
  end
end

# Usage
defmodule MyApp.OrderRepoTest do
  use MyApp.DataCase, async: true

  test "finds order by id" do
    order = insert!(:order)

    result = MyApp.Adapters.Postgres.OrderRepo.find_by_id(order.id)
    assert {:ok, found} = result
    assert found.id == order.id
  end
end
```

---

## Broadway Consumer Tests

```elixir
defmodule MyApp.OrderConsumerTest do
  use ExUnit.Case, async: false
  import Mox

  setup :verify_on_exit!

  test "processes valid message and saves order" do
    expect(MockOrderRepo, :save, fn _order -> :ok end)
    expect(MockEventPublisher, :publish, fn _event -> :ok end)

    message = %Broadway.Message{
      data: Jason.encode!(%{"customer_id" => "cust-1", "items" => []}),
      acknowledger: Broadway.NoopAcknowledger.init()
    }

    result = MyApp.OrderConsumer.handle_message(:default, message, %{})
    assert result.status == :ok
  end

  test "marks message failed for invalid JSON" do
    message = %Broadway.Message{
      data: "not-json",
      acknowledger: Broadway.NoopAcknowledger.init()
    }

    result = MyApp.OrderConsumer.handle_message(:default, message, %{})
    assert {:failed, _reason} = result.status
  end
end
```

---

## Running Tests

```bash
# All tests
mix test

# Specific file
mix test test/unit/use_cases/place_order_test.exs

# Specific test by line
mix test test/unit/use_cases/place_order_test.exs:15

# Tag-filtered
mix test --only integration
mix test --exclude integration

# Coverage (via excoveralls)
mix coveralls
mix coveralls.html
mix coveralls.json    # for CI

# Dialyzer (type checking)
mix dialyzer
```

---

## Cross-References

→ [Testing Strategies](../../testing/general/strategies.md) | [Testing Guide (Elixir)](../../testing/elixir/guide.md) | [Code Patterns (Elixir)](./code.md)
