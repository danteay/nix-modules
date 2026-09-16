# Concurrency Patterns (Elixir)

> Task, GenServer, Broadway, supervision trees, and process-based concurrency in Elixir.

---

## Task for One-Off Async Work

```elixir
# Fire and forget (supervised)
Task.Supervisor.start_child(MyApp.TaskSupervisor, fn ->
  process_event(event)
end)

# Await a single result
task = Task.async(fn -> fetch_order(id) end)
order = Task.await(task, 5_000)  # timeout in ms

# Await multiple tasks concurrently
tasks = Enum.map(order_ids, fn id ->
  Task.async(fn -> repo().find_by_id(id) end)
end)

results = Task.await_many(tasks, 10_000)
```

Rules:

- Use `Task.Supervisor.start_child/2` for fire-and-forget tasks — do not spawn raw `Task.async` outside supervised contexts
- Always specify a timeout for `Task.await/2` — default 5s is often too short or too long
- Use `Task.await_many/2` for a known-size collection of concurrent tasks

---

## Task.async_stream for Parallel Enumeration

```elixir
order_ids
|> Task.async_stream(
  fn id -> repo().find_by_id(id) end,
  max_concurrency: 10,
  timeout: 5_000,
  on_timeout: :kill_task
)
|> Enum.reduce({[], []}, fn
  {:ok, {:ok, order}}, {ok, err} -> {[order | ok], err}
  {:ok, {:error, reason}}, {ok, err} -> {ok, [reason | err]}
  {:exit, reason}, {ok, err} -> {ok, [reason | err]}
end)
```

Rules:

- Set `max_concurrency` explicitly — default is `System.schedulers_online()`
- Set `on_timeout: :kill_task` to prevent task accumulation on slow items
- Handle `{:exit, reason}` — tasks can be killed on timeout

---

## GenServer Worker Pool

```elixir
defmodule MyApp.WorkerPool do
  use Supervisor

  def start_link(size) do
    Supervisor.start_link(__MODULE__, size, name: __MODULE__)
  end

  @impl true
  def init(size) do
    children = Enum.map(1..size, fn i ->
      Supervisor.child_spec(
        {MyApp.Worker, name: :"worker_#{i}"},
        id: :"worker_#{i}"
      )
    end)

    Supervisor.init(children, strategy: :one_for_one)
  end
end
```

For managed pooling, prefer `poolboy` or `nimble_pool`:

```elixir
# mix.exs
{:nimble_pool, "~> 1.0"}

# Usage
NimblePool.checkout!(MyPool, :checkout, fn _from, worker ->
  result = do_work(worker)
  {result, worker}
end)
```

---

## Broadway for SQS / Kafka Consumers

```elixir
defmodule MyApp.OrderConsumer do
  use Broadway

  def start_link(_opts) do
    Broadway.start_link(__MODULE__,
      name: __MODULE__,
      producer: [
        module: {BroadwaySQS.Producer,
          queue_url: Application.fetch_env!(:my_app, :queue_url),
          config: [region: "us-east-1"]
        },
        concurrency: 2
      ],
      processors: [
        default: [concurrency: 10, max_demand: 10]
      ],
      batchers: [
        db: [batch_size: 100, batch_timeout: 1_000, concurrency: 5]
      ]
    )
  end

  @impl true
  def handle_message(:default, message, _context) do
    case process(message.data) do
      :ok -> message
      {:error, reason} -> Broadway.Message.failed(message, reason)
    end
  end

  @impl true
  def handle_batch(:db, messages, _batch_info, _context) do
    # bulk insert / batch DynamoDB write
    Enum.map(messages, fn msg ->
      case bulk_save(msg.data) do
        :ok -> msg
        {:error, reason} -> Broadway.Message.failed(msg, reason)
      end
    end)
  end
end
```

---

## Process Registry and Dynamic Supervision

```elixir
# Registry for named processes
{Registry, keys: :unique, name: MyApp.OrderRegistry}

# Start a process per order
DynamicSupervisor.start_child(MyApp.DynamicSupervisor,
  {MyApp.OrderProcess, order_id: order_id}
)

# Find and call a specific process
case Registry.lookup(MyApp.OrderRegistry, order_id) do
  [{pid, _}] -> GenServer.call(pid, :get_status)
  [] -> {:error, :not_found}
end
```

```elixir
defmodule MyApp.OrderProcess do
  use GenServer, restart: :transient

  def start_link(opts) do
    order_id = Keyword.fetch!(opts, :order_id)
    GenServer.start_link(__MODULE__, opts,
      name: {:via, Registry, {MyApp.OrderRegistry, order_id}}
    )
  end
end
```

---

## Timeouts and Cancellation

```elixir
# GenServer call with timeout
GenServer.call(server, :request, 10_000)

# Task with timeout and cleanup
task = Task.async(fn -> expensive_operation() end)
case Task.yield(task, 5_000) || Task.shutdown(task) do
  {:ok, result} -> result
  nil -> {:error, :timeout}
end

# receive with timeout
receive do
  {:response, data} -> {:ok, data}
after
  5_000 -> {:error, :timeout}
end
```

---

## Supervision Strategies

| Strategy | Use When |
|----------|----------|
| `:one_for_one` | Workers are independent (default) |
| `:one_for_all` | All children depend on each other |
| `:rest_for_one` | Later children depend on earlier ones |

```elixir
# Application supervisor
children = [
  MyApp.Repo,                                   # DB connection pool
  {Registry, keys: :unique, name: MyApp.OrderRegistry},
  {DynamicSupervisor, name: MyApp.DynamicSupervisor, strategy: :one_for_one},
  {Task.Supervisor, name: MyApp.TaskSupervisor},
  MyApp.OrderConsumer,                           # Broadway pipeline
]

Supervisor.init(children, strategy: :one_for_one)
```

---

## Cross-References

→ [Concurrency Concepts](../general/concurrency.md) | [Code Patterns (Elixir)](./code.md) | [Testing (Elixir)](../../testing/elixir/guide.md)
