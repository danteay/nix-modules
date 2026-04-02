# Elixir Conventions

> Naming, OTP patterns, supervision trees, pattern matching, and mix toolchain rules.

---

## Naming

| Item | Convention | Example |
|------|------------|---------|
| Modules | `UpperCamelCase` | `OrderService`, `PaymentRepository` |
| Functions | `snake_case` | `place_order/2`, `find_by_id/1` |
| Variables | `snake_case` | `order_id`, `retry_count` |
| Atoms | `:snake_case` | `:ok`, `:not_found`, `:order_placed` |
| Macros | `snake_case` | `defmacro with_retry` |
| Processes / GenServers | `UpperCamelCase` | `OrderProcessor`, `PaymentWorker` |
| Predicates | `?` suffix | `valid?/1`, `exists?/1` |
| Bang functions | `!` suffix | `find!/1` (raises on error) |

---

## Behaviours (Ports)

Define behaviours for all external dependencies:

```elixir
defmodule MyApp.Ports.OrderRepository do
  @callback find_by_id(id :: String.t()) :: {:ok, Order.t()} | {:error, :not_found | term()}
  @callback save(order :: Order.t()) :: :ok | {:error, term()}
end

defmodule MyApp.Ports.EventPublisher do
  @callback publish(event :: map()) :: :ok | {:error, term()}
end
```

Implementation:

```elixir
defmodule MyApp.Adapters.DynamoDB.OrderRepo do
  @behaviour MyApp.Ports.OrderRepository

  @impl true
  def find_by_id(id) do
    case DynamoDB.get_item(table(), %{"id" => id}) do
      {:ok, item} -> {:ok, to_domain(item)}
      {:error, :not_found} -> {:error, :not_found}
      {:error, reason} -> {:error, reason}
    end
  end
end
```

---

## Error Handling

Use tagged tuples consistently:

```elixir
# Good — explicit tagged tuples
def place_order(attrs) do
  with {:ok, order} <- Order.new(attrs),
       {:ok, _} <- repo().save(order),
       :ok <- publisher().publish(order_placed_event(order)) do
    {:ok, order}
  end
end

# Bang variant (raises) — only for calls that should never fail in normal flow
def place_order!(attrs) do
  case place_order(attrs) do
    {:ok, order} -> order
    {:error, reason} -> raise "place_order failed: #{inspect(reason)}"
  end
end
```

Rules:

- Return `{:ok, value}` or `{:error, reason}` from all fallible functions
- Use `with` for sequential operations that may fail
- Use bang (`!`) functions only when failure is a programmer error, not a domain error
- Use `case`/`cond`/`if` for simple branching; prefer pattern matching in function heads

---

## Pattern Matching

Prefer function head matching over conditionals:

```elixir
# Good
def status_message(:placed), do: "Order has been placed"
def status_message(:shipped), do: "Order is on its way"
def status_message(:cancelled), do: "Order was cancelled"
def status_message(unknown), do: "Unknown status: #{unknown}"

# Avoid
def status_message(status) do
  cond do
    status == :placed -> "Order has been placed"
    # ...
  end
end
```

---

## OTP / Supervision

### Application Supervisor

```elixir
defmodule MyApp.Application do
  use Application

  @impl true
  def start(_type, _args) do
    children = [
      MyApp.Repo,
      {Task.Supervisor, name: MyApp.TaskSupervisor},
      {MyApp.Workers.EventConsumer, config()},
    ]

    opts = [strategy: :one_for_one, name: MyApp.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
```

### GenServer

```elixir
defmodule MyApp.Workers.EventConsumer do
  use GenServer

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(opts) do
    {:ok, %{config: opts, processed: 0}}
  end

  @impl true
  def handle_cast({:process, event}, state) do
    case handle_event(event) do
      :ok -> {:noreply, %{state | processed: state.processed + 1}}
      {:error, reason} ->
        Logger.error("event processing failed", reason: inspect(reason))
        {:noreply, state}
    end
  end
end
```

Rules:

- Always set a supervision strategy intentionally (`:one_for_one`, `:rest_for_one`, `:one_for_all`)
- Use `:temporary` restart for workers that should not restart on normal exit
- Avoid `GenServer.call/3` in hot paths — prefer `cast` for fire-and-forget
- Use `Task.Supervisor.async_nolink` for supervised, non-blocking tasks

---

## Dependency Injection

Elixir uses module configuration or behavior injection:

```elixir
# config/test.exs
config :my_app, :order_repo, MyApp.Adapters.InMemory.OrderRepo

# use_cases/place_order.ex
defp repo, do: Application.get_env(:my_app, :order_repo)

def place_order(attrs) do
  with {:ok, order} <- Order.new(attrs),
       {:ok, _} <- repo().save(order) do
    {:ok, order}
  end
end
```

For test-time injection, use Mox behaviours:

```elixir
# test/support/mocks.ex
Mox.defmock(MyApp.MockOrderRepo, for: MyApp.Ports.OrderRepository)
```

---

## Structured Logging

```elixir
# Use Logger with metadata
require Logger

def place_order(attrs) do
  Logger.info("placing order", order_id: attrs[:id], customer_id: attrs[:customer_id])

  case do_place(attrs) do
    {:ok, order} ->
      Logger.info("order placed", order_id: order.id)
      {:ok, order}

    {:error, reason} ->
      Logger.error("failed to place order", reason: inspect(reason))
      {:error, reason}
  end
end
```

Configure JSON logging for production with `logger_json` or `logger_backends`.

---

## Toolchain

```bash
# Formatting
mix format

# Linting / static analysis
mix credo --strict
mix dialyzer   # type checking via dialyxir

# Tests
mix test
mix test --only integration
mix test.coverage

# Dependencies
mix deps.get
mix deps.audit  # security audit
```

Key libraries:

- `mox` — behaviour-based mocking
- `credo` — static analysis and style
- `dialyxir` — Dialyzer type checking
- `ex_unit` — built-in test framework
- `broadway` — SQS/Kafka consumer pipelines
- `phoenix` — web framework (when needed)
- `ecto` — DB abstraction (PostgreSQL preferred)

---

## Cross-References

→ [Patterns (Elixir)](../../patterns/elixir/code.md) | [Testing (Elixir)](../../testing/elixir/guide.md) | [General Conventions](../general/common-pitfalls.md)
