# PKL Conventions

> Naming, structure, and style for PKL configuration files.

## When to Use PKL

PKL is the **preferred configuration language** for service configuration. Use it for:

- Service runtime configuration (DB settings, timeouts, feature flags)
- Configuration that varies by environment (dev / staging / prod)
- Configs that require validation or type safety

Do NOT use PKL for:

- Simple single-value environment variables (use Lambda env vars directly)
- Secrets (use ejson + AWS Secrets Manager)
- Serverless Framework infrastructure definitions (use YAML)

---

## Naming Conventions

| Construct | Convention | Example |
|-----------|-----------|---------|
| Class name | PascalCase | `DatabaseConfig`, `ServiceConfig` |
| Property name | camelCase | `maxConnections`, `timeoutSeconds` |
| Module name | PascalCase | `ServiceConfig` |
| Constant | UPPER_SNAKE_CASE | `DEFAULT_TIMEOUT` |
| Type alias | PascalCase | `LogLevel`, `Region` |

---

## Class Design

```pkl
// classes.pkl

/// Database connection configuration.
class DatabaseConfig {
  /// Hostname or IP of the database server.
  host: String

  /// Port number (1024–65535).
  port: Int(isBetween(1024, 65535)) = 5432

  /// Database name.
  name: String

  /// Max connections in pool.
  maxConnections: Int(isPositive) = 10

  /// Connection timeout.
  connectTimeout: Duration = 5.s
}

/// Top-level service configuration.
class ServiceConfig {
  db: DatabaseConfig
  region: String = "us-east-2"
  logLevel: "debug"|"info"|"warn"|"error" = "info"
  featureFlags: Map<String, Boolean> = new {}
}
```

**Rules:**

- Document every property with `/// doc comment`
- Provide sensible defaults for optional fields
- Use built-in constraints (`isPositive`, `isBetween`, `matches`)
- Never define the same class in multiple files — all types in `classes.pkl`

---

## Stage Files

```pkl
// dev.pkl
import "classes.pkl"

config: ServiceConfig = new {
  db {
    host = "localhost"
    port = 5432
    name = "myservice_dev"
    maxConnections = 5
  }
  logLevel = "debug"
}
```

```pkl
// prod.pkl — environment-driven
import "classes.pkl"

config: ServiceConfig = new {
  db {
    host = read("env:DB_HOST")
    port = read?("env:DB_PORT")?.toInt() ?? 5432
    name = read("env:DB_NAME")
    maxConnections = 50
  }
  logLevel = "info"
}
```

---

## Composability

### Amending (Override Fields)

```pkl
// staging.pkl — amend dev config with staging settings
import "dev.pkl" as devCfg

config = (devCfg.config) {
  db { maxConnections = 20 }
  logLevel = "warn"
}
```

---

## Evaluation

```bash
pkl eval config/pkl/dev.pkl -f json -o .config.json
pkl eval config/pkl/prod.pkl -f json -o .config.prod.json
```

Add PKL validation to CI:

```yaml
- name: Validate PKL configs
  run: |
    pkl eval config/pkl/dev.pkl -f json > /dev/null
    pkl eval config/pkl/prod.pkl -f json > /dev/null
```

---

## Anti-Patterns

| Wrong | Right |
|-------|-------|
| Hardcoded secrets in `.pkl` | `read("env:SECRET")` |
| Defining types in stage files | Define all types in `classes.pkl` |
| Skipping constraints | Use `isBetween`, `matches`, etc. |
| Complex logic in PKL | PKL is config, not code |
| Duplicating classes across files | Single definition in `classes.pkl` |

---

## Cross-References

→ [PKL Configuration Reference](../../reference/pkl-configuration.md) | [PKL Usage Guide](../../guides/pkl-usage.md) | [Configuration Overview](../../reference/configuration.md)
