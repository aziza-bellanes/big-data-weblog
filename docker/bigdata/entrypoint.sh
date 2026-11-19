#!/usr/bin/env bash
# Dispatch the container to one role: hadoop | hive | flume | replayer | client.
# Any other command is executed as-is, so `docker compose run ... bash` still works.
set -euo pipefail

readonly ROLES_DIR=/usr/local/lib/bigdata/roles

role=${1:-client}
if [[ -f "$ROLES_DIR/$role.sh" ]]; then
    shift
    exec bash "$ROLES_DIR/$role.sh" "$@"
fi
exec "$@"
