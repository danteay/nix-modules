# PKL Configuration Reference

> Type system, built-in constraints, and patterns for PKL configuration files.

## Why PKL

PKL (Pkl — Apple's configuration language) provides:

- **Type safety** — catch config errors before deployment
- **Composability** — extend, amend, and override configs
- **Validation** — built-in constraints (`isBetween`, `matches`, `startsWith`, etc.)
- **Multi-format output** — evaluate to JSON, YAML, TOML or Java properties

---

## Type System

### Scalar Types

```pkl
name: String
port: Int
ratio: Float
enabled: Boolean
nothing: Null
```

### Collection Types

```pkl
tags: List<String>
limits: Map<String, Int>
endpoints: Set<String>
```

### Union / Nullable Types

```pkl
logLevel: "debug"|"info"|"warn"|"error"
optionalValue: String?     // nullable
```

### Class Definition

```pkl
class DatabaseConfig {
  host: String
  port: Int(isBetween(1024, 65535))
  name: String
  password: String?
  maxConnections: Int = 10
}
```

---

## Constraints

```pkl
// Range
port: Int(isBetween(1, 65535))

// Regex
email: String(matches(Regex("^[\\w.]+@[\\w.]+$")))

// Length
name: String(length.isBetween(1, 128))

// Non-empty
tags: List<String>(isDistinct)

// Custom
timeout: Duration(this > 0.s && this <= 30.s)
```

---

## Composition Patterns

### Extending (inheritance)

```pkl
open class BaseConfig {
  region: String = "us-east-2"
  environment: String
}

class ServiceConfig extends BaseConfig {
  db: DatabaseConfig
}
```

### Amending (override specific fields)

```pkl
import "base.pkl"

config = (base.config) {
  region = "us-west-2"
  db {
    maxConnections = 50
  }
}
```

### Template pattern (shared base, stage overrides)

```pkl
// template.pkl
abstract module Template
  db: DatabaseConfig
  logLevel: "debug"|"info"|"warn"|"error"

// dev.pkl
extends "template.pkl"
  db { host = "localhost"; name = "mydb_dev" }
  logLevel = "debug"

// prod.pkl
extends "template.pkl"
  db { host = read("env:DB_HOST"); name = "mydb_prod" }
  logLevel = "info"
```

---

## Reading from Environment

```pkl
// Required env var (fails if missing)
host: String = read("env:DB_HOST")

// Optional with default
logLevel: String = read?("env:LOG_LEVEL") ?? "info"
```

---

## Evaluation

```bash
# To JSON
pkl eval config/pkl/dev.pkl -f json

# To YAML
pkl eval config/pkl/dev.pkl -f yaml

# To stdout
pkl eval config/pkl/dev.pkl

# With expression
pkl eval config/pkl/dev.pkl -x "config.db.port"
```

---

**Rules:**

- Global definitions should be a separated project and should never define values itself
- Global configurations are a separated project that can use global definitions to define concrete reusable values
- Always use PKL projects to be able to reference global definitions
- Stage files only contain concrete values — no new class definitions
- Sensitive values read from environment at eval time; never hardcoded in PKL files

---

## Cross-References

→ [Configuration Overview](./configuration.md) | [PKL Usage Guide](../guides/pkl-usage.md) | [Common Pitfalls](../conventions/common-pitfalls.md)
