-- Reference data imported into HDFS by Sqoop, and result tables filled by Sqoop export.
-- Result table column order must match the Hive tables in hive/01_create_tables.sql.

USE weblogs;

CREATE TABLE IF NOT EXISTS status_codes (
    code     SMALLINT    NOT NULL PRIMARY KEY,
    label    VARCHAR(64) NOT NULL,
    category VARCHAR(32) NOT NULL
);

INSERT IGNORE INTO status_codes (code, label, category) VALUES
    (200, 'OK',                    'Success'),
    (201, 'Created',               'Success'),
    (202, 'Accepted',              'Success'),
    (204, 'No Content',            'Success'),
    (206, 'Partial Content',       'Success'),
    (301, 'Moved Permanently',     'Redirection'),
    (302, 'Found',                 'Redirection'),
    (303, 'See Other',             'Redirection'),
    (304, 'Not Modified',          'Redirection'),
    (307, 'Temporary Redirect',    'Redirection'),
    (400, 'Bad Request',           'Client error'),
    (401, 'Unauthorized',          'Client error'),
    (403, 'Forbidden',             'Client error'),
    (404, 'Not Found',             'Client error'),
    (405, 'Method Not Allowed',    'Client error'),
    (408, 'Request Timeout',       'Client error'),
    (500, 'Internal Server Error', 'Server error'),
    (501, 'Not Implemented',       'Server error'),
    (502, 'Bad Gateway',           'Server error'),
    (503, 'Service Unavailable',   'Server error'),
    (504, 'Gateway Timeout',       'Server error');

CREATE TABLE IF NOT EXISTS top_pages (
    path VARCHAR(1024),
    hits BIGINT
);

CREATE TABLE IF NOT EXISTS hits_per_hour (
    hour_of_day      TINYINT,
    hits             BIGINT,
    avg_hits_per_day DOUBLE
);

CREATE TABLE IF NOT EXISTS hits_per_day (
    day           DATE,
    hits          BIGINT,
    client_errors BIGINT,
    server_errors BIGINT,
    unique_hosts  BIGINT
);

CREATE TABLE IF NOT EXISTS status_distribution (
    status   SMALLINT,
    label    VARCHAR(64),
    category VARCHAR(32),
    hits     BIGINT,
    pct      DOUBLE
);

CREATE TABLE IF NOT EXISTS top_hosts (
    host VARCHAR(255),
    hits BIGINT
);

CREATE TABLE IF NOT EXISTS data_quality (
    total_lines     BIGINT,
    parsed_lines    BIGINT,
    malformed_lines BIGINT,
    malformed_pct   DOUBLE
);
