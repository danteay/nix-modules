# Testing Guide (Elixir)

> ExUnit setup, Mox mocking, ExMachina factories, integration tests, and coverage for Elixir projects.

---

## Setup

```elixir
# mix.exs
defp deps do
  [
    {:mox, "~> 1.1", only: :test},
    {:ex_machina, "~> 2.8", only: :test},
    {:excoveralls, "~> 0.18", only: :test},
    {:bypass, "~> 2.1", only: :test},       # for HTTP mock servers
    {:plug_cowboy, "~> 2.7"},               # required by bypass
  ]
end

def project do
  [
    test_coverage: [tool: ExCoveralls],
    preferred_cli_env: [
      "coveralls": :test,
      "coveralls.html": :test,
    ]
  ]
end
```

---

## Test Commands

```bash
# All tests
mix test

# Unit tests only
mix test test/unit/

# Integration tests only
mix test test/integration/

# Specific file and line
mix test test/unit/use_cases/place_order_test.exs:42

# Tagged tests
mix test --only integration
mix test --exclude slow

# Watch mode (with mix_test_watch)
mix test.watch

# Coverage
mix coveralls
mix coveralls.html        # opens HTML report
mix coveralls.json        # for CI
```

---

## File Organization

```
test/
├── test_helper.exs
├── support/
│   ├── mocks.ex           # Mox.defmock declarations
│   ├── factories.ex       # ExMachina factory definitions
│   ├── data_case.ex       # Ecto sandbox helper
│   └── conn_case.ex       # Phoenix conn helper (if applicable)
├── unit/
│   ├── domain/
│   │   ├── order_test.exs
│   │   └── order_item_test.exs
│   └── use_cases/
│       └── place_order_test.exs
└── integration/
    ├── adapters/
    │   └── dynamodb_order_repo_test.exs
    └── pipelines/
        └── order_consumer_test.exs
```

---

## test_helper.exs

```elixir
ExUnit.start(exclude: [:integration])

# Configure mocks for test environment
Application.put_env(:my_app, :order_repo, MockOrderRepo)
Application.put_env(:my_app, :event_publisher, MockEventPublisher)

# Start required apps
{:ok, _} = Application.ensure_all_started(:my_app)
```

---

## Unit Test Pattern

```elixir
defmodule MyApp.UseCases.PlaceOrderTest do
  use ExUnit.Case, async: true
  import Mox

  setup :verify_on_exit!

  describe "execute/1 — success path" do
    test "creates order with pending status" do
      stub(MockOrderRepo, :save, fn _order -> :ok end)
      stub(MockEventPublisher, :publish, fn _event -> :ok end)

      {:ok, order} = MyApp.UseCases.PlaceOrder.execute(valid_attrs())

      assert order.status == :pending
      assert order.customer_id == "cust-1"
    end

    test "publishes OrderPlaced event" do
      stub(MockOrderRepo, :save, fn _order -> :ok end)

      expect(MockEventPublisher, :publish, fn event ->
        assert event.type == "OrderPlaced"
        assert event.order_id != nil
        :ok
      end)

      assert {:ok, _order} = MyApp.UseCases.PlaceOrder.execute(valid_attrs())
    end
  end

  describe "execute/1 — error path" do
    test "returns error when save fails" do
      stub(MockOrderRepo, :save, fn _order -> {:error, :db_unavailable} end)
      stub(MockEventPublisher, :publish, fn _ -> :ok end)

      assert {:error, :db_unavailable} =
        MyApp.UseCases.PlaceOrder.execute(valid_attrs())
    end

    test "does not publish event when save fails" do
      stub(MockOrderRepo, :save, fn _order -> {:error, :db_error} end)
      # No expect on MockEventPublisher — verify_on_exit! will fail if called

      MyApp.UseCases.PlaceOrder.execute(valid_attrs())
    end
  end

  defp valid_attrs do
    %{
      customer_id: "cust-1",
      items: [%{sku: "SKU-001", quantity: 2, price: 1500}]
    }
  end
end
```

---

## Factories (ExMachina)

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
end

# Usage in tests
import MyApp.Factory

order = build(:order)
order_with_items = build(:order, items: build_list(3, :order_item))
```

---

## Integration Test with LocalStack (ExAws)

```elixir
# test/integration/adapters/dynamodb_order_repo_test.exs
defmodule MyApp.Adapters.DynamoDB.OrderRepoTest do
  use ExUnit.Case, async: false

  @tag :integration
  setup_all do
    # Assumes LocalStack running via docker-compose or testcontainers
    configure_localstack()
    create_table()
    :ok
  end

  @tag :integration
  test "saves and retrieves order" do
    import MyApp.Factory
    order = build(:order)

    :ok = MyApp.Adapters.DynamoDB.OrderRepo.save(order)

    assert {:ok, found} = MyApp.Adapters.DynamoDB.OrderRepo.find_by_id(order.id)
    assert found.id == order.id
  end

  @tag :integration
  test "returns not_found for missing id" do
    assert {:error, :not_found} =
      MyApp.Adapters.DynamoDB.OrderRepo.find_by_id("nonexistent-id")
  end

  defp configure_localstack do
    Application.put_env(:ex_aws, :dynamodb,
      scheme: "http://",
      host: "localhost",
      port: 4566,
      region: "us-east-1"
    )
    Application.put_env(:ex_aws, :access_key_id, "test")
    Application.put_env(:ex_aws, :secret_access_key, "test")
  end

  defp create_table do
    ExAws.Dynamo.create_table(
      "orders-test",
      [id: :hash],
      %{id: :string},
      1, 1
    ) |> ExAws.request!()
  rescue
    _ -> :ok  # table already exists
  end
end
```

---

## Coverage Configuration

```elixir
# coveralls.json
{
  "coverage_options": {
    "minimum_coverage": 80,
    "treat_no_relevant_lines_as_covered": true
  },
  "skip_files": [
    "test/",
    "lib/my_app_web/telemetry.ex"
  ]
}
```

CI check:

```yaml
- name: Run tests with coverage
  run: mix coveralls.json
  env:
    MIX_ENV: test

- name: Check coverage threshold
  run: |
    COVERAGE=$(jq '.coverage_totals.percent' cover/excoveralls.json)
    echo "Coverage: $COVERAGE%"
    [ $(echo "$COVERAGE >= 80" | bc) -eq 1 ]
```

---

## Cross-References

→ [Testing Strategies](../../testing/general/strategies.md) | [Testing Patterns (Elixir)](../../patterns/elixir/testing.md) | [Conventions (Elixir)](../../conventions/elixir/index.md)
