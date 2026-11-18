# shellcheck shell=bash
# Sourced by the MySQL entrypoint on first start (docker_process_sql comes from it):
# create the same tables in the database of each architecture.
# make db-init applies the same files to an existing volume.
for db in weblogs weblogs_parallel; do
    docker_process_sql --database="$db" < /opt/mysql/schema/weblogs.sql
done
