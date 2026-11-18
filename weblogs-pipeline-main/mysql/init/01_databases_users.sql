-- Databases and service accounts. Executed once by the MySQL entrypoint as root, and
-- again by make db-init on an existing volume (every statement is idempotent).
-- One results database per architecture: weblogs (A, sequential), weblogs_parallel (B).

CREATE DATABASE IF NOT EXISTS metastore        CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS weblogs          CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS weblogs_parallel CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Hive metastore backend
CREATE USER IF NOT EXISTS 'hive'@'%' IDENTIFIED BY 'hive';
GRANT ALL PRIVILEGES ON metastore.* TO 'hive'@'%';

-- Sqoop import/export
CREATE USER IF NOT EXISTS 'sqoop'@'%' IDENTIFIED BY 'sqoop';
GRANT ALL PRIVILEGES ON weblogs.*          TO 'sqoop'@'%';
GRANT ALL PRIVILEGES ON weblogs_parallel.* TO 'sqoop'@'%';

FLUSH PRIVILEGES;
