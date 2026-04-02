# Code Patterns (Elixir)

> Behaviours, dependency injection via config, domain modeling, service patterns, and OTP in Elixir.

---

## Behaviours (Ports)

Define behaviours for all external dependencies:

```elixir
defmodule MyApp.Ports.OrderRepository do
  @callback find_by_id(id :: String.t()) ::
    {:ok, MyApp.Domain.Order.t()} | {:error, :not_found | term()}

  @callback save(order :: MyApp.Domain.Order.t()) :: :ok | {:error, term()}

  @callback list_by_customer(customer_id :: String.t()) ::
    {:ok, [MyApp.Domain.Order.t()]} | {:error, term()}
end
```

Implementation:

```elixir
defmodule MyApp.Adapters.DynamoDB.OrderRepo do
  @behaviour MyApp.Ports.OrderRepository

  @impl true
  def find_by_id(id) do
    case DynamoDB.get_item(table(), key(id)) do
      {:ok, %{"Item" => item}} -> {:ok, to_domain(item)}
      {:ok, %{}} -> {:error, :not_found}
      {:error, reason} -> {:error, reason}
    end
  end

  @impl true
  def save(order) do
    DynamoDB.put_item(table(), to_dynamo(order))
  end

  defp table, do: Application.fetch_env!(:my_app, :orders_table)
end
```

---

## Dependency Injection via Application Config

```elixir
# config/runtime.exs
config :my_app,
  order_repo: MyApp.Adapters.DynamoDB.OrderRepo,
  event_publisher: MyApp.Adapters.SNS.Publisher

# config/test.exs
config :my_app,
  order_repo: MyApp.Mocks.OrderRepo,
  event_publisher: MyApp.Mocks.EventPublisher

# use_cases/place_order.ex
defmodule MyApp.UseCases.PlaceOrder do
  defp repo, do: Application.fetch_env!(:my_app, :order_repo)
  defp publisher, do: Application.fetch_env!(:my_app, :event_publisher)

  def execute(attrs) do
    with {:ok, order} <- MyApp.Domain.Order.new(attrs),
         :ok <- repo().save(order),
         :ok <- publisher().publish(order_placed_event(order)) do
      {:ok, order}
    end
  end
end
```

---

## Domain Modeling

### Structs + Typespec

```elixir
defmodule MyApp.Domain.Order do
  @enforce_keys [:id, :customer_id, :items, :status]

  defstruct [:id, :customer_id, :items, :status, :discount_code,
             created_at: nil]

  @type status :: :pending | :placed | :shipped | :cancelled

  @type t :: %__MODULE__{
    id: String.t(),
    customer_id: String.t(),
    items: [OrderItem.t()],
    status: status(),
    discount_code: String.t() | nil,
    created_at: DateTime.t() | nil
  }

  def new(attrs) do
    with {:ok, id} <- validate_id(attrs[:id]),
         {:ok, customer_id} <- validate_required(attrs[:customer_id], :customer_id),
         {:ok, items} <- validate_items(attrs[:items]) do
      {:ok, %__MODULE__{
        id: id,
        customer_id: customer_id,
        items: items,
        status: :pending,
        created_at: DateTime.utc_now()
      }}
    end
  end

  def place(%__MODULE__{status: :pending} = order) do
    {:ok, %{order | status: :placed}}
  end

  def place(%__MODULE__{status: status}) do
    {:error, {:invalid_transition, status, :placed}}
  end
end
```

---

## `with` for Sequential Operations

```elixir
def process_payment(order_id, payment_attrs) do
  with {:ok, order} <- repo().find_by_id(order_id),
       {:ok, order} <- validate_for_payment(order),
       {:ok, payment} <- payment_service().charge(payment_attrs),
       {:ok, order} <- Order.mark_paid(order, payment.id),
       :ok <- repo().save(order),
       :ok <- publisher().publish(payment_processed_event(order, payment)) do
    {:ok, order}
  else
    {:error, :not_found} -> {:error, :order_not_found}
    {:error, :payment_failed} = err -> err
    {:error, reason} -> {:error, {:unexpected, reason}}
  end
end
```

---

## GenServer for Stateful Workers

```elixir
defmodule MyApp.Workers.OrderProcessor do
  use GenServer

  defmodule State do
    defstruct [:config, processed: 0, errors: 0]
  end

  # Client API
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  def process(event) do
    GenServer.cast(__MODULE__, {:process, event})
  end

  def stats do
    GenServer.call(__MODULE__, :stats)
  end

  # Server callbacks
  @impl true
  def init(opts) do
    {:ok, %State{config: opts}}
  end

  @impl true
  def handle_cast({:process, event}, state) do
    case MyApp.UseCases.PlaceOrder.execute(event) do
      {:ok, _order} ->
        {:noreply, %{state | processed: state.processed + 1}}

      {:error, reason} ->
        Logger.error("order processing failed", reason: inspect(reason), event: inspect(event))
        {:noreply, %{state | errors: state.errors + 1}}
    end
  end

  @impl true
  def handle_call(:stats, _from, state) do
    {:reply, Map.take(state, [:processed, :errors]), state}
  end
end
```

---

## Broadway for SQS Consumers

```elixir
defmodule MyApp.Pipelines.OrderEventPipeline do
  use Broadway

  def start_link(_opts) do
    Broadway.start_link(__MODULE__,
      name: __MODULE__,
      producer: [
        module: {BroadwaySQS.Producer, queue_url: queue_url()},
        concurrency: 1
      ],
      processors: [default: [concurrency: 10]],
      batchers: [default: [batch_size: 10, batch_timeout: 2_000]]
    )
  end

  @impl true
  def handle_message(_, %Broadway.Message{data: data} = msg, _ctx) do
    case Jason.decode(data) do
      {:ok, event} ->
        case MyApp.UseCases.PlaceOrder.execute(event) do
          {:ok, _} -> msg
          {:error, reason} -> Broadway.Message.failed(msg, reason)
        end

      {:error, _} ->
        Broadway.Message.failed(msg, :invalid_json)
    end
  end

  @impl true
  def handle_batch(_, messages, _, _) do
    messages
  end

  defp queue_url, do: Application.fetch_env!(:my_app, :order_queue_url)
end
```

---

## Error Types

```elixir
defmodule MyApp.Errors do
  defmodule NotFound do
    defexception [:message, :resource, :id]

    @impl true
    def exception(opts) do
      resource = opts[:resource] || "resource"
      id = opts[:id]
      %__MODULE__{
        message: "#{resource} #{id} not found",
        resource: resource,
        id: id
      }
    end
  end

  defmodule ValidationError do
    defexception [:message, :fields]

    @impl true
    def exception(fields) do
      %__MODULE__{
        message: "Validation failed: #{inspect(fields)}",
        fields: fields
      }
    end
  end
end
```

---

## Cross-References

→ [Conventions (Elixir)](../../conventions/elixir/index.md) | [Concurrency (Elixir)](./concurrency.md) | [Testing (Elixir)](../../testing/elixir/guide.md)
