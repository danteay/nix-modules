# Database Architecture

> Selection guide, best practices, and decision criteria for all database types.

---

## Database Types Covered

| File | Type | Primary Use |
|------|------|-------------|
| [Relational](./relational.md) | Relational (PostgreSQL) | Structured data, ACID transactions, complex queries |
| [Document](./document.md) | Document (MongoDB) | Flexible schemas, nested documents, JSON-native |
| [DynamoDB](./dynamodb.md) | Key-Value + Document (AWS) | Serverless, massive scale, single-table design |
| [Columnar](./columnar.md) | Wide-column (Cassandra) | Time-ordered writes, massive scale, high availability |
| [Key-Value & Cache](./key-value.md) | Key-Value (Redis / Valkey) | Caching, sessions, pub/sub, rate limiting |
| [Search](./search.md) | Search Engine (Elasticsearch) | Full-text search, log analytics, faceted search |
| [Graph](./graph.md) | Graph (Neo4j) | Relationships, recommendations, fraud detection |
| [Time Series](./time-series.md) | Time Series (InfluxDB, TimescaleDB, etc.) | Metrics, IoT, monitoring, financial data |

---

## Decision Table

Use the following criteria to select the right database for your use case.

### Primary Selection Guide

| If you need… | Use |
|-------------|-----|
| ACID transactions across multiple entities | [PostgreSQL](./relational.md) |
| Relational data with complex joins and reporting | [PostgreSQL](./relational.md) |
| Flexible/evolving schema, nested documents, JSON | [MongoDB](./document.md) |
| AWS-native serverless, single-digit ms latency at any scale | [DynamoDB](./dynamodb.md) |
| Write-heavy workloads at massive scale (IoT, events, logs) with known partition keys | [Cassandra](./columnar.md) |
| Caching, session store, rate limiting, ephemeral data | [Redis](./key-value.md) |
| Full-text search, autocomplete, log aggregation, faceted filtering | [Elasticsearch](./search.md) |
| Highly connected data, shortest path, recommendations, fraud detection | [Neo4j](./graph.md) |
| Time-stamped metrics, IoT sensor data, financial tick data | [Time Series](./time-series.md) |

---

### Detailed Decision Matrix

| Criterion | PostgreSQL | MongoDB | DynamoDB | Cassandra | Redis | Elasticsearch | Neo4j | Time Series |
|-----------|-----------|---------|----------|-----------|-------|---------------|-------|-------------|
| **ACID transactions** | ✅ Full | ⚠️ Limited | ⚠️ Per-item only | ❌ Eventual | ✅ Single key | ❌ | ❌ | ❌ |
| **Schema flexibility** | ❌ Fixed | ✅ Flexible | ✅ Flexible | ⚠️ Column families | ✅ Any | ✅ Dynamic | ✅ Flexible | ⚠️ Time-keyed |
| **Complex joins** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ Traversal | ❌ |
| **Horizontal write scale** | ❌ | ✅ | ✅ | ✅ | ⚠️ Cluster | ⚠️ | ❌ | ✅ |
| **Full-text search** | ⚠️ Basic | ⚠️ Basic | ❌ | ❌ | ❌ | ✅ Best-in-class | ⚠️ | ❌ |
| **Low-latency reads** | ⚠️ | ⚠️ | ✅ | ✅ | ✅ Sub-ms | ⚠️ | ⚠️ | ✅ |
| **Time-range queries** | ✅ | ⚠️ | ⚠️ | ✅ | ❌ | ✅ | ❌ | ✅ Best-in-class |
| **Graph traversal** | ⚠️ Recursive CTE | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ Best-in-class | ❌ |
| **Serverless / managed** | ✅ Aurora | ✅ Atlas | ✅ Native | ✅ Keyspaces | ✅ ElastiCache | ✅ OpenSearch | ⚠️ AuraDB | ✅ Timestream |
| **Multi-region active-active** | ❌ Complex | ✅ | ✅ Global Tables | ✅ | ⚠️ | ✅ | ❌ | ⚠️ |
| **Operational complexity** | Medium | Medium | Low | High | Low | Medium | High | Medium |

---

### By Workload Pattern

| Workload | Recommended | Why |
|----------|-------------|-----|
| OLTP (transactional app) | PostgreSQL / DynamoDB | ACID / single-digit ms |
| OLAP (analytics, reporting) | PostgreSQL + read replicas or data warehouse | Complex aggregations |
| Content management | MongoDB / PostgreSQL | Flexible or structured content |
| User sessions / auth tokens | Redis | TTL, sub-ms, ephemeral |
| Product catalog | DynamoDB / MongoDB | Flexible attributes, high read throughput |
| Order / payment systems | PostgreSQL / DynamoDB | ACID or single-table patterns |
| Real-time leaderboard | Redis (Sorted Sets) | Atomic ranked updates |
| Log analytics | Elasticsearch / OpenSearch | Full-text, aggregations, Kibana |
| Recommendation engine | Neo4j | Graph traversal |
| Fraud detection | Neo4j | Relationship pattern matching |
| IoT sensor data | InfluxDB / Timestream | Time-series ingestion + aggregation |
| Financial tick data | TimescaleDB | SQL + time-series extensions |
| Event sourcing store | DynamoDB / PostgreSQL | Ordered writes, conditional updates |
| Search autocomplete | Elasticsearch / Redis | Full-text or sorted sets |

---

### AWS Service Mapping

| Database | Self-hosted | AWS Managed | AWS Serverless |
|----------|------------|-------------|----------------|
| PostgreSQL | EC2 + RDS | Aurora PostgreSQL | Aurora Serverless v2 |
| MongoDB | Atlas (preferred) | DocumentDB | DocumentDB Elastic |
| DynamoDB | ❌ (AWS only) | DynamoDB | DynamoDB on-demand |
| Cassandra | EC2 | Amazon Keyspaces | Keyspaces (serverless billing) |
| Redis | EC2 | ElastiCache for Redis | MemoryDB for Redis |
| Elasticsearch | EC2 | OpenSearch Service | OpenSearch Serverless |
| Neo4j | EC2 | ❌ | ❌ (use Neptune for graph) |
| InfluxDB/Timescale | EC2 | ❌ | Amazon Timestream |

---

## Universal Rules

1. **Never use a database as a message queue** — use SQS/SNS/Kafka instead
2. **Never store secrets in plaintext** — encrypt sensitive columns, use AWS Secrets Manager
3. **Always design for the access pattern** — not the data model
4. **Add a DLQ / retry pattern** at the application layer for database failures
5. **Connection pooling is mandatory** for all relational databases in serverless contexts
6. **Monitor slow queries** — enable slow query logs from day one
7. **Backup and restore must be tested** — not just enabled

---

## Cross-References

→ [Architecture Overview](../../reference/architecture-overview.md) | [Software Patterns](../../patterns/general/software.md) | [Messaging Patterns](../../patterns/general/messaging.md) | [Architecture Index](../00_index.md)
