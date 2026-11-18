#!/usr/bin/env bash
# Run one Flume agent.  Usage: flume <agent-name> <config-file>
# ${VARS} inside the config file are resolved from the container environment.
set -euo pipefail
# Installed from scripts/lib/common.sh by the Dockerfile.
# shellcheck source=../../../scripts/lib/common.sh
source /usr/local/lib/bigdata/common.sh

(( $# == 2 )) || die "usage: flume <agent-name> <config-file>"
readonly AGENT=$1 CONFIG=$2
[[ -f $CONFIG ]] || die "Flume config not found: $CONFIG"

wait_for_tcp hadoop 9000

# flume-ng overwrites JAVA_OPTS, so JVM flags are passed as arguments.
# English month names and UTC are required to parse "01/Jul/1995:00:00:01" consistently.
# shellcheck disable=SC2054  # "INFO,console" is one value, not two elements
readonly JVM_FLAGS=(
    -Xmx512m
    -Duser.timezone=UTC
    -Duser.language=en
    -Duser.country=US
    -DpropertiesImplementation=org.apache.flume.node.EnvVarResolverProperties
    -Dflume.root.logger=INFO,console
    # JSON counters per source/channel/sink, read by the dashboard and the healthcheck.
    -Dflume.monitoring.type=http
    "-Dflume.monitoring.port=${FLUME_METRICS_PORT:-34545}"
)

log "starting Flume agent '$AGENT' with $(basename "$CONFIG")"
exec flume-ng agent \
    --name "$AGENT" \
    --conf "$FLUME_HOME/conf" \
    --conf-file "$CONFIG" \
    "${JVM_FLAGS[@]}"
