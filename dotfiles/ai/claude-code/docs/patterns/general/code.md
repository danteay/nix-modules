# Code Patterns (General)

> Dependency Injection, Inversion of Control, and Service Configuration — language-agnostic concepts.

---

## Dependency Injection (DI)

Pass dependencies from the outside rather than creating them internally.

### Core Principle

```
# BAD — hidden dependency, hard to test
class OrderService:
    def __init__(self):
        self.repo = DynamoRepository()   # creates its own dependency

# GOOD — dependency passed in, easy to swap/mock
class OrderService:
    def __init__(self, repo: OrderRepository):
        self.repo = repo
```

### Types of Injection

| Type | Description | When to Use |
|------|-------------|-------------|
| **Constructor** | Pass deps in constructor | Preferred — makes deps explicit |
| **Method** | Pass dep to specific method | When dep is one-time/optional |
| **Property** | Set after construction | Avoid — hides dependencies |

### Composition Root

All dependency wiring happens **at the entry point** (main, Lambda handler init, app bootstrap). Business logic never creates its own dependencies.

```
main() / handler_init():
    db_client = build_db_client(config)
    repo      = OrderRepository(db_client)
    publisher = SNSEventPublisher(sns_client)
    service   = OrderService(repo, publisher)
    handler   = OrderHandler(service)
    start(handler)
```

---

## Inversion of Control (IoC)

The framework/container calls your code; your code doesn't call the framework.

### Principle

```
# BAD — your code controls the lifecycle
def main():
    result = my_service.process()   # you call the framework

# GOOD — framework calls your registered handler
framework.register(my_handler)
framework.start()                   # framework calls your handler
```

### Lambda IoC Example

```
main() registers handler ──► Lambda runtime calls handler on each invocation
                              └── handler → worker → service → repository
```

Your code only defines what to do. The framework decides when to call it.

### Plugin / Provider Pattern

Register implementations against interfaces. A registry calls them at the right time.

```
registry.register(DatabaseProvider)
registry.register(CacheProvider)
registry.register(MetricsProvider)

registry.start(config)   # calls initialize() on each in order
```

---

## Service Configuration

Centralize config loading and validation at startup. **Fail fast** on misconfiguration.

### Pattern

```
1. Load raw values (env vars, files, PKL-evaluated JSON)
2. Validate all required values are present
3. Parse into typed config struct
4. Fail immediately if invalid (before serving any requests)
5. Pass config to service constructors — never call os.Getenv() in business logic
```

### Config Sources Priority (highest → lowest)

```
1. CLI flags
2. Environment variables
3. Config files (PKL-evaluated JSON, .env)
4. Defaults in code
```

### Rules

- All required config validated at cold start / application init
- Sensitive values come from secrets manager, not config files
- Config is immutable after initialization
- Business logic receives typed config struct, never raw strings

---

## Interface Segregation

Define small, focused interfaces. Consumers depend only on what they use.

### Principle

```
# BAD — fat interface forces wide mocks in tests
interface DataStore {
    save, findById, findAll, delete, runMigrations, backup
}

# GOOD — split by consumer need
interface OrderSaver   { save(order) }
interface OrderFinder  { findById(id), findByCustomer(customerId) }
```

Interfaces are defined **at the consumer**, not at the implementation.

---

## Functional Options / Builder

For constructs with many optional parameters, avoid boolean-laden constructors.

```
# BAD
Client("https://api.example.com", true, false, 30, 3, nil)

# GOOD — named, composable
Client("https://api.example.com",
    WithTimeout(30 * seconds),
    WithRetries(3),
    WithTLS(cert),
)
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|-------------|---------|---------|
| Service creates own dependencies | Untestable, tightly coupled | Constructor injection |
| Global mutable singletons | Hidden state, order-dependent | Pass as constructor arg |
| `os.getenv()` scattered in business logic | No central validation | Typed config struct at init |
| Fat interfaces | Forces wide mocks | Segregated interfaces per consumer |
| Framework-specific types in domain | Domain coupled to infrastructure | Port interfaces in domain |

---

## Language-Specific Implementations

| Language | See |
|----------|-----|
| Go | [Go Code Patterns](../go/code.md) — functional options, provider pattern |
| Python | [Python Code Patterns](../python/code.md) — Protocol, Pydantic, DI |
| TypeScript | [TypeScript Code Patterns](../typescript/code.md) — DI, discriminated unions |

---

## Cross-References

→ [Architecture Patterns](./architecture.md) | [Testing Strategies](../../testing/general/strategies.md) | [Configuration Reference](../../reference/configuration.md)
