# Time Series Databases

> InfluxDB, TimescaleDB, Prometheus, VictoriaMetrics — best practices, when to use each, and AWS options.

---

## When to Use Time Series Databases

- **Metrics and monitoring** — CPU, memory, request rates, error counts over time
- **IoT sensor data** — temperature, pressure, GPS coordinates with timestamps
- **Financial tick data** — stock prices, trade events, order book updates
- **Application performance monitoring (APM)** — latency percentiles, throughput over time
- **Infrastructure telemetry** — pod resource usage, network traffic
- **Event counts and rates** — page views per minute, signups per hour

## When NOT to Use

- **Operational / transactional data** — orders, users, payments belong in PostgreSQL or DynamoDB
- **Arbitrary query patterns** — time series DBs are optimized for time-range queries; ad-hoc filtering is limited
- **Long-term relational joins** — joining time series data with entity data is expensive; keep them separate

---

## Options Overview

| Database | Best For | Query Language | AWS Option |
|----------|----------|---------------|------------|
| **InfluxDB** | High-cardinality metrics, IoT, app monitoring | InfluxQL / Flux | Self-managed on EC2 / InfluxDB Cloud |
| **TimescaleDB** | SQL on time-series, financial data, need JOINs with relational data | SQL (PostgreSQL extension) | Self-managed on EC2 or RDS-compatible |
| **Prometheus** | Infrastructure and application metrics, Kubernetes monitoring | PromQL | Self-managed or Amazon Managed Prometheus (AMP) |
| **VictoriaMetrics** | High-throughput Prometheus-compatible replacement, lower resource usage | MetricsQL (PromQL-compatible) | Self-managed on EC2 |
| **Amazon Timestream** | AWS-native, serverless time series, IoT/telemetry | SQL-like (Timestream SQL) | Fully managed, serverless |
| **OpenSearch + metrics** | Log + metric correlation in same store | OpenSearch DSL | Amazon OpenSearch Serverless |

---

## AWS Options

| Option | Use When |
|--------|----------|
| **Amazon Timestream** | AWS-native serverless time series; IoT, telemetry; no ops overhead; integrates with IoT Core, Kinesis, Lambda |
| **Amazon Managed Service for Prometheus (AMP)** | Kubernetes monitoring; Prometheus-compatible; no Prometheus cluster management |
| **Amazon Managed Grafana** | Visualization layer for AMP, CloudWatch, Timestream, OpenSearch |
| **CloudWatch Metrics** | AWS-native metrics for your own services; simple counters/gauges without a separate DB |
| **Self-managed InfluxDB/VictoriaMetrics on EC2** | When you need full control, specific retention policies, or higher cardinality than managed options support |

> **Recommendation for AWS serverless workloads:** Timestream for IoT/telemetry + AMP + Managed Grafana for infrastructure monitoring.

---

## InfluxDB

### When to Choose

- High write throughput with high cardinality (many unique tag combinations)
- Native time-series queries with downsampling and retention policies
- IoT and APM use cases where InfluxDB's data model fits naturally

### Data Model

```
Measurement: requests
Tags (indexed, strings):   service="order-api", region="us-east-1", status_code="200"
Fields (values):           duration_ms=45.2, count=1
Timestamp:                 2024-01-15T10:30:00.000Z
```

```flux
// Flux query — average latency per service over the last hour
from(bucket: "metrics")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "requests")
  |> filter(fn: (r) => r._field == "duration_ms")
  |> group(columns: ["service"])
  |> mean()
  |> yield(name: "avg_latency")
```

### Best Practices

- **Tags for dimensions** (service, region, status) — indexed, used in WHERE
- **Fields for measurements** (latency, count, bytes) — not indexed, used in SELECT
- Keep **tag cardinality low** — avoid user IDs, request IDs as tags (causes cardinality explosion)
- Use **retention policies** to auto-expire old data (e.g., raw: 7 days, 1m downsample: 90 days)
- **Batch writes** — write points in batches of 1000–5000, not individually

---

## TimescaleDB

### When to Choose

- Need full **SQL** (JOINs, CTEs, window functions) on time-series data
- Want to **JOIN** time-series with relational data (e.g., metrics joined with user table)
- Financial data that requires strict ACID guarantees
- Team already knows PostgreSQL

### Setup

```sql
-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Create a hypertable (auto-partitioned by time)
CREATE TABLE sensor_data (
    time        TIMESTAMPTZ NOT NULL,
    sensor_id   TEXT NOT NULL,
    metric      TEXT NOT NULL,
    value       DOUBLE PRECISION NOT NULL
);

SELECT create_hypertable('sensor_data', 'time', chunk_time_interval => INTERVAL '1 day');

-- Create composite index for common query pattern
CREATE INDEX ON sensor_data (sensor_id, time DESC);
```

### Queries

```sql
-- Average per hour with time_bucket
SELECT
    time_bucket('1 hour', time) AS bucket,
    sensor_id,
    AVG(value) AS avg_value,
    MAX(value) AS max_value
FROM sensor_data
WHERE time > NOW() - INTERVAL '7 days'
  AND metric = 'temperature'
GROUP BY bucket, sensor_id
ORDER BY bucket DESC;

-- Continuous aggregate (materialized rollup — pre-computed for fast queries)
CREATE MATERIALIZED VIEW sensor_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    sensor_id,
    AVG(value) AS avg_value
FROM sensor_data
GROUP BY bucket, sensor_id;

-- Add retention policy
SELECT add_retention_policy('sensor_data', INTERVAL '90 days');
```

---

## Prometheus / VictoriaMetrics

### When to Choose

- **Prometheus:** Kubernetes-native monitoring, service discovery, Grafana integration
- **VictoriaMetrics:** Drop-in Prometheus replacement with lower memory/CPU, better high-cardinality handling, long-term storage

### Data Model

```
# Prometheus metric format
http_requests_total{service="order-api", method="POST", status="200"} 1234 1705312200000
http_request_duration_seconds{service="order-api", quantile="0.99"} 0.045
```

### PromQL Examples

```promql
# Request rate over last 5 minutes
rate(http_requests_total{service="order-api"}[5m])

# 99th percentile latency
histogram_quantile(0.99,
  rate(http_request_duration_seconds_bucket{service="order-api"}[5m])
)

# Error rate
sum(rate(http_requests_total{status=~"5.."}[5m]))
  / sum(rate(http_requests_total[5m]))
```

### Best Practices

- Use **recording rules** to pre-compute expensive queries
- Keep label cardinality low — never use request IDs, user IDs as labels
- Set `--storage.tsdb.retention.time` (Prometheus) or `--retentionPeriod` (VictoriaMetrics)
- For long-term storage: Thanos (Prometheus) or VictoriaMetrics cluster + S3

---

## Amazon Timestream

### When to Choose

- AWS-native, fully serverless (no cluster management)
- IoT Core → Kinesis → Timestream pipelines
- Scales automatically; separate billing for writes, queries, and storage

### Setup and Query

```sql
-- Timestream uses two storage tiers automatically
-- Memory store: recent data (hours to days, configurable)
-- Magnetic store: older data (months to years)

CREATE DATABASE iot_data;
CREATE TABLE sensor_readings (
    memory_store_retention_period_in_hours = 24,
    magnetic_store_retention_period_in_days = 365
);

-- Query (SQL-like)
SELECT
    bin(time, 1h) AS hour,
    sensor_id,
    AVG(measure_value::double) AS avg_temp
FROM iot_data.sensor_readings
WHERE measure_name = 'temperature'
  AND time BETWEEN ago(7d) AND now()
GROUP BY bin(time, 1h), sensor_id
ORDER BY hour DESC
```

---

## General Best Practices

| Practice | Why |
|----------|-----|
| **Partition/shard by time** | Queries always have time ranges; localize I/O to recent chunks |
| **Downsample and retain** | Keep raw data for short periods; aggregate for long-term (1m → 1h → 1d) |
| **Batch writes** | Sending individual points is expensive; batch 1000–5000 points per write |
| **Keep cardinality low** | High cardinality (unique label combinations) kills indexing performance |
| **Use approximate functions** | `approx_percentile`, histograms — exact percentiles require sorting all data |
| **Separate hot and cold storage** | Recent data on fast storage; old data on S3/object storage |

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| Using user IDs / request IDs as tags/labels | Cardinality explosion → memory/index pressure | Use counters; store IDs in fields or separate DB |
| Querying raw data for dashboards | Expensive; slow at scale | Use pre-aggregated rollups or continuous aggregates |
| Writing points one-by-one | Throughput ceiling; TCP overhead | Batch writes (1000+ points per request) |
| No retention policy | Disk fills indefinitely | Set retention on all measurements/tables |
| Mixing time-series with relational data | Wrong access patterns, poor performance | Keep time-series DB separate from OLTP DB |

---

## Cross-References

→ [Database Index](./00_index.md) | [Key-Value & Cache](./key-value.md) | [Columnar](./columnar.md) | [Architecture Overview](../../reference/architecture-overview.md)
