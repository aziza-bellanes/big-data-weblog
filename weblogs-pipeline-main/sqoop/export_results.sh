#!/usr/bin/env bash
# Export the Hive result tables of one architecture from HDFS into its MySQL database,
# replacing previous contents. Usage: ARCH=parallel|sequential export_results.sh
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../scripts/lib/common.sh"
arch_env

# Column order of each result file, as written by Hive (hive/01_create_tables.sql).
# Named explicitly: with MySQL Connector/J 8, Sqoop 1.4.7 otherwise maps fields to
# columns in alphabetical order.
readonly RESULT_TABLES=(top_pages hits_per_hour hits_per_day status_distribution top_hosts data_quality)
# shellcheck disable=SC2054  # each value is a comma-separated column list
declare -rA RESULT_COLUMNS=(
    [top_pages]=path,hits
    [hits_per_hour]=hour_of_day,hits,avg_hits_per_day
    [hits_per_day]=day,hits,client_errors,server_errors,unique_hosts
    [status_distribution]=status,label,category,hits,pct
    [top_hosts]=host,hits
    [data_quality]=total_lines,parsed_lines,malformed_lines,malformed_pct
)

require_cmd sqoop

# Connection arguments shared by every sqoop call.
conn_args() {
    printf '%s\n' \
        --connect "$(mysql_jdbc_url)" \
        --username "$SQOOP_DB_USER" \
        --password "$SQOOP_DB_PASSWORD"
}

sqoop_eval() {
    local -a conn
    mapfile -t conn < <(conn_args)
    sqoop eval "${conn[@]}" --query "$1"
}

# export_table TABLE - truncate the MySQL table, then load it from HDFS
export_table() {
    local table=$1
    local -a conn
    mapfile -t conn < <(conn_args)

    log "exporting $table"
    sqoop_eval "TRUNCATE TABLE $table"
    sqoop export "${conn[@]}" \
        --table "$table" \
        --columns "${RESULT_COLUMNS[$table]}" \
        --export-dir "$RESULTS_ROOT/$table" \
        --input-fields-terminated-by '\t' \
        --input-null-string '\\N' \
        --input-null-non-string '\\N' \
        -m 1
}

log "exporting $ARCH_LABEL results from $RESULTS_ROOT to MySQL $WEBLOGS_DB"
for table in "${RESULT_TABLES[@]}"; do
    export_table "$table"
done

# Row counts per table, in a single query.
summary=""
for table in "${RESULT_TABLES[@]}"; do
    summary+="${summary:+ UNION ALL }SELECT '$table' AS table_name, COUNT(*) AS row_count FROM $table"
done
log "export summary"
sqoop_eval "$summary"
