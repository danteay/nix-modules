# Key-Value Stores & Caches (Redis / Valkey)

> Redis, Valkey, and caching best practices, data structures, AWS options, and when not to use them.

---

## Redis vs Valkey — What to Choose on AWS

In 2024, Redis changed its license to SSPL (non-OSI open source). In response, the Linux Foundation forked Redis 7.2 as **Valkey** — a fully open-source (BSD-licensed) drop-in replacement. AWS adopted Valkey as the engine for its managed services.

| | Redis (self-managed) | Valkey |
|-|---------------------|--------|
| License | SSPL (not fully open source) | BSD-3 (fully open source) |
| API compatibility | — | 100% compatible with Redis 7.2 |
| AWS managed offering | ElastiCache OSS Redis (legacy) | ElastiCache for Valkey, MemoryDB for Valkey |
| AWS recommendation | ⚠️ Legacy path | ✅ Recommended going forward |
| Performance | Baseline | Equal or slightly better (active development) |
| Client compatibility | Any Redis client | Same Redis clients work unchanged |

**Decision:** For new AWS workloads, use **Valkey** via ElastiCache or MemoryDB. Existing Redis workloads can migrate with no application code changes — just swap the engine in the AWS console.

---

## When to Use

- **Caching** — application-level cache, database query cache, API response cache
- **Session storage** — user sessions, auth tokens with TTL
- **Rate limiting** — sliding window counters, token buckets
- **Distributed locks** — Redlock for cross-service mutual exclusion
- **Pub/Sub** — lightweight ephemeral notifications between services
- **Real-time leaderboards** — Sorted Sets for ranked data with atomic updates
- **Job queues** — simple FIFO queues (for more complex needs, use SQS)
- **Bloom filters / HyperLogLog** — approximate cardinality, deduplication
- **Feature flags / configuration** — frequently read, rarely written config

## When NOT to Use

- **Primary data store** — in-memory; data can be lost on failure without proper persistence or MemoryDB
- **Large values** — max value size is 512 MB, but performance degrades significantly above a few MB
- **Complex queries** — no secondary indexes, no aggregations, no ad-hoc filtering
- **Durable, ACID storage** — not designed for it; use PostgreSQL or DynamoDB
- **Heavy fan-out pub/sub** — no persistence; if subscribers are down, messages are lost; use SNS/SQS

---

## AWS Options

| Option | Engine | Use When |
|--------|--------|----------|
| **ElastiCache for Valkey** | Valkey | ✅ Preferred cache/session store for new workloads; drop-in Redis replacement |
| **MemoryDB for Valkey** | Valkey | ✅ Preferred durable primary store; multi-AZ WAL; Redis API with persistence |
| **ElastiCache Serverless** | Valkey or Redis | Unpredictable or spiky cache workloads; zero capacity management |
| **ElastiCache for Redis** | Redis | Existing workloads not yet migrated to Valkey |
| **Self-managed Valkey on EC2** | Valkey | Need specific modules or full control |
| **Self-managed Redis on EC2** | Redis | Need Redis-specific licensed features (Redis Stack, RedisSearch) |

> **MemoryDB vs ElastiCache:** Use ElastiCache (Valkey) when data loss is acceptable (cache use case). Use MemoryDB (Valkey) when Valkey/Redis IS your primary data store and durability is required.

### Migrating Existing Redis to Valkey on AWS

1. No application code changes required — Valkey speaks the same protocol
2. In the AWS console: create a new ElastiCache/MemoryDB cluster with **Valkey** engine
3. Use online migration (ElastiCache migration tool) or blue-green deployment
4. Update the endpoint in your config/secrets — the rest is transparent

---

## Data Structures

All commands below work identically on Redis and Valkey.

### Strings (simple key-value)

```redis
SET session:usr_01HX "eyJhbGci..." EX 3600   -- with TTL in seconds
GET session:usr_01HX
DEL session:usr_01HX
INCR counter:page_views                         -- atomic increment
```

### Hashes (structured objects)

```redis
HSET user:usr_01HX name "Alice" email "alice@example.com" role "admin"
HGET user:usr_01HX name
HMGET user:usr_01HX name email
HDEL user:usr_01HX role
```

Use hashes for objects with multiple fields — more memory-efficient than one key per field.

### Lists (queues / stacks)

```redis
RPUSH jobs:email "job:001"    -- enqueue
LPOP  jobs:email              -- dequeue (FIFO)
BLPOP jobs:email 30           -- blocking pop (timeout 30s)
LLEN  jobs:email              -- queue depth
```

### Sets

```redis
SADD  tags:post:123 "elixir" "backend" "aws"
SMEMBERS tags:post:123
SISMEMBER tags:post:123 "elixir"   -- O(1) membership check
SINTER tags:post:123 tags:post:456  -- intersection
```

### Sorted Sets (leaderboards, rate limiting)

```redis
-- Leaderboard
ZADD  leaderboard:game:1 1500 "player:alice"
ZADD  leaderboard:game:1 2100 "player:bob"
ZREVRANGE leaderboard:game:1 0 9 WITHSCORES   -- top 10

-- Rate limiting: sliding window
ZADD  rate:usr_01HX <timestamp_ms> <request_id>
ZREMRANGEBYSCORE rate:usr_01HX 0 <window_start>
ZCARD rate:usr_01HX   -- current request count in window
```

---

## Best Practices

### Caching Strategies

| Strategy | How | Use When |
|----------|-----|----------|
| **Cache-Aside (Lazy)** | App checks cache → miss → load from DB → store in cache | Most common; app controls cache population |
| **Write-Through** | Write to DB → write to cache atomically | Read-heavy with frequent updates; cache always fresh |
| **Write-Behind (Write-Back)** | Write to cache → async write to DB | Extreme write throughput; risk of data loss |
| **Read-Through** | Cache fetches from DB on miss transparently | When cache client supports it |

Cache-Aside is the preferred default:

```python
def get_order(order_id: str) -> Order:
    key = f"order:{order_id}"
    cached = redis.get(key)       # works with both Redis and Valkey clients
    if cached:
        return Order.parse_raw(cached)

    order = db.find_order(order_id)
    redis.setex(key, 300, order.json())   # cache for 5 min
    return order
```

### TTL (Expiry) Rules

- **Always set TTL** on cached data — no TTL = memory leak
- Session data: TTL = session timeout (e.g., 1h, sliding)
- API responses: TTL = acceptable staleness (seconds to minutes)
- Rate limit windows: TTL = window size
- Feature flags: long TTL (1h) with explicit invalidation on change

### Key Naming Conventions

```
<entity>:<id>              →  user:usr_01HX
<scope>:<entity>:<id>      →  session:user:usr_01HX
<counter>:<scope>          →  rate:api:usr_01HX
<collection>:<id>          →  leaderboard:game:1
```

Rules:
- Use `:` as separator — cluster mode uses `{hash tag}` `{key}` for slot grouping
- Keep keys short — every key is stored in memory
- Never use spaces in keys

### Distributed Lock (Redlock)

```python
import redlock

# Works with both Redis and Valkey nodes
dlm = redlock.Redlock([{"host": "valkey-1"}, {"host": "valkey-2"}, {"host": "valkey-3"}])

lock = dlm.lock("resource:order:123", 5000)  # TTL = 5s
if lock:
    try:
        process_order("123")
    finally:
        dlm.unlock(lock)
else:
    raise LockNotAcquiredError("order 123 is being processed")
```

Rules:
- Always set a TTL on locks — prevents deadlock on crash
- Use Redlock (3+ nodes) for distributed lock correctness
- Keep critical sections short — lock TTL must exceed expected execution time

### Memory Management

```redis
CONFIG SET maxmemory 2gb
CONFIG SET maxmemory-policy allkeys-lru

# Policies (same for Redis and Valkey):
# allkeys-lru    — evict any key by LRU (cache use case)
# volatile-lru   — evict only keys with TTL by LRU
# allkeys-lfu    — evict by frequency (better for non-uniform access patterns)
# noeviction     — reject writes when full (not suitable for caches)
```

---

## Valkey-Specific Notes

- **Active development:** Valkey 8.x added I/O threading improvements over Redis 7.2 — better throughput on multi-core instances
- **Client compatibility:** all major Redis clients work with Valkey — `redis-py`, `ioredis`, `go-redis`, `Jedis`, `Lettuce` — no code changes needed
- **ElastiCache Serverless** supports Valkey as the default engine for new clusters (as of 2024)
- **MemoryDB for Valkey** reached GA in 2024 — recommended over MemoryDB for Redis for new workloads
- **Modules:** Valkey does not bundle Redis Stack modules (RediSearch, RedisJSON, RedisGraph); for those, use self-managed Redis Stack on EC2

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| No TTL on cached keys | Memory grows unboundedly | Always set `EX` or `EXPIRE` |
| Using as primary persistent store without MemoryDB | Data loss on failure | Use MemoryDB for Valkey (durable) |
| `KEYS *` in production | Blocks single-threaded command loop; O(N) | Use `SCAN` with cursor |
| Storing large objects (> 1 MB) | Memory pressure, slow network transfer | Compress or store reference, object in S3 |
| One giant key (e.g., all users in one hash) | Single point of contention; can't distribute | Partition by ID prefix or segment |
| Using pub/sub for critical events | No persistence; messages lost if subscriber down | Use SNS/SQS for reliable messaging |
| Staying on Redis when migrating to AWS managed | SSPL licensing concerns; fewer AWS optimizations | Migrate to ElastiCache/MemoryDB for Valkey |

---

## Cross-References

→ [Database Index](./00_index.md) | [Messaging Patterns](../../patterns/general/messaging.md) | [DynamoDB](./dynamodb.md) | [Architecture Overview](../../reference/architecture-overview.md)
