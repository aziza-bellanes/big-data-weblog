-- Hive schema: raw logs, parsed view, reference data and result tables.
-- Safe to run repeatedly.

CREATE DATABASE IF NOT EXISTS weblogs;
USE weblogs;

-- Raw Common Log Format lines written by Flume, one partition per day.
-- Lines that do not match the regex come back as all-NULL rows.
CREATE EXTERNAL TABLE IF NOT EXISTS nasa_logs_raw (
    host     STRING,
    ident    STRING,
    authuser STRING,
    ts_raw   STRING,
    request  STRING,
    status   STRING,
    bytes    STRING
)
PARTITIONED BY (dt STRING)
ROW FORMAT SERDE 'org.apache.hadoop.hive.serde2.RegexSerDe'
WITH SERDEPROPERTIES (
    'input.regex' = '^(\\S+) (\\S+) (\\S+) \\[([^\\]]+)\\] "([^"]*)" (\\d{3}) (\\S+)$'
)
STORED AS TEXTFILE
LOCATION '/data/nasa/raw/flume';

-- Parsed, typed view over the well-formed lines.
-- event_time is server local time; the UTC offset is ignored.
CREATE OR REPLACE VIEW access_logs AS
SELECT
    host,
    from_unixtime(unix_timestamp(substr(ts_raw, 1, 20), 'dd/MMM/yyyy:HH:mm:ss')) AS event_time,
    CAST(substr(ts_raw, 13, 2) AS INT)                                           AS hour_of_day,
    split(request, ' ')[0]                                                       AS method,
    split(request, ' ')[1]                                                       AS path,
    split(request, ' ')[2]                                                       AS protocol,
    CAST(status AS INT)                                                          AS status,
    CAST(IF(bytes = '-', '0', bytes) AS BIGINT)                                  AS bytes,
    dt
FROM nasa_logs_raw
WHERE host IS NOT NULL;

-- HTTP status reference data imported from MySQL by Sqoop.
CREATE EXTERNAL TABLE IF NOT EXISTS status_codes (
    code     INT,
    label    STRING,
    category STRING
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY '\t'
STORED AS TEXTFILE
LOCATION '/data/nasa/reference/sqoop/status_codes';

-- Result tables, exported to MySQL by Sqoop.
CREATE EXTERNAL TABLE IF NOT EXISTS top_pages (
    path STRING,
    hits BIGINT
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY '\t'
STORED AS TEXTFILE
LOCATION '/data/results/top_pages';

CREATE EXTERNAL TABLE IF NOT EXISTS hits_per_hour (
    hour_of_day      INT,
    hits             BIGINT,
    avg_hits_per_day DOUBLE
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY '\t'
STORED AS TEXTFILE
LOCATION '/data/results/hits_per_hour';

CREATE EXTERNAL TABLE IF NOT EXISTS hits_per_day (
    day           STRING,
    hits          BIGINT,
    client_errors BIGINT,
    server_errors BIGINT,
    unique_hosts  BIGINT
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY '\t'
STORED AS TEXTFILE
LOCATION '/data/results/hits_per_day';

CREATE EXTERNAL TABLE IF NOT EXISTS status_distribution (
    status   INT,
    label    STRING,
    category STRING,
    hits     BIGINT,
    pct      DOUBLE
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY '\t'
STORED AS TEXTFILE
LOCATION '/data/results/status_distribution';

CREATE EXTERNAL TABLE IF NOT EXISTS top_hosts (
    host STRING,
    hits BIGINT
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY '\t'
STORED AS TEXTFILE
LOCATION '/data/results/top_hosts';

CREATE EXTERNAL TABLE IF NOT EXISTS data_quality (
    total_lines     BIGINT,
    parsed_lines    BIGINT,
    malformed_lines BIGINT,
    malformed_pct   DOUBLE
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY '\t'
STORED AS TEXTFILE
LOCATION '/data/results/data_quality';

-- Explicit ALTERs migrate existing metastore tables too.
ALTER TABLE nasa_logs_raw SET LOCATION '/data/nasa/raw/flume';
ALTER TABLE status_codes SET LOCATION '/data/nasa/reference/sqoop/status_codes';
CREATE OR REPLACE VIEW status_codes_ref AS SELECT * FROM status_codes;

-- Use built-in JSON functions rather than requiring an extra JSON SerDe jar.
CREATE EXTERNAL TABLE IF NOT EXISTS nasa_kafka_json (json_line STRING)
PARTITIONED BY (dt STRING) STORED AS TEXTFILE
LOCATION '/data/nasa/streaming/kafka';
CREATE OR REPLACE VIEW nasa_kafka_events AS
SELECT get_json_object(json_line, '$.event_id') AS event_id,
       get_json_object(json_line, '$.raw_line') AS raw_line,
       get_json_object(json_line, '$.event_time') AS event_time,
       get_json_object(json_line, '$.host') AS host,
       get_json_object(json_line, '$.resource') AS resource,
       CAST(get_json_object(json_line, '$.http_status') AS INT) AS http_status,
       get_json_object(json_line, '$.parse_error') AS parse_error, dt
FROM nasa_kafka_json;
CREATE OR REPLACE VIEW nasa_kafka_events_unique AS
SELECT event_id, raw_line, event_time, host, resource, http_status, parse_error, dt
FROM (SELECT *, row_number() OVER (PARTITION BY event_id ORDER BY event_time) AS rn
      FROM nasa_kafka_events WHERE event_id IS NOT NULL) numbered WHERE rn = 1;
