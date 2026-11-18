# shellcheck shell=bash
# Shared helpers for every shell script in the project.
# Source it, do not execute it:  source "$(dirname "$0")/../scripts/lib/common.sh"

# Connection settings. Defaults match docker-compose.yml; override through the environment.
: "${MYSQL_HOST:=mysql}"
: "${MYSQL_PORT:=3306}"
: "${WEBLOGS_DB:=weblogs}"
: "${SQOOP_DB_USER:=sqoop}"
: "${SQOOP_DB_PASSWORD:=sqoop}"
: "${HIVE_JDBC_URL:=jdbc:hive2://hive:10000/default}"
: "${HIVE_USER:=hadoop}"

log()  { printf '%s [INFO]  %s\n' "$(date '+%H:%M:%S')" "$*"; }
warn() { printf '%s [WARN]  %s\n' "$(date '+%H:%M:%S')" "$*" >&2; }
die()  { printf '%s [ERROR] %s\n' "$(date '+%H:%M:%S')" "$*" >&2; exit 1; }

require_cmd() {
    local cmd
    for cmd in "$@"; do
        command -v "$cmd" >/dev/null 2>&1 || die "required command not found: $cmd"
    done
}

# wait_for_tcp HOST PORT [TIMEOUT_SECONDS]
wait_for_tcp() {
    local host=$1 port=$2 timeout=${3:-180} waited=0
    log "waiting for $host:$port"
    until (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null; do
        (( waited >= timeout )) && die "timed out after ${timeout}s waiting for $host:$port"
        sleep 2
        (( waited += 2 ))
    done
    log "$host:$port is reachable"
}

# mysql_jdbc_url [DATABASE]
mysql_jdbc_url() {
    local db=${1:-$WEBLOGS_DB}
    printf 'jdbc:mysql://%s:%s/%s?useSSL=false&allowPublicKeyRetrieval=true' \
        "$MYSQL_HOST" "$MYSQL_PORT" "$db"
}

# beeline_run FILE  - run a HiveQL file against HiveServer2
beeline_run() {
    local file=$1
    [[ -f $file ]] || die "HiveQL file not found: $file"
    log "running $(basename "$file")"
    beeline -u "$HIVE_JDBC_URL" -n "$HIVE_USER" --silent=true --showHeader=true \
        --outputformat=table -f "$file"
}
