# shellcheck shell=bash
# Sourced by the MySQL entrypoint on first start (docker_process_sql comes from it):
# create the result, reference and speed layer tables.
# make db-init applies the same files to an existing volume.
for schema in weblogs speed_layer; do
    docker_process_sql --database=weblogs_parallel < "/opt/mysql/schema/$schema.sql"
done
