-- Databases and service accounts. Executed once by the MySQL entrypoint as root.

CREATE DATABASE IF NOT EXISTS metastore CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS weblogs   CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Hive metastore backend
CREATE USER IF NOT EXISTS 'hive'@'%' IDENTIFIED BY 'hive';
GRANT ALL PRIVILEGES ON metastore.* TO 'hive'@'%';

-- Sqoop import/export
CREATE USER IF NOT EXISTS 'sqoop'@'%' IDENTIFIED BY 'sqoop';
GRANT ALL PRIVILEGES ON weblogs.* TO 'sqoop'@'%';

FLUSH PRIVILEGES;
