# Search Engines (Elasticsearch / OpenSearch)

> Elasticsearch/OpenSearch best practices, when to use it, index design, AWS options, and anti-patterns.

---

## When to Use

- **Full-text search** — keyword search with relevance ranking, stemming, synonyms
- **Autocomplete / typeahead** — prefix completion on large datasets
- **Faceted search** — filter by multiple attributes (category, price range, rating) simultaneously
- **Log and event analytics** — structured log ingestion, aggregation, anomaly detection (ELK/OpenSearch stack)
- **Product catalog search** — multi-field search with boosting and filtering
- **Geo-distance search** — "find stores within 5km"
- **Time-range aggregations** — "error rate by hour for the last 7 days"

## When NOT to Use

- **Primary transactional store** — Elasticsearch is not ACID; data can be inconsistent under load
- **Simple key-value lookups** — use DynamoDB or Redis; Elasticsearch overhead is not worth it
- **Source of truth** — Elasticsearch is a search index derived from a primary database; populate it via events/sync
- **Strict consistency requirements** — indexing is near-real-time (typically < 1s lag); not suitable for immediately consistent reads
- **Simple filtering on structured data** — DynamoDB GSIs or PostgreSQL WHERE clauses are cheaper and simpler

---

## AWS Options

| Option | Use When |
|--------|----------|
| **Amazon OpenSearch Service** | Managed OpenSearch (Elasticsearch fork); production log analytics, search |
| **OpenSearch Serverless** | Unpredictable workloads, dev/test, or when you want zero capacity management |
| **Self-managed Elasticsearch** | Need specific Elasticsearch features or version not in OpenSearch; full control |
| **CloudWatch Logs Insights** | Simple log search within AWS — no ES cluster needed for basic log querying |

> **Elasticsearch vs OpenSearch:** OpenSearch is AWS's open-source fork of Elasticsearch (post-7.10). For AWS workloads, use OpenSearch Service unless you specifically need Elastic-licensed features (ML, SIEM).

---

## Core Concepts

### Index Design

An **index** is a collection of documents with a mapping (schema).

```json
// Create an index with explicit mapping
PUT /products
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1,
    "analysis": {
      "analyzer": {
        "autocomplete_analyzer": {
          "type": "custom",
          "tokenizer": "edge_ngram_tokenizer",
          "filter": ["lowercase"]
        }
      },
      "tokenizer": {
        "edge_ngram_tokenizer": {
          "type": "edge_ngram",
          "min_gram": 2,
          "max_gram": 20
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "name":        { "type": "text", "analyzer": "standard", "fields": { "keyword": { "type": "keyword" } } },
      "description": { "type": "text" },
      "price":       { "type": "scaled_float", "scaling_factor": 100 },
      "category":    { "type": "keyword" },
      "tags":        { "type": "keyword" },
      "location":    { "type": "geo_point" },
      "createdAt":   { "type": "date" },
      "nameAutocomplete": { "type": "text", "analyzer": "autocomplete_analyzer" }
    }
  }
}
```

### Shard Planning

```text
Optimal shard size: 10-50 GB per shard
Formula: total_data_size / target_shard_size = number_of_primary_shards

Example:
  500 GB of product data / 25 GB per shard = 20 primary shards
  Replicas: 1 (total = 40 shards)
```

Rules:

- Too many small shards = overhead; too few large shards = recovery time
- For log/time-series data use **Index Lifecycle Management (ILM)** with index rollover
- Never change the number of primary shards after index creation — reindex required

---

## Best Practices

### Searching

```json
// Full-text + filter + boost
POST /products/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "name": { "query": "wireless headphones", "boost": 2 } } }
      ],
      "should": [
        { "match": { "description": "noise cancelling" } }
      ],
      "filter": [
        { "term": { "category": "electronics" } },
        { "range": { "price": { "gte": 50, "lte": 300 } } },
        { "term": { "in_stock": true } }
      ]
    }
  },
  "sort": [
    { "_score": "desc" },
    { "rating": "desc" }
  ],
  "from": 0,
  "size": 20,
  "_source": ["id", "name", "price", "category"]  // project only needed fields
}
```

### Autocomplete

```json
POST /products/_search
{
  "query": {
    "match": {
      "nameAutocomplete": {
        "query": "wirel",
        "operator": "and"
      }
    }
  }
}
```

### Aggregations (Facets)

```json
POST /products/_search
{
  "query": { "match": { "name": "headphones" } },
  "aggs": {
    "by_category": {
      "terms": { "field": "category", "size": 20 }
    },
    "price_ranges": {
      "range": {
        "field": "price",
        "ranges": [
          { "to": 50 },
          { "from": 50, "to": 200 },
          { "from": 200 }
        ]
      }
    }
  },
  "size": 0  // aggregation only, no hits
}
```

### Index Sync Strategy

Never write directly to Elasticsearch as primary storage. Always sync from a primary database:

```text
Primary DB (Postgres/DynamoDB)
    │
    ├── DynamoDB Streams / Postgres WAL
    │
    └── Lambda / Worker
           │
           └── Elasticsearch/OpenSearch index
```

For DynamoDB → OpenSearch sync:

```yaml
functions:
  sync-to-opensearch:
    events:
      - stream:
          type: dynamodb
          arn: { "Fn::GetAtt": [OrdersTable, StreamArn] }
          filterPatterns:
            - eventName: [INSERT, MODIFY]
```

### Index Lifecycle Management (ILM) for Logs

```json
PUT /_ilm/policy/logs_policy
{
  "policy": {
    "phases": {
      "hot":    { "actions": { "rollover": { "max_size": "50gb", "max_age": "7d" } } },
      "warm":   { "min_age": "7d",  "actions": { "forcemerge": { "max_num_segments": 1 } } },
      "cold":   { "min_age": "30d", "actions": { "freeze": {} } },
      "delete": { "min_age": "90d", "actions": { "delete": {} } }
    }
  }
}
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| Using Elasticsearch as primary database | No ACID; data loss risk | Use as secondary index; primary in Postgres/DynamoDB |
| Dynamic mapping (no explicit mapping) | Types are inferred; causes mapping explosions, wrong field types | Always define explicit mappings |
| Too many fields ("mapping explosion") | Heap pressure, slow indexing | Flatten or use `flattened` type for dynamic keys |
| Deep pagination with `from`/`size` | O(from+size) memory; > 10000 hits causes errors | Use `search_after` for deep pagination |
| Updating documents in hot path | Elasticsearch update = delete + reindex; expensive | Batch updates or use DynamoDB as primary |
| No ILM on log indexes | Disk fills up silently | ILM with rollover + delete policy |

---

## Cross-References

→ [Database Index](./00_index.md) | [Key-Value & Cache](./key-value.md) | [Messaging Patterns](../../patterns/general/messaging.md) | [Architecture Overview](../../reference/architecture-overview.md)
