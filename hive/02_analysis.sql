-- Analyses over the access logs. Each result table is fully rewritten on every run.

USE ${hivevar:db};

-- Register the day folders written by Flume since the last run, and forget folders
-- removed by make reset.
MSCK REPAIR TABLE access_logs_raw SYNC PARTITIONS;

-- Ten most requested paths.
INSERT OVERWRITE TABLE top_pages
SELECT path, count(*) AS hits
FROM access_logs
WHERE path IS NOT NULL
GROUP BY path
ORDER BY hits DESC
LIMIT 10;

-- Traffic by hour of day, with the average per observed day.
INSERT OVERWRITE TABLE hits_per_hour
SELECT a.hour_of_day,
       count(*)                AS hits,
       round(count(*) / d.n, 2) AS avg_hits_per_day
FROM access_logs a
CROSS JOIN (SELECT count(DISTINCT dt) AS n FROM access_logs) d
WHERE a.hour_of_day IS NOT NULL
GROUP BY a.hour_of_day, d.n
ORDER BY a.hour_of_day;

-- Daily volume, errors and distinct visitors; gaps show days without traffic.
INSERT OVERWRITE TABLE hits_per_day
SELECT dt                                           AS day,
       count(*)                                     AS hits,
       sum(IF(status BETWEEN 400 AND 499, 1, 0))    AS client_errors,
       sum(IF(status >= 500, 1, 0))                 AS server_errors,
       count(DISTINCT host)                         AS unique_hosts
FROM access_logs
GROUP BY dt
ORDER BY day;

-- Share of each status code, labelled with the reference data imported from MySQL.
INSERT OVERWRITE TABLE status_distribution
SELECT s.status,
       r.label,
       r.category,
       s.hits,
       round(100.0 * s.hits / t.total, 4) AS pct
FROM (SELECT status, count(*) AS hits FROM access_logs GROUP BY status) s
CROSS JOIN (SELECT count(*) AS total FROM access_logs) t
LEFT JOIN status_codes r ON r.code = s.status
ORDER BY s.hits DESC;

-- Ten most active client hosts.
INSERT OVERWRITE TABLE top_hosts
SELECT host, count(*) AS hits
FROM access_logs
GROUP BY host
ORDER BY hits DESC
LIMIT 10;

-- Parsing coverage: non-matching lines have a NULL host.
INSERT OVERWRITE TABLE data_quality
SELECT total,
       parsed,
       total - parsed                                          AS malformed,
       round(IF(total = 0, 0, 100.0 * (total - parsed) / total), 4) AS malformed_pct
FROM (SELECT count(*) AS total, count(host) AS parsed FROM access_logs_raw) q;

-- Display results.
SELECT * FROM top_pages ORDER BY hits DESC;
SELECT * FROM hits_per_hour ORDER BY hour_of_day;
SELECT * FROM hits_per_day ORDER BY day;
SELECT * FROM status_distribution ORDER BY hits DESC;
SELECT * FROM top_hosts ORDER BY hits DESC;
SELECT * FROM data_quality;

-- Error codes of interest.
SELECT * FROM status_distribution WHERE status IN (404, 500) ORDER BY status;
