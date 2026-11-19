-- Hive schema: raw logs, parsed view, reference data and result tables.
-- scripts/lib/common.sh (beeline_run) passes the database and the HDFS locations of
-- config/architectures.json as Hive variables. Safe to run repeatedly.

CREATE DATABASE IF NOT EXISTS ${hivevar:db};
USE ${hivevar:db};

-- Raw Common Log Format lines written by Flume, one partition per day.
-- Lines that do not match the regex come back as all-NULL rows.
CREATE EXTERNAL TABLE IF NOT EXISTS access_logs_raw (
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
LOCATION '${hivevar:raw_dir}';

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
FROM access_logs_raw
WHERE host IS NOT NULL;

-- HTTP status reference data imported from MySQL by Sqoop.
CREATE EXTERNAL TABLE IF NOT EXISTS status_codes (
    code     INT,
    label    STRING,
    category STRING
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY '\t'
STORED AS TEXTFILE
LOCATION '${hivevar:reference_dir}';

-- Result tables, exported to MySQL by Sqoop.
CREATE EXTERNAL TABLE IF NOT EXISTS top_pages (
    path STRING,
    hits BIGINT
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY '\t'
STORED AS TEXTFILE
LOCATION '${hivevar:results_root}/top_pages';

CREATE EXTERNAL TABLE IF NOT EXISTS hits_per_hour (
    hour_of_day      INT,
    hits             BIGINT,
    avg_hits_per_day DOUBLE
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY '\t'
STORED AS TEXTFILE
LOCATION '${hivevar:results_root}/hits_per_hour';

CREATE EXTERNAL TABLE IF NOT EXISTS hits_per_day (
    day           STRING,
    hits          BIGINT,
    client_errors BIGINT,
    server_errors BIGINT,
    unique_hosts  BIGINT
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY '\t'
STORED AS TEXTFILE
LOCATION '${hivevar:results_root}/hits_per_day';

CREATE EXTERNAL TABLE IF NOT EXISTS status_distribution (
    status   INT,
    label    STRING,
    category STRING,
    hits     BIGINT,
    pct      DOUBLE
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY '\t'
STORED AS TEXTFILE
LOCATION '${hivevar:results_root}/status_distribution';

CREATE EXTERNAL TABLE IF NOT EXISTS top_hosts (
    host STRING,
    hits BIGINT
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY '\t'
STORED AS TEXTFILE
LOCATION '${hivevar:results_root}/top_hosts';

CREATE EXTERNAL TABLE IF NOT EXISTS data_quality (
    total_lines     BIGINT,
    parsed_lines    BIGINT,
    malformed_lines BIGINT,
    malformed_pct   DOUBLE
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY '\t'
STORED AS TEXTFILE
LOCATION '${hivevar:results_root}/data_quality';

-- Tables created before the locations became per-architecture keep their old LOCATION;
-- these make every run point at the selected architecture's folders.
ALTER TABLE access_logs_raw SET LOCATION '${hivevar:raw_dir}';
ALTER TABLE status_codes SET LOCATION '${hivevar:reference_dir}';
