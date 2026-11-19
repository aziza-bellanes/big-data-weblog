-- Architecture B only: the speed layer written by Spark Structured Streaming from Kafka
-- (scripts/spark_speed_layer.py). Every Spark micro-batch writes partial counts in its
-- own batch_id folder; the views below add them up.
--
--   batch layer   Flume raw lines -> Hive (02_analysis.sql)  exact, after the run
--   speed layer   Kafka -> Spark  -> these tables             within seconds, during the run
--
-- 05_speed_check.sql then requires both layers to agree day by day.

USE ${hivevar:db};

-- External tables: dropping them never touches the Parquet files, and recreating them
-- on every run keeps their definition current. batch_id is a STRING partition because
-- Hive 3.1 fails to drop numeric partitions in MSCK ... SYNC PARTITIONS (after a reset).
DROP TABLE IF EXISTS speed_minute_parts;
DROP TABLE IF EXISTS speed_host_minute_parts;

CREATE EXTERNAL TABLE speed_minute_parts (
    dt            STRING,
    minute        STRING,
    hits          BIGINT,
    client_errors BIGINT,
    not_found     BIGINT,
    server_errors BIGINT,
    bytes         BIGINT
)
PARTITIONED BY (batch_id STRING)
STORED AS PARQUET
LOCATION '${hivevar:speed_dir}/minute_stats';

CREATE EXTERNAL TABLE speed_host_minute_parts (
    dt     STRING,
    minute STRING,
    host   STRING,
    hits   BIGINT
)
PARTITIONED BY (batch_id STRING)
STORED AS PARQUET
LOCATION '${hivevar:speed_dir}/host_minute';

MSCK REPAIR TABLE speed_minute_parts SYNC PARTITIONS;
MSCK REPAIR TABLE speed_host_minute_parts SYNC PARTITIONS;

-- Traffic per minute, as seen by the stream.
CREATE OR REPLACE VIEW speed_traffic_minute AS
SELECT dt, minute,
       sum(hits)          AS hits,
       sum(client_errors) AS client_errors,
       sum(not_found)     AS not_found,
       sum(server_errors) AS server_errors,
       sum(bytes)         AS bytes
FROM speed_minute_parts
GROUP BY dt, minute;

-- Alerts. Thresholds sit above the 99.9th percentile of a normal NASA minute
-- (217 hits, 13 not-found, 16 requests from one host), so they mark real anomalies.
CREATE OR REPLACE VIEW speed_alerts AS
SELECT minute, 'traffic_spike' AS kind, CAST(NULL AS STRING) AS subject, hits AS value
FROM speed_traffic_minute WHERE hits >= 300
UNION ALL
SELECT minute, 'not_found_burst', CAST(NULL AS STRING), not_found
FROM speed_traffic_minute WHERE not_found >= 15
UNION ALL
SELECT minute, 'server_errors', CAST(NULL AS STRING), server_errors
FROM speed_traffic_minute WHERE server_errors >= 3
UNION ALL
SELECT minute, 'host_flood', host, hits
FROM (SELECT minute, host, sum(hits) AS hits
      FROM speed_host_minute_parts GROUP BY minute, host) h
WHERE hits >= 30;

-- Day-by-day agreement of the two layers, filled by 05_speed_check.sql.
CREATE EXTERNAL TABLE IF NOT EXISTS speed_vs_batch (
    day                 STRING,
    batch_hits          BIGINT,
    speed_hits          BIGINT,
    batch_client_errors BIGINT,
    speed_client_errors BIGINT,
    batch_server_errors BIGINT,
    speed_server_errors BIGINT
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY '\t'
STORED AS TEXTFILE
LOCATION '${hivevar:results_root}/speed_vs_batch';
