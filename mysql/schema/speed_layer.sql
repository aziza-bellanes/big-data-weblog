-- Serving tables of the speed layer: Spark Structured Streaming (scripts/spark_speed_layer.py)
-- reads Kafka "web-events" and, after every micro-batch, writes its figures to HDFS (Parquet,
-- the record) and here, in one transaction, for the dashboard. Safe to apply again.
--
-- Exactly once: a micro-batch whose batch_id is already in speed_batches was applied
-- before a crash; Spark replays it with the same id and it is skipped.
-- Minutes are server-local event time ('1995-07-13 10:42'), like the Hive analysis.

CREATE TABLE IF NOT EXISTS speed_batches (
    batch_id     BIGINT      NOT NULL PRIMARY KEY,
    events       BIGINT      NOT NULL,            -- Kafka records in the micro-batch
    parsed       BIGINT      NOT NULL,            -- of which well-formed log lines
    first_minute CHAR(16),                         -- event-time range covered
    last_minute  CHAR(16),
    processed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS speed_minute (
    minute        CHAR(16) NOT NULL PRIMARY KEY,
    day           DATE     NOT NULL,
    hits          BIGINT   NOT NULL,
    client_errors BIGINT   NOT NULL,
    not_found     BIGINT   NOT NULL,
    server_errors BIGINT   NOT NULL,
    bytes         BIGINT   NOT NULL,
    KEY (day)
);

CREATE TABLE IF NOT EXISTS speed_host_minute (
    minute CHAR(16)     NOT NULL,
    host   VARCHAR(255) NOT NULL,
    hits   BIGINT       NOT NULL,
    PRIMARY KEY (minute, host)
);

-- kind: traffic_spike | not_found_burst | server_errors | host_flood.
-- subject is the host for host_flood, '' otherwise.
CREATE TABLE IF NOT EXISTS speed_alerts (
    minute      CHAR(16)     NOT NULL,
    kind        VARCHAR(32)  NOT NULL,
    subject     VARCHAR(255) NOT NULL DEFAULT '',
    value       BIGINT       NOT NULL,
    threshold   BIGINT       NOT NULL,
    detected_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (minute, kind, subject),
    KEY (detected_at)
);
