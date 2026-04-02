# Code Patterns (PKL)

> Schema composition, amending chains, template patterns, and validation in PKL.

---

## Base Schema Definition

```pkl
// base/ServiceConfig.pkl
module base.ServiceConfig

/// The service name — used in metrics and logs.
name: String

/// The deployment environment.
env: "dev" | "staging" | "prod"

/// AWS region for this service.
awsRegion: String = "us-east-1"

/// Log level.
logLevel: "debug" | "info" | "warn" | "error" = "info"
```

---

## Class Hierarchy

```pkl
// config/types.pkl
module config.types

class DatabaseConfig {
  /// DynamoDB table name
  tableName: String

  /// Read capacity units (provisioned mode only)
  readCapacity: Int(this > 0) = 5

  /// Write capacity units (provisioned mode only)
  writeCapacity: Int(this > 0) = 5
}

class QueueConfig {
  /// SQS queue URL
  url: String(startsWith("https://"))

  /// Visibility timeout in seconds
  visibilityTimeout: Int(isBetween(30, 43200)) = 180

  /// Dead-letter queue URL
  dlqUrl: String(startsWith("https://"))

  /// Max receive count before DLQ
  maxReceiveCount: Int(isBetween(1, 10)) = 3
}

class HttpConfig {
  port: Int(isBetween(1024, 65535)) = 8080
  readTimeout: Duration = 30.s
  writeTimeout: Duration = 30.s
  idleTimeout: Duration = 120.s
}
```

---

## Service Config with Constraints

```pkl
// config/AppConfig.pkl
module config.AppConfig

import "types.pkl"

name: String(length > 0)
env: "dev" | "staging" | "prod"

db: types.DatabaseConfig
queue: types.QueueConfig
http: types.HttpConfig = new {}

/// Feature flags — keys must be camelCase
features: Mapping<String, Boolean> = {}

/// Maximum number of retries for idempotent operations
maxRetries: Int(isBetween(0, 10)) = 3
```

---

## Amending Pattern (Template → Environment)

```pkl
// config/base.pkl
module config.base

import "AppConfig.pkl"

/// Base (template) — fill in environment-specific values by amending
db: AppConfig.DatabaseConfig = new {
  tableName = "orders"  // will be overridden per env
}
```

```pkl
// config/dev.pkl
amends "base.pkl"

env = "dev"

db {
  tableName = "orders-dev"
  readCapacity = 1
  writeCapacity = 1
}

queue {
  url = read("env:SQS_QUEUE_URL")
  dlqUrl = read("env:SQS_DLQ_URL")
}
```

```pkl
// config/prod.pkl
amends "base.pkl"

env = "prod"

logLevel = "warn"

db {
  tableName = "orders-prod"
  readCapacity = 100
  writeCapacity = 50
}

queue {
  url = read("env:SQS_QUEUE_URL")
  dlqUrl = read("env:SQS_DLQ_URL")
  visibilityTimeout = 300
}
```

---

## Reading Environment Variables

```pkl
// Read env var — fails at eval time if not set
queue {
  url = read("env:SQS_QUEUE_URL")
}

// Read env var with fallback (nullable read)
logLevel = read?("env:LOG_LEVEL") ?? "info"

// Read env var and validate
awsRegion: String = let(region = read("env:AWS_REGION"))
  if (region.isEmpty) "us-east-1" else region
```

---

## Listing/Mapping Patterns

```pkl
// List with constraints
allowedOrigins: Listing<String(startsWith("https://"))> = new {
  "https://app.example.com"
  "https://admin.example.com"
}

// Mapping (key-value)
featureFlags: Mapping<String, Boolean> = new {
  ["newCheckoutFlow"] = true
  ["betaReporting"] = false
}

// Dynamic list construction
serviceUrls: Listing<String> = new {
  "https://api.example.com"
  when (env == "dev") {
    "http://localhost:8080"
  }
}
```

---

## Module Composition (import + amend)

```pkl
// shared/Monitoring.pkl
module shared.Monitoring

class MetricsConfig {
  namespace: String
  enabled: Boolean = true
  interval: Duration = 60.s
}

class TracingConfig {
  endpoint: String(startsWith("http"))
  samplingRate: Float(isBetween(0.0, 1.0)) = 0.1
}

metrics: MetricsConfig
tracing: TracingConfig
```

```pkl
// config/prod.pkl — compose monitoring into service config
amends "base.pkl"

import "shared/Monitoring.pkl"

/// Monitoring configuration
monitoring: Monitoring = new {
  metrics {
    namespace = "MyService/Prod"
  }
  tracing {
    endpoint = read("env:OTEL_EXPORTER_OTLP_ENDPOINT")
    samplingRate = 0.05
  }
}
```

---

## Output Formats

PKL can render to multiple formats for different consumers:

```bash
# Render to JSON (for Go, Node.js consumption)
pkl eval --format json config/prod.pkl -o config/prod.json

# Render to YAML (for Kubernetes manifests)
pkl eval --format yaml config/prod.pkl

# Render to TOML
pkl eval --format toml config/prod.pkl

# Render to dotenv
pkl eval --format properties config/prod.pkl

# Multiple outputs
pkl eval config/dev.pkl config/prod.pkl --format json -o generated/
```

---

## Validation-Only Mode

Use `pkl eval` in CI to validate without generating output:

```bash
# Validate all config files
pkl eval config/*.pkl --dry-run

# Check specific file
pkl eval --format json config/prod.pkl > /dev/null && echo "valid"
```

---

## Anti-Patterns

```pkl
// BAD — hardcoded secrets
database {
  password = "super-secret-123"  // never commit secrets
}

// GOOD — read from environment or secrets manager
database {
  password = read("env:DB_PASSWORD")
}

// BAD — unvalidated open string type for constrained values
port: String    // should be Int with constraints

// GOOD
port: Int(isBetween(1024, 65535)) = 8080

// BAD — using `Any` type
options: Any    // loses all type safety

// GOOD
options: Mapping<String, String>
```

---

## Cross-References

→ [Conventions (PKL)](../../conventions/pkl/index.md) | [Testing (PKL)](../../testing/pkl/guide.md) | [Configuration Reference](../../reference/configuration.md) | [PKL Configuration](../../reference/pkl-configuration.md)
