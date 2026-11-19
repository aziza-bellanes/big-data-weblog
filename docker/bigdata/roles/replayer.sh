#!/usr/bin/env bash
# Replay the NASA logs into the live log, so the Flume agent sees a
# "live" web server. Usage: replayer
set -euo pipefail
# Installed from scripts/lib/common.sh by the Dockerfile.
# shellcheck source=../../../scripts/lib/common.sh
source /usr/local/lib/bigdata/common.sh
arch_env

readonly INPUT_DIR=/data/input
: "${REPLAY_RATE:=500}"
: "${REPLAY_LIMIT:=0}"

shopt -s nullglob
found=("$INPUT_DIR"/NASA_access_log_*)
(( ${#found[@]} > 0 )) || die "no log files in $INPUT_DIR; run 'make data' on the host first"

# Replay in calendar order (NASA_access_log_Jul95 before ..._Aug95), not alphabetical order.
mapfile -t inputs < <(printf '%s\n' "${found[@]}" | sort -t_ -k4.1,4.3M)

input_args=()
for file in "${inputs[@]}"; do input_args+=(--input "$file"); done

log "replaying into $LIVE_LOG"
exec python3 "$PROJECT_HOME/scripts/replay.py" \
    "${input_args[@]}" \
    --output "$LIVE_LOG" \
    --rate "$REPLAY_RATE" \
    --limit "$REPLAY_LIMIT"
