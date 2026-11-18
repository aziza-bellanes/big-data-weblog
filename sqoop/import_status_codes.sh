#!/usr/bin/env bash
# Import the MySQL status_codes reference table into HDFS for the Hive join.
# Usage: ARCH=parallel|sequential import_status_codes.sh
#
# The import lands in a staging folder, is checked against MySQL, then replaces the
# published copy; the previous copy is kept until the swap succeeds, so a failed import
# never leaves Hive without reference data.
# Columns are named explicitly: with MySQL Connector/J 8, Sqoop 1.4.7 otherwise lists
# them alphabetically, which no longer matches the Hive table.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../scripts/lib/common.sh"
arch_env

readonly TARGET_DIR=$REFERENCE_DIR
readonly STAGING_DIR="${TARGET_DIR}_staging"
readonly BACKUP_DIR="${TARGET_DIR}_previous"

require_cmd sqoop hdfs
mkdir -p "$LIVE_DIR"
exec 9>"$LIVE_DIR/sqoop-import.lock"
flock -n 9 || die "another Sqoop import is running for $ARCH_LABEL"

if ! hdfs dfs -test -d "$TARGET_DIR" && hdfs dfs -test -d "$BACKUP_DIR"; then
    hdfs dfs -mv "$BACKUP_DIR" "$TARGET_DIR"
fi
password_file=$(mktemp)
trap 'rm -f "$password_file"' EXIT
chmod 600 "$password_file"
printf '%s' "$SQOOP_DB_PASSWORD" > "$password_file"

log "importing $WEBLOGS_DB.status_codes into $TARGET_DIR"
sqoop import \
    --connect "$(mysql_jdbc_url)" \
    --username "$SQOOP_DB_USER" \
    --password-file "file://$password_file" \
    --table status_codes \
    --columns code,label,category \
    --target-dir "$STAGING_DIR" \
    --delete-target-dir \
    --fields-terminated-by '\t' \
    -m 1

python3 "$(dirname "${BASH_SOURCE[0]}")/../scripts/validate_reference.py" "$STAGING_DIR"
hdfs dfs -rm -r -f "$BACKUP_DIR"
if hdfs dfs -test -d "$TARGET_DIR"; then
    hdfs dfs -mv "$TARGET_DIR" "$BACKUP_DIR"
fi
if ! hdfs dfs -mv "$STAGING_DIR" "$TARGET_DIR"; then
    hdfs dfs -mv "$BACKUP_DIR" "$TARGET_DIR"
    die 'reference publication failed; restored previous snapshot'
fi
hdfs dfs -rm -r -f "$BACKUP_DIR"

log "imported rows:"
hdfs dfs -cat "$TARGET_DIR/part-*"
