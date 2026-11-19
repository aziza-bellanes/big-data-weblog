-- Architecture B only, after 02_analysis.sql: the speed layer (Kafka -> Spark) and the
-- batch layer (Flume -> Hive) were computed independently, from two different copies of
-- the logs. They must report the same traffic for every day; the run fails otherwise.

USE ${hivevar:db};

MSCK REPAIR TABLE speed_minute_parts SYNC PARTITIONS;
MSCK REPAIR TABLE speed_host_minute_parts SYNC PARTITIONS;

INSERT OVERWRITE TABLE speed_vs_batch
SELECT coalesce(b.day, s.dt),
       b.hits,          s.hits,
       b.client_errors, s.client_errors,
       b.server_errors, s.server_errors
FROM hits_per_day b
FULL OUTER JOIN (SELECT dt,
                        sum(hits)          AS hits,
                        sum(client_errors) AS client_errors,
                        sum(server_errors) AS server_errors
                 FROM speed_minute_parts
                 GROUP BY dt) s
  ON b.day = s.dt;

SELECT * FROM speed_vs_batch ORDER BY day;
SELECT kind, count(*) AS minutes, max(value) AS worst FROM speed_alerts GROUP BY kind;

-- Fails the step (and the pipeline) when one day differs or exists in one layer only.
SELECT assert_true(count(*) = 0) AS layers_agree
FROM speed_vs_batch
WHERE NOT (batch_hits <=> speed_hits
           AND batch_client_errors <=> speed_client_errors
           AND batch_server_errors <=> speed_server_errors);
