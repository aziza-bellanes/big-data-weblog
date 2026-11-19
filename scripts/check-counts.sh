#!/usr/bin/env bash
# No-loss check of the Flume branch: lines replayed into the live log vs. lines stored
# in the raw HDFS zone. Run it once the replay has finished and Flume has closed its
# files (idle for about a minute). Usage: check-counts.sh
#
# A deeper, source-aware check of all three branches:
# scripts/verify_ingestion.py (make verify-ingestion).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
arch_env

require_cmd hdfs
[[ -f $LIVE_LOG ]] || die "$LIVE_LOG not found; has the replay run?"

source_lines=$(wc -l < "$LIVE_LOG")
hdfs_lines=$(hdfs dfs -cat "$RAW_DIR/dt=*/weblogs.*" 2>/dev/null | wc -l)
open_files=$(hdfs dfs -ls -R "$RAW_DIR" 2>/dev/null | grep -c '/_weblogs' || true)

log "lines in source log : $source_lines"
log "lines in HDFS       : $hdfs_lines ($RAW_DIR)"
(( open_files == 0 )) || warn "$open_files file(s) still being written; wait for Flume to roll them"

if (( source_lines == hdfs_lines )); then
    log "OK: no lines lost"
else
    die "mismatch: $(( source_lines - hdfs_lines )) line(s) missing from HDFS"
fi
