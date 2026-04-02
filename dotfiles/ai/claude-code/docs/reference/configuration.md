# Configuration Reference

> How services manage configuration: PKL schemas, environment variables, and secrets.

## Configuration Stack

```text
┌─────────────────────────────────────┐
│  PKL schemas  (type-safe config)    │  ← source of truth for structure
├─────────────────────────────────────┤
│  Stage files  (dev / prod values)   │  ← non-sensitive values
├─────────────────────────────────────┤
│  ejson files  (encrypted secrets)   │  ← sensitive values, encrypted at rest
├─────────────────────────────────────┤
│  AWS Secrets Manager                │  ← runtime secrets injection
└─────────────────────────────────────┘
```

---

## PKL (Preferred Configuration Language)

PKL provides type safety, validation, and composability for service configuration.

### File Layout

```text
pkl/
├── PklProject           # Exportable main definition for core configurations and classes
└── <resource>.pkl       # resource schema definitions by resource (Postgres, Redis, DynamoTable, Service, etc)
```

### Usage Pattern

Each service should contain a main configuration file and per stage different configurations

#### Project structure

```text
config/
├── PklProject # Service config project definition to import global resources
├── local.pkl  # Local stage configuration (local docker compose or stand alone running depending of project type)
├── dev.pkl    # Dev deployment stage
├── prod.pkl   # Prod deployment stage
└── main.pkl   # main entrypoint for configuration evaluation
```

#### Stage files structure

```pkl
module <service>.config.[local_|dev|prod]

// Imports for global configurations
// import "@config/postgres.pkl"

config {
  // structured configuration using imported resources or stand alone variables for specific service config
}
```

#### Main file configuration

```pkl
module <service>.config

import "local.pkl" as local_
import "dev.pkl"
import "prod.pkl"

local stage = read?("env:STAGE") ?? "local"

output {
  when (stage == "local") {
    value = local_.config
  }
  when (stage == "dev") {
    value = dev.config
  }
  when (stage == "prod") {
    value = prod.config
  }
}
```

#### Evaluation

```bash
pkl eval -f [toml|json|yaml|properties] --project-dir <path-to-service-config-folder>/main.pkl -o <path-to-service-config-folder>/.app-config.[toml|json|yaml|properties]
```

See: [PKL Configuration Reference](./pkl-configuration.md) | [PKL Usage Guide](../guides/pkl-usage.md)

---

## ejson (Secret Encryption)

ejson encrypts secrets at rest using public-key cryptography. Encrypted files are safe to commit.

### Secrets File Layout

```text
secrets/
└── <stage>.ejson
```

### Format

```json
{
  "_public_key": "abc123...",
  "DATABASE_PASSWORD": "EJ[1:encrypted...]",
  "API_KEY": "EJ[1:encrypted...]"
}
```

### Workflow

```bash
ejson keygen                             # Generate keypair
ejson encrypt secrets/dev.ejson          # Encrypt after editing
ejson decrypt secrets/dev.ejson          # Decrypt for local use
```

Decrypted secrets are injected as environment variables at Lambda cold start via AWS Secrets Manager or directly by the Serverless Framework deploy step.

Also secrets could be injected at build time as env vars as Dockerfile stage

See: [Secrets Management Guide](../guides/secrets-management.md)

---

## Environment Variables

Non-sensitive Configurations that are not necessary resource or service configurations and can be configured at service level or lambda level

```yaml
# lambda-config.yml
environment:
  TABLE_NAME: { Ref: MyDynamoTable }
  QUEUE_URL: { "Fn::GetAtt": [MyQueue, QueueUrl] }
  LOG_LEVEL: ${self:custom.logLevel}
  REGION: ${aws:region}
```

**Rule:** Environment variables reference infrastructure outputs — never hardcode ARNs or URLs. For most of the non sensitive data prefer using PKL configuration per stage

---

## Cross-References

→ [PKL Configuration](./pkl-configuration.md) | [Secrets Management](../guides/secrets-management.md) | [Deployment](../guides/deployment.md)
