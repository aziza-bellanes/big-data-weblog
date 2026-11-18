#!/usr/bin/env bash
# Hive metastore (schema in MySQL) and HiveServer2 (JDBC on :10000).
# Both run in the background; if either one exits, the container exits and Docker restarts it.
set -euo pipefail
# Installed from scripts/lib/common.sh by the Dockerfile.
# shellcheck source=../../../scripts/lib/common.sh
source /usr/local/lib/bigdata/common.sh

wait_for_tcp "$MYSQL_HOST" "$MYSQL_PORT"
wait_for_tcp hadoop 9000

if schematool -dbType mysql -info >/dev/null 2>&1; then
    log "metastore schema already initialised"
else
    log "initialising metastore schema"
    schematool -dbType mysql -initSchema
fi

hive --service metastore &
wait_for_tcp localhost 9083

log "starting HiveServer2"
hive --service hiveserver2 &

trap 'kill $(jobs -p) 2>/dev/null' SIGTERM SIGINT
wait -n
die "a Hive service stopped; exiting so the container restarts"
