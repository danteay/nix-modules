# Architecture Index

> High-level architectural references and decision records.

---

## Contents

| File / Folder | Description |
|---------------|-------------|
| [General Architecture](./general.md) | Service architecture overview, layer responsibilities, cross-cutting concerns |
| [Databases](./databases/00_index.md) | Database selection guide, decision table, and per-database best practices |

---

## Database Guides

| Database | Type | File |
|----------|------|------|
| PostgreSQL | Relational | [databases/relational.md](./databases/relational.md) |
| MongoDB | Document | [databases/document.md](./databases/document.md) |
| DynamoDB | Key-Value + Document (AWS) | [databases/dynamodb.md](./databases/dynamodb.md) |
| Cassandra | Wide-Column | [databases/columnar.md](./databases/columnar.md) |
| Redis | Key-Value + Cache | [databases/key-value.md](./databases/key-value.md) |
| Elasticsearch / OpenSearch | Search Engine | [databases/search.md](./databases/search.md) |
| Neo4j / Neptune | Graph | [databases/graph.md](./databases/graph.md) |
| InfluxDB / TimescaleDB / Prometheus | Time Series | [databases/time-series.md](./databases/time-series.md) |

---

## Cross-References

→ [Documentation Index](../00_index.md) | [Architecture Patterns](../patterns/general/architecture.md) | [Reference — Architecture Overview](../reference/architecture-overview.md)
