-- Architecture B only: the JSON events written to HDFS by the Kafka writer.
-- Delivery is at least once, so the same event can be stored twice after a crash;
-- kafka_events_unique keeps one row per event_id. The six result tables never read
-- these views: Flume's raw lines stay the source of the reporting, and the events are
-- used to reconcile the two ingestion paths.

USE ${hivevar:db};

CREATE EXTERNAL TABLE IF NOT EXISTS kafka_events_json (json_line STRING)
PARTITIONED BY (dt STRING)
STORED AS TEXTFILE
LOCATION '${hivevar:events_dir}';

MSCK REPAIR TABLE kafka_events_json SYNC PARTITIONS;

-- Built-in JSON functions: no extra SerDe jar to install.
CREATE OR REPLACE VIEW kafka_events AS
SELECT get_json_object(json_line, '$.event_id')                   AS event_id,
       get_json_object(json_line, '$.raw_line')                   AS raw_line,
       get_json_object(json_line, '$.event_time')                 AS event_time,
       get_json_object(json_line, '$.host')                       AS host,
       get_json_object(json_line, '$.resource')                   AS resource,
       CAST(get_json_object(json_line, '$.http_status') AS INT)   AS http_status,
       get_json_object(json_line, '$.parse_error')                AS parse_error,
       dt
FROM kafka_events_json;

CREATE OR REPLACE VIEW kafka_events_unique AS
SELECT event_id, raw_line, event_time, host, resource, http_status, parse_error, dt
FROM (SELECT *, row_number() OVER (PARTITION BY event_id ORDER BY event_time) AS rn
      FROM kafka_events
      WHERE event_id IS NOT NULL) numbered
WHERE rn = 1;
