#!/usr/bin/env bash
# Tool container: `docker compose exec client ...` for Sqoop, HDFS and beeline commands,
# and host of the control API the dashboard uses to run pipeline steps.
set -euo pipefail
# Installed from scripts/lib/common.sh by the Dockerfile.
# shellcheck source=../../../scripts/lib/common.sh
source /usr/local/lib/bigdata/common.sh

wait_for_tcp hadoop 9000
log "client ready: docker compose exec client bash"
# The control API lets the dashboard run the same steps as the Makefile.
exec python3 "$PROJECT_HOME/scripts/control_server.py"
