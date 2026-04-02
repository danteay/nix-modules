# Relational Databases (PostgreSQL)

> PostgreSQL best practices, when to use it, AWS options, and anti-patterns.

---

## When to Use

- **Multi-entity ACID transactions** — money transfers, order placement, inventory reservation
- **Complex relational queries** — joins across 3+ tables, window functions, CTEs
- **Enforced referential integrity** — foreign keys, cascades
- **Rich reporting and analytics** — GROUP BY, aggregations, subqueries
- **Geospatial data** — PostGIS extension
- **Full-text search (basic)** — `tsvector`/`tsquery` for simple search requirements
- **Audit logs with joins** — when audit data needs to be queried relationally
- **Mature domain model** — schema is stable and well-understood

## When NOT to Use

- **Massive horizontal write throughput** — PostgreSQL scales reads well (read replicas), but writes are single-primary; use Cassandra or DynamoDB instead
- **Globally distributed active-active writes** — not designed for multi-region write conflicts
- **Schema changes at high velocity** — ALTER TABLE on large tables is painful; consider MongoDB
- **Binary blob storage** — store in S3, reference the key in Postgres
- **Event/message queue pattern** — polling a Postgres table as a queue creates lock contention; use SQS
- **Ephemeral / session data with TTL** — use Redis instead
- **Serverless Lambda at massive scale** — connection limits per RDS instance become a bottleneck without a connection pooler

---

## AWS Options

| Option | Use When |
|--------|----------|
| **Amazon RDS for PostgreSQL** | Standard managed Postgres; good for most OLTP workloads |
| **Amazon Aurora PostgreSQL** | Need higher throughput, faster failover (< 30s), or Aurora-specific features (parallel query) |
| **Aurora Serverless v2** | Variable/unpredictable load, dev/staging environments, or cost-sensitive workloads with idle periods |
| **RDS Proxy** | Serverless Lambda functions — pools and reuses connections to avoid exhausting RDS connection limits |

> **Recommendation:** Aurora PostgreSQL + RDS Proxy for production serverless workloads.

---

## Best Practices

### Schema Design

```sql
-- Use UUIDs (or ULID) for primary keys in distributed systems
CREATE TABLE orders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  status      TEXT NOT NULL CHECK (status IN ('pending', 'placed', 'shipped', 'cancelled')),
  total_cents BIGINT NOT NULL CHECK (total_cents >= 0),  -- store money as cents, never FLOAT
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Always index foreign keys
CREATE INDEX ON orders (customer_id);

-- Partial index for common filtered queries
CREATE INDEX ON orders (status) WHERE status NOT IN ('cancelled', 'shipped');
```

### Money

- Always store monetary values as **integer cents** (`BIGINT`), never `FLOAT` or `DECIMAL` for high-precision arithmetic
- Use `NUMERIC(19, 4)` only when decimal precision is truly needed (e.g., exchange rates)

### Timestamps

- Always use `TIMESTAMPTZ` (timestamp with time zone), never `TIMESTAMP` — stores UTC, displays in session timezone
- Always set `DEFAULT NOW()` and maintain `updated_at` via trigger or application layer

### Migrations

- One migration per change — never batch unrelated changes
- Always write a `down` migration
- Test rollback before merging
- Never drop columns in the same migration that removes code referencing them — two-phase deployment: deploy code first, migrate second

### Indexes

```sql
-- Covering index — avoids heap fetch for frequent queries
CREATE INDEX ON orders (customer_id, created_at DESC) INCLUDE (status, total_cents);

-- Check for unused indexes periodically
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0;
```

Rules:
- Index every column used in `WHERE`, `JOIN ON`, and `ORDER BY` on large tables
- Avoid over-indexing — each index slows down writes
- Use `EXPLAIN ANALYZE` before and after adding indexes

### Connection Pooling

Always use a connection pooler in production:

- **PgBouncer** (transaction mode) — for serverless/Lambda, reduces connection overhead
- **RDS Proxy** — AWS-managed PgBouncer, integrates with IAM auth and Secrets Manager

```
# Serverless config
Lambda → RDS Proxy (pooled) → Aurora PostgreSQL
```

### Transactions

```sql
-- Keep transactions short — long transactions hold locks
BEGIN;
  UPDATE orders SET status = 'placed' WHERE id = $1 AND status = 'pending';
  INSERT INTO order_events (order_id, event_type) VALUES ($1, 'OrderPlaced');
COMMIT;

-- Use advisory locks for distributed coordination
SELECT pg_advisory_xact_lock(hashtext('process-order-' || $1));
```

### Query Patterns

```sql
-- Cursor-based pagination (not OFFSET for large datasets)
SELECT * FROM orders
WHERE created_at < $last_cursor
ORDER BY created_at DESC
LIMIT 20;

-- Upsert pattern
INSERT INTO order_states (order_id, status, updated_at)
VALUES ($1, $2, NOW())
ON CONFLICT (order_id)
DO UPDATE SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at;
```

---

## Monitoring

Key metrics to watch:

- **Connection count** — alert when > 80% of `max_connections`
- **Replication lag** — alert when replica is > 30s behind primary
- **Long-running transactions** — alert on transactions > 30s
- **Deadlocks** — `pg_stat_activity` + `pg_locks`
- **Bloat** — run `VACUUM ANALYZE` regularly; monitor `pg_stat_user_tables`

```sql
-- Active long-running queries
SELECT pid, now() - query_start AS duration, query, state
FROM pg_stat_activity
WHERE state != 'idle' AND query_start < NOW() - INTERVAL '30 seconds'
ORDER BY duration DESC;
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| `SELECT *` in application code | Over-fetching, breaks on schema changes | Select only needed columns |
| Polling a table as a queue | Lock contention, N+1 queries | Use SQS/SNS |
| FLOAT for money | Rounding errors | BIGINT cents |
| OFFSET pagination | Full table scan for large offsets | Cursor-based pagination |
| Fat transactions (minutes long) | Lock escalation, replication lag | Break into smaller transactions |
| Storing JSON blobs exclusively | Defeats relational model | Use JSONB for flexible attrs only |
| No connection pooler in Lambda | Connection exhaustion | RDS Proxy or PgBouncer |

---

## Cross-References

→ [Database Index](./00_index.md) | [DynamoDB](./dynamodb.md) | [Software Patterns](../../patterns/general/software.md) | [Architecture Overview](../../reference/architecture-overview.md)
