# Wide-Column Databases (Cassandra)

> Cassandra best practices, data modeling around access patterns, AWS options, and when not to use it.

---

## When to Use

- **Extremely high write throughput** — millions of writes/second; append-heavy workloads
- **Time-series-like data at massive scale** — IoT sensor data, activity feeds, audit logs where DynamoDB would be too expensive
- **Known partition key access patterns** — always query by a specific partition key
- **Multi-region active-active** — Cassandra is designed for no-single-master replication across regions
- **High availability with tunable consistency** — choose between eventual and stronger consistency per query
- **Write-heavy > read-heavy ratio** — Cassandra writes are cheap; reads are relatively more expensive

## When NOT to Use

- **Ad-hoc queries** — no secondary indexes beyond what you model; no WHERE on arbitrary columns
- **ACID transactions** — Cassandra uses eventual consistency by default; lightweight transactions (LWT) exist but are slow
- **Small to medium datasets** — operational overhead is not worth it; use DynamoDB or PostgreSQL
- **Complex aggregations or analytics** — not designed for GROUP BY or aggregate queries; use a data warehouse
- **Joins or relational queries** — no joins whatsoever; everything must be denormalized
- **When DynamoDB fits** — for AWS workloads, prefer DynamoDB for simpler ops unless you specifically need multi-region active-active with > DynamoDB's cost threshold

---

## AWS Options

| Option | Use When |
|--------|----------|
| **Amazon Keyspaces (for Apache Cassandra)** | Want managed Cassandra-compatible service with no cluster management; serverless billing; CQL compatibility |
| **Self-managed on EC2** | Need full Cassandra feature set not yet in Keyspaces (e.g., UDFs, advanced compaction strategies) |
| **ScyllaDB on EC2** | Need Cassandra-compatible API but with higher throughput and lower latency than standard Cassandra |

> **Keyspaces limitations:** Does not support all Cassandra features — verify CQL compatibility with your driver version.

---

## Core Concepts

### Data Modeling Principles

Cassandra is **query-driven**: design your tables around your queries, not your entities.

- One table per query pattern — denormalization is expected
- Partition key determines data distribution and which node is queried
- Clustering columns determine sort order within a partition
- No joins — replicate data across tables as needed

### Key Components

```
Primary Key = Partition Key + Clustering Columns

CREATE TABLE orders_by_customer (
    customer_id  UUID,       ← partition key — routes to correct node
    created_at   TIMESTAMP,  ← clustering column — sort order within partition
    order_id     UUID,       ← clustering column — uniqueness
    status       TEXT,
    total_cents  BIGINT,
    PRIMARY KEY ((customer_id), created_at, order_id)
) WITH CLUSTERING ORDER BY (created_at DESC, order_id ASC);
```

### Consistency Levels

| Level | Reads from | Suitable for |
|-------|-----------|--------------|
| `ONE` | 1 replica | Fastest; eventual consistency acceptable |
| `QUORUM` | Majority | Balanced; most production use cases |
| `ALL` | All replicas | Strongest; latency increases |
| `LOCAL_QUORUM` | Majority in local DC | Multi-region; avoids cross-DC latency |

Rule: for most production writes use `LOCAL_QUORUM`; for reads use `LOCAL_QUORUM` or `ONE`.

---

## Best Practices

### Table Design — Denormalize for Each Query

```cql
-- Query 1: Get all orders for a customer, newest first
CREATE TABLE orders_by_customer (
    customer_id  UUID,
    created_at   TIMESTAMP,
    order_id     UUID,
    status       TEXT,
    total_cents  BIGINT,
    PRIMARY KEY ((customer_id), created_at, order_id)
) WITH CLUSTERING ORDER BY (created_at DESC);

-- Query 2: Get orders by status for internal processing (different table!)
CREATE TABLE orders_by_status (
    status       TEXT,
    created_at   TIMESTAMP,
    order_id     UUID,
    customer_id  UUID,
    total_cents  BIGINT,
    PRIMARY KEY ((status), created_at, order_id)
) WITH CLUSTERING ORDER BY (created_at ASC);
-- Same data, different access pattern → different table
```

### Partition Size

- Keep partitions under **100 MB** — large partitions cause GC pressure and hot spots
- If a partition can grow unboundedly (e.g., all events for a customer ever), add a **time bucket** to the partition key:

```cql
-- Bucket by month to limit partition size
CREATE TABLE events_by_customer_month (
    customer_id  UUID,
    month_bucket TEXT,   -- "2024-01"
    event_time   TIMESTAMP,
    event_id     UUID,
    event_type   TEXT,
    payload      TEXT,
    PRIMARY KEY ((customer_id, month_bucket), event_time, event_id)
) WITH CLUSTERING ORDER BY (event_time DESC);
```

### Writes

```cql
-- Inserts are upserts in Cassandra — always succeeds (no unique constraint)
INSERT INTO orders_by_customer (customer_id, created_at, order_id, status, total_cents)
VALUES (uuid(), toTimestamp(now()), uuid(), 'placed', 4999)
USING TTL 7776000;  -- optional: auto-expire after 90 days

-- Lightweight transactions (conditional update — use sparingly, slow)
UPDATE orders_by_customer
SET status = 'shipped'
WHERE customer_id = ? AND created_at = ? AND order_id = ?
IF status = 'placed';
```

### Time-to-Live (TTL)

- Set TTL on rows that should auto-expire (logs, sessions, temp data)
- Apply at write time with `USING TTL <seconds>` or at table level with `default_time_to_live`

### Compaction Strategy

| Strategy | Use When |
|----------|----------|
| `SizeTieredCompactionStrategy` (STCS) | Write-heavy, infrequent reads (default) |
| `LeveledCompactionStrategy` (LCS) | Read-heavy; reduces read amplification |
| `TimeWindowCompactionStrategy` (TWCS) | Time-series data with TTL; groups SSTables by time window |

For time-series workloads: always use TWCS.

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| Allow partition to grow unboundedly | Hot partition, GC pauses, > 100 MB limit | Add time bucket to partition key |
| Using `ALLOW FILTERING` | Full partition scan; extremely slow | Redesign table for the query |
| Lightweight transactions (LWT) everywhere | 4x latency overhead, Paxos consensus | Reserve for critical idempotency checks only |
| One table for everything | Can't support multiple access patterns | One table per query pattern |
| `SELECT *` | Over-reads, includes tombstones | Project specific columns |
| Deleting via tombstones without TTL tuning | Tombstone accumulation causes read performance degradation | Set `gc_grace_seconds` appropriately, use TTL |

---

## Cross-References

→ [Database Index](./00_index.md) | [DynamoDB](./dynamodb.md) | [Time Series](./time-series.md) | [Messaging Patterns](../../patterns/general/messaging.md)
