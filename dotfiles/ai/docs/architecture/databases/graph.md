# Graph Databases (Neo4j)

> Neo4j best practices, Cypher query patterns, AWS options, and when not to use it.

---

## When to Use

- **Highly connected data** — relationships are first-class citizens, not foreign keys
- **Recommendation engines** — "users who bought X also bought Y"; collaborative filtering
- **Fraud detection** — detect shared accounts, devices, or IPs across suspicious transactions
- **Social networks** — followers, friends-of-friends, influence paths
- **Knowledge graphs** — entities and typed relationships (ontologies, taxonomies)
- **Access control / RBAC** — role hierarchies, permission inheritance chains
- **Supply chain / logistics** — shortest path, bottleneck analysis
- **Identity resolution** — link entities across data sources via relationship patterns

## When NOT to Use

- **Simple relational data** — if you can model it in 2-3 tables, PostgreSQL is simpler and faster
- **High write throughput** — Neo4j is not optimized for millions of writes/second; use Cassandra or DynamoDB
- **Full-text search** — not its strength; use Elasticsearch
- **Analytics and aggregations** — graph databases are optimized for traversal, not aggregation at scale
- **Serverless / Lambda workloads** — connection management is complex; not a natural fit for stateless functions
- **When the domain has few relationships** — the complexity overhead isn't justified

---

## AWS Options

| Option | Use When |
|--------|----------|
| **Amazon Neptune** | AWS-native managed graph database; supports both **Gremlin** (TinkerPop) and **SPARQL** (RDF) — not Cypher; suitable when you want a managed service |
| **Neo4j AuraDB** | Managed Neo4j with full Cypher support; best if you're using Neo4j specifically and want hosted |
| **Self-managed Neo4j on EC2** | Full Neo4j feature set, Cypher, APOC library, GDS (Graph Data Science) |

> **Neptune vs Neo4j:** Neptune does NOT support Cypher — it uses Gremlin or SPARQL. If your team knows Cypher or you need GDS algorithms, use Neo4j/AuraDB. Use Neptune when you need a fully managed AWS service with no preference for Cypher.

---

## Core Concepts

### Data Model

```text
Nodes:         Entities      → (User), (Product), (Order)
Relationships: Connections   → [:PURCHASED], [:FOLLOWS], [:REVIEWED]
Properties:    Attributes    → {name: "Alice"}, {amount: 49.99}

Pattern: (alice:User)-[:PURCHASED {at: "2024-01-15"}]->(p:Product {sku: "SKU-001"})
```

### Cypher Basics

```cypher
// Create nodes and relationship
CREATE (alice:User {id: "usr_01", name: "Alice", email: "alice@example.com"})
CREATE (product:Product {id: "prod_01", name: "Wireless Headphones", category: "electronics"})
CREATE (alice)-[:PURCHASED {purchasedAt: datetime(), amount: 4999}]->(product)

// Match pattern
MATCH (u:User {id: "usr_01"})-[:PURCHASED]->(p:Product)
RETURN p.name, p.category

// Find friends-of-friends
MATCH (u:User {id: "usr_01"})-[:FOLLOWS]->(:User)-[:FOLLOWS]->(fof:User)
WHERE NOT (u)-[:FOLLOWS]->(fof) AND u <> fof
RETURN fof.name, count(*) AS mutual_connections
ORDER BY mutual_connections DESC
LIMIT 10
```

---

## Best Practices

### Schema and Constraints

```cypher
// Create uniqueness constraints (also creates index)
CREATE CONSTRAINT user_id_unique FOR (u:User) REQUIRE u.id IS UNIQUE;
CREATE CONSTRAINT product_id_unique FOR (p:Product) REQUIRE p.id IS UNIQUE;

// Create composite node key
CREATE CONSTRAINT order_key FOR (o:Order) REQUIRE (o.userId, o.orderId) IS NODE KEY;

// Create index for frequently queried property
CREATE INDEX user_email FOR (u:User) ON (u.email);
CREATE INDEX product_category FOR (p:Product) ON (p.category);
```

### Recommendation Pattern

```cypher
// "Users who bought what you bought also bought..."
MATCH (target:User {id: $userId})-[:PURCHASED]->(p:Product)<-[:PURCHASED]-(other:User)
MATCH (other)-[:PURCHASED]->(recommended:Product)
WHERE NOT (target)-[:PURCHASED]->(recommended)
RETURN recommended.id, recommended.name, count(other) AS score
ORDER BY score DESC
LIMIT 10
```

### Fraud Detection Pattern

```cypher
// Find accounts sharing devices or IPs
MATCH (u1:User)-[:USES]->(device:Device)<-[:USES]-(u2:User)
WHERE u1 <> u2
  AND u1.flagged = false
  AND u2.flagged = true
RETURN u1.id AS suspect_user, device.fingerprint AS shared_device, u2.id AS known_fraudster
LIMIT 100
```

### Shortest Path

```cypher
// Find shortest connection between two users
MATCH path = shortestPath(
  (a:User {id: $fromId})-[:FOLLOWS*..6]-(b:User {id: $toId})
)
RETURN [node in nodes(path) | node.name] AS connection_path,
       length(path) AS degrees_of_separation
```

### Batching Writes (UNWIND)

```cypher
// Efficient bulk import — avoid individual CREATE per transaction
UNWIND $users AS user
MERGE (u:User {id: user.id})
SET u.name = user.name, u.email = user.email, u.updatedAt = datetime()

// Bulk relationship creation
UNWIND $purchases AS p
MATCH (u:User {id: p.userId})
MATCH (prod:Product {id: p.productId})
MERGE (u)-[r:PURCHASED {orderId: p.orderId}]->(prod)
SET r.purchasedAt = datetime(p.purchasedAt), r.amount = p.amount
```

### Pagination

```cypher
// Cursor-based pagination on sorted results
MATCH (u:User {id: $userId})-[r:PURCHASED]->(p:Product)
WHERE r.purchasedAt < $cursor
RETURN p.id, p.name, r.purchasedAt
ORDER BY r.purchasedAt DESC
LIMIT 20
```

---

## Performance Rules

- Use `MERGE` (not `CREATE`) to avoid duplicate nodes — `MERGE` requires constraints to be efficient
- Always use parameters (`$param`) — prevents query plan cache misses
- Use `EXPLAIN` and `PROFILE` to analyze query plans
- Avoid unbounded traversals (`[:FOLLOWS*]`) — always set a max depth (`[:FOLLOWS*..6]`)
- Index all properties used in `MATCH` node predicates
- For large imports, use neo4j-admin import or APOC periodic iterate

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| `MATCH (n) RETURN n` (no label) | Full graph scan | Always specify node labels |
| Unbounded path traversal (`*`) | Exponential explosion | Set max depth (`*..6`) |
| `CREATE` without checking existence | Duplicate nodes | Use `MERGE` with constraints |
| String concatenation in Cypher | SQL injection equivalent; no plan caching | Always use parameters |
| Single "god node" (millions of relationships) | Hot node, slow traversal | Introduce intermediate nodes or buckets |
| Modeling everything as a graph | Overhead for simple lookups | Use graph only for relationship-traversal problems |

---

## Cross-References

→ [Database Index](./00_index.md) | [Relational](./relational.md) | [Search](./search.md) | [Architecture Overview](../../reference/architecture-overview.md)
