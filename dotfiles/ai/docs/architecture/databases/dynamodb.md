# DynamoDB

> AWS-native key-value and document database. Best practices, single-table design, access patterns, and when not to use it.

---

## When to Use

- **AWS-native serverless workloads** — tight integration with Lambda, API Gateway, Streams
- **Predictable, single-digit millisecond latency at any scale** — from 1 to millions of RPS
- **Known, stable access patterns** — you can enumerate all queries upfront
- **Event sourcing stores** — ordered writes per partition key, conditional writes for optimistic locking
- **Session / user profile stores** — fast key-based lookup, flexible per-user attributes
- **Shopping carts, preferences, feature flags** — per-user, high-read, key-based
- **Leaderboards** — Sort Keys + DynamoDB Streams
- **Time-to-live (TTL) data** — automatic expiry of sessions, temp tokens, cache entries

## When NOT to Use

- **Complex queries with ad-hoc filtering** — DynamoDB can only query by PK + SK; no arbitrary WHERE clauses
- **ACID transactions across many items** — TransactWrite supports up to 100 items; for complex multi-table ACID, use PostgreSQL
- **Rich reporting or aggregations** — not designed for OLAP; export to Athena or Redshift for analytics
- **Full-text search** — send events to Elasticsearch/OpenSearch for search requirements
- **Many-to-many relationships with flexible traversal** — use Neo4j or PostgreSQL
- **Schema exploration / ad-hoc querying** — DynamoDB requires knowing your queries upfront

---

## AWS Options

| Option | Use When |
|--------|----------|
| **DynamoDB on-demand (pay-per-request)** | Variable or unpredictable traffic, new services, development |
| **DynamoDB provisioned + Auto Scaling** | Steady, predictable traffic with a cost-reduction goal |
| **DynamoDB Accelerator (DAX)** | Read-heavy workloads needing microsecond latency (caching layer) |
| **DynamoDB Global Tables** | Multi-region active-active replication (e.g., multi-region user data) |
| **DynamoDB Streams** | Event-driven triggers, change data capture, outbox pattern relay |

---

## Key Concepts

### Primary Key Types

```text
Partition Key (PK) only:         PK = "user#123"
Partition Key + Sort Key (SK):   PK = "user#123", SK = "order#2024-01-15#abc"
```

- **PK alone** — direct item lookups only
- **PK + SK** — enables range queries, begins_with, between on the SK

### Capacity Modes

- **On-demand** — no capacity planning, pay per request. Use for new services and unpredictable load.
- **Provisioned** — set read/write capacity units. Use when traffic is predictable and cost matters.
- **Auto Scaling** — provisioned mode with automatic scaling. Use for steady traffic with occasional spikes.

---

## Single-Table Design

Design a single table with all entity types, using composite keys to support multiple access patterns.

### Key Design Pattern

```text
Entity:       PK                    SK
──────────────────────────────────────────────────────
User          USER#<userId>         PROFILE
Order         USER#<userId>         ORDER#<timestamp>#<orderId>
OrderItem     ORDER#<orderId>       ITEM#<sku>
Product       PRODUCT#<productId>   METADATA
Category      CATEGORY#<catId>      PRODUCT#<productId>
```

### Access Pattern Examples

```text
Get user profile:           PK = USER#123, SK = PROFILE
Get all orders for user:    PK = USER#123, SK begins_with ORDER#
Get order:                  PK = USER#123, SK = ORDER#2024-01-15#abc
Get items in order:         PK = ORDER#abc, SK begins_with ITEM#
Get product:                PK = PRODUCT#xyz, SK = METADATA
```

### Global Secondary Index (GSI)

Use GSIs to support additional access patterns:

```text
GSI1:  GSI1PK = "ORDER#<orderId>",  GSI1SK = "STATUS#<status>"
→ Get order by ID (without knowing the user)
→ Get all orders with a specific status

GSI2:  GSI2PK = "STATUS#pending",   GSI2SK = "CREATED_AT#<timestamp>"
→ Get all pending orders sorted by creation time
```

Rules:

- Design GSIs for specific, frequent queries — not as a catch-all
- GSIs have eventual consistency by default
- Keep GSI projections minimal — only project attributes you query

---

## Best Practices

### Item Design

```json
{
  "PK": "USER#usr_01HX",
  "SK": "ORDER#2024-01-15T10:30:00Z#ord_01HX",
  "GSI1PK": "ORDER#ord_01HX",
  "GSI1SK": "STATUS#placed",
  "entityType": "ORDER",
  "orderId": "ord_01HX",
  "userId": "usr_01HX",
  "status": "placed",
  "totalCents": 4999,
  "createdAt": "2024-01-15T10:30:00Z",
  "ttl": 1735689600
}
```

Rules:

- Always include `entityType` — needed when deserializing items from single-table
- Use ISO 8601 strings for timestamps (sortable lexicographically as SK)
- Use `ttl` (Unix epoch seconds) for automatic expiry — DynamoDB deletes within 48h
- Use `ULID` or `KSUID` for IDs that sort chronologically

### Conditional Writes (Optimistic Locking)

```python
# Prevent overwriting an existing item
dynamodb.put_item(
    TableName="orders",
    Item={...},
    ConditionExpression="attribute_not_exists(PK)"
)

# Optimistic locking via version counter
dynamodb.update_item(
    TableName="orders",
    Key={"PK": pk, "SK": sk},
    UpdateExpression="SET #status = :new_status, version = version + :inc",
    ConditionExpression="version = :current_version",
    ExpressionAttributeValues={
        ":new_status": "shipped",
        ":current_version": 3,
        ":inc": 1,
    }
)
```

### Transactions

```python
# TransactWrite — atomic across up to 100 items
dynamodb.transact_write_items(Items=[
    {
        "Put": {
            "TableName": "orders",
            "Item": order_item,
            "ConditionExpression": "attribute_not_exists(PK)"
        }
    },
    {
        "Update": {
            "TableName": "orders",
            "Key": {"PK": "INVENTORY#SKU-1", "SK": "STOCK"},
            "UpdateExpression": "SET quantity = quantity - :qty",
            "ConditionExpression": "quantity >= :qty",
            "ExpressionAttributeValues": {":qty": {"N": "1"}}
        }
    }
])
```

### DynamoDB Streams + Lambda (Outbox Pattern)

```yaml
# serverless.yml
functions:
  relay-events:
    handler: cmd/relay/main.go
    events:
      - stream:
          type: dynamodb
          arn: { "Fn::GetAtt": [OrdersTable, StreamArn] }
          startingPosition: TRIM_HORIZON
          batchSize: 100
          bisectBatchOnFunctionError: true
          functionResponseType: ReportBatchItemFailures
          filterPatterns:
            - eventName: [INSERT]
              dynamodb:
                NewImage:
                  entityType:
                    S: [ORDER_EVENT]
```

---

## Capacity Planning

```text
Read Capacity Units (RCU):
  - 1 RCU = 1 strongly consistent read of ≤ 4 KB/s
  - 1 RCU = 2 eventually consistent reads of ≤ 4 KB/s

Write Capacity Units (WCU):
  - 1 WCU = 1 write of ≤ 1 KB/s

Estimate:
  100 RPS reads of 2 KB = 100 RCU (strongly consistent)
  50 RPS writes of 512 B = 50 WCU
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| Multi-table design (one table per entity) | Requires multiple round trips; loses single-table benefits | Single-table design |
| Using a UUID as SK without ordering | Can't range query; hot partitions | Include timestamp prefix in SK |
| `Scan` in production | Full table scan; expensive + slow | Always `Query` with PK |
| Storing large items (> 400 KB) | DynamoDB item size limit | Store payload in S3, reference key |
| No GSI for secondary access patterns | Can only query by PK + SK | Design GSIs upfront for all access patterns |
| Using DynamoDB as a job queue | Polling creates RCU waste | Use SQS for queuing |

---

## Cross-References

→ [Database Index](./00_index.md) | [Relational](./relational.md) | [Messaging Patterns](../../patterns/general/messaging.md) | [Software Patterns (Event Sourcing)](../../patterns/general/software.md)
