# PKL Usage Guide

> Day-to-day workflow for authoring, validating, and evaluating PKL configurations.

## Installation

PKL is available in the Nix dev shell. It's also available as a standalone binary:

```bash
# Via Nix dev shell (recommended)
nix develop  # pkl is included

# Direct install (macOS)
brew install pkl
```

---

## Day-to-Day Workflow

### 1. Define Types (once per service)

```bash
# Edit config/pkl/classes.pkl — define all types here
```

### 2. Write Stage Values

```bash
# Edit config/pkl/dev.pkl with development values
# Edit config/pkl/prod.pkl (read sensitive values from env vars)
```

### 3. Validate

```bash
# Check a single file
pkl eval config/pkl/dev.pkl

# Check all stage files
for f in config/pkl/*.pkl; do pkl eval "$f" > /dev/null && echo "OK: $f"; done
```

### 4. Evaluate to JSON for Service

```bash
pkl eval config/pkl/dev.pkl -f json -o .config.json
```

### 5. Use in Application

```go
// Read at Lambda cold start
data, _ := os.ReadFile(".config.json")
json.Unmarshal(data, &cfg)
```

---

## Common Operations

### Evaluate to Different Formats

```bash
pkl eval config.pkl -f json    # JSON
pkl eval config.pkl -f yaml    # YAML
pkl eval config.pkl -f toml    # TOML
pkl eval config.pkl            # PKL (default)
```

### Extract a Single Value

```bash
pkl eval config/pkl/dev.pkl -x "config.db.port"
pkl eval config/pkl/dev.pkl -x "config.logLevel"
```

### Evaluate with Environment Variable Override

```bash
DB_HOST=prod-db.example.com pkl eval config/pkl/prod.pkl -f json
```

### Watch Mode (during development)

```bash
pkl eval --watch config/pkl/dev.pkl
```

---

## Structuring a New Service Config

```bash
mkdir -p config/pkl

# 1. Create types file
cat > config/pkl/classes.pkl << 'EOF'
class DatabaseConfig {
  host: String
  port: Int = 5432
  name: String
}

class ServiceConfig {
  db: DatabaseConfig
  logLevel: "debug"|"info"|"warn"|"error" = "info"
}
EOF

# 2. Create dev values
cat > config/pkl/dev.pkl << 'EOF'
import "classes.pkl"

config: ServiceConfig = new {
  db { host = "localhost"; name = "myservice_dev" }
  logLevel = "debug"
}
EOF

# 3. Create prod values (environment-driven)
cat > config/pkl/prod.pkl << 'EOF'
import "classes.pkl"

config: ServiceConfig = new {
  db {
    host = read("env:DB_HOST")
    name = read("env:DB_NAME")
  }
}
EOF
```

---

## Taskfile Integration

```yaml
# Taskfile.yml
tasks:
  config:validate:
    desc: Validate all PKL configs
    cmds:
      - pkl eval config/pkl/dev.pkl -f json > /dev/null
      - pkl eval config/pkl/prod.pkl -f json > /dev/null
      - echo "PKL configs valid"

  config:generate:
    desc: Generate .config.json for local dev
    cmds:
      - pkl eval config/pkl/dev.pkl -f json -o .config.json
      - echo "Generated .config.json"

  deploy:dev:
    deps: [config:validate]
    cmds:
      - pkl eval config/pkl/dev.pkl -f json -o .config.json
      - serverless deploy --stage dev
```

---

## Debugging PKL

### Trace evaluation

```bash
pkl eval config/pkl/prod.pkl --log-level trace
```

### Check which env vars are read

```bash
pkl eval config/pkl/prod.pkl 2>&1 | grep "read env:"
```

### Validate a specific constraint

```pkl
// Add a temporary check
_test: Int = port   // evaluates port to catch constraint violations
```

---

## PKL in CI

```yaml
# .github/workflows/ci.yml
- name: Validate PKL configs
  run: |
    nix develop --command pkl eval config/pkl/dev.pkl -f json > /dev/null
    nix develop --command pkl eval config/pkl/prod.pkl -f json > /dev/null

- name: Generate config artifact
  run: nix develop --command pkl eval config/pkl/dev.pkl -f json -o .config.json

- uses: actions/upload-artifact@v4
  with:
    name: service-config
    path: .config.json
```

---

## Cross-References

→ [PKL Configuration Reference](../reference/pkl-configuration.md) | [PKL Conventions](../conventions/pkl.md) | [Configuration Overview](../reference/configuration.md)
