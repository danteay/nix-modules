# Document Databases (MongoDB)

> MongoDB best practices, when to use it, AWS options, and design patterns.

---

## When to Use

- **Flexible, evolving schema** — attributes vary per record, schema changes frequently
- **Nested / hierarchical data** — documents with embedded arrays and sub-documents that are always retrieved together
- **JSON-native workloads** — the data model maps directly to your application's objects
- **Content management** — articles, product catalogs, user profiles with varying attributes
- **Rapid prototyping** — schema can evolve without migrations
- **Moderate read-write throughput** — not write-extreme like Cassandra, not ACID-critical like Postgres
- **Geospatial queries** — 2dsphere indexes for location-based search

## When NOT to Use

- **ACID transactions across many documents** — MongoDB supports multi-document transactions but with overhead; use PostgreSQL
- **Highly relational data** — heavy `$lookup` (JOIN equivalent) across many collections is slow; use PostgreSQL
- **Full-text search** — MongoDB has basic text search; use Elasticsearch for serious search requirements
- **Massive write throughput** — Cassandra handles write-heavy workloads better
- **Analytics and aggregations at BI scale** — use a data warehouse (Redshift, BigQuery)
- **When DynamoDB is available** — for AWS serverless, DynamoDB is preferred over MongoDB due to tighter integration and lower ops overhead

---

## AWS Options

| Option | Use When |
|--------|----------|
| **MongoDB Atlas (cross-cloud)** | Preferred for MongoDB; managed service, excellent tooling, works on AWS |
| **Amazon DocumentDB** | Need an AWS-native managed MongoDB-compatible service; note: not 100% MongoDB compatible |
| **DocumentDB Elastic Clusters** | Variable workloads, horizontal scaling without sharding management |

> **Note:** DocumentDB has partial MongoDB compatibility (up to 5.0 API). Always verify driver compatibility before migrating from MongoDB to DocumentDB.

---

## Best Practices

### Document Design

**Embed when:**

- Data is always accessed together with the parent
- The sub-document array is bounded in size (e.g., order items in an order)
- No independent lifecycle from the parent

**Reference when:**

- The sub-document has its own lifecycle (e.g., user → orders)
- The array is unbounded or can grow very large
- The sub-document is shared across multiple parents

```javascript
// Good — embed order items (always fetched with the order, bounded size)
{
  _id: ObjectId("..."),
  customerId: "usr_01HX",
  status: "placed",
  items: [
    { sku: "SKU-001", quantity: 2, priceCents: 1999 },
    { sku: "SKU-002", quantity: 1, priceCents: 4999 }
  ],
  totalCents: 8997,
  createdAt: ISODate("2024-01-15T10:30:00Z")
}

// Good — reference orders from user (unbounded, independent lifecycle)
{
  _id: ObjectId("..."),
  email: "user@example.com",
  name: "Alice",
  // Do NOT embed orders here — they grow unboundedly
}
```

### Schema Validation

Enforce schema at the database level using JSON Schema validation:

```javascript
db.createCollection("orders", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["customerId", "status", "items", "totalCents", "createdAt"],
      properties: {
        customerId: { bsonType: "string" },
        status: {
          bsonType: "string",
          enum: ["pending", "placed", "shipped", "cancelled"]
        },
        items: {
          bsonType: "array",
          minItems: 1,
          items: {
            bsonType: "object",
            required: ["sku", "quantity", "priceCents"],
            properties: {
              sku: { bsonType: "string" },
              quantity: { bsonType: "int", minimum: 1 },
              priceCents: { bsonType: "int", minimum: 0 }
            }
          }
        },
        totalCents: { bsonType: "int", minimum: 0 }
      }
    }
  },
  validationAction: "error"
})
```

### Indexing

```javascript
// Single field index
db.orders.createIndex({ customerId: 1 })

// Compound index — field order matters; matches left-prefix
db.orders.createIndex({ customerId: 1, createdAt: -1 })

// Partial index — only index documents matching a condition
db.orders.createIndex(
  { createdAt: 1 },
  { partialFilterExpression: { status: "pending" } }
)

// TTL index — auto-expire documents
db.sessions.createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 })

// Check index usage
db.orders.aggregate([{ $indexStats: {} }])
```

Rules:

- Every query field used in `find()` filters or sort should be indexed
- Compound index order: equality fields first, range fields last, sort fields last
- Avoid `$regex` without anchoring (`^`) — triggers collection scan
- Check with `explain("executionStats")` before deploying new queries

### Queries

```javascript
// Always project — never return full documents when you need a subset
db.orders.find(
  { customerId: "usr_01HX", status: "placed" },
  { orderId: 1, totalCents: 1, createdAt: 1 }  // projection
)

// Cursor-based pagination
db.orders.find({
  customerId: "usr_01HX",
  createdAt: { $lt: lastCursorDate }
}).sort({ createdAt: -1 }).limit(20)

// Upsert
db.orders.updateOne(
  { _id: orderId },
  { $set: { status: "shipped", shippedAt: new Date() } },
  { upsert: false }
)
```

### Transactions (Multi-Document)

```javascript
const session = client.startSession()
try {
  session.startTransaction()
  await orders.insertOne({ ...order }, { session })
  await inventory.updateOne(
    { sku: "SKU-001" },
    { $inc: { quantity: -1 } },
    { session }
  )
  await session.commitTransaction()
} catch (err) {
  await session.abortTransaction()
  throw err
} finally {
  await session.endSession()
}
```

> Use sparingly — multi-document transactions have significant performance overhead.

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| Unbounded embedded arrays | Document grows without limit; 16 MB BSON limit | Reference instead of embed |
| No schema validation | Data inconsistency drifts over time | Add `$jsonSchema` validator |
| Using `_id` as a string UUID | Loses ObjectId ordering and index efficiency | Use ObjectId or ULID |
| Heavy `$lookup` joins | Slow; MongoDB is not relational | Redesign as embedded or use Postgres |
| `find({})` without projection | Returns entire documents on every call | Always project needed fields |
| No index on query fields | Collection scans degrade as data grows | Index every queried field |

---

## Cross-References

→ [Database Index](./00_index.md) | [DynamoDB](./dynamodb.md) | [Relational](./relational.md) | [Architecture Overview](../../reference/architecture-overview.md)
