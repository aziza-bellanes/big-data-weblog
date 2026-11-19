#!/usr/bin/env bash
# Architecture B: pause the Kafka HDFS writer during an ingestion, resume it, reconcile.
# Only the pause and resume run on the host (they act on a container); every measurement
# runs in the client container (scripts/experiment.py).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

experiment() { docker compose exec -T client python3 /opt/project/scripts/experiment.py "$1"; }

experiment start
docker compose pause kafka-hdfs-writer
trap 'docker compose unpause kafka-hdfs-writer >/dev/null 2>&1 || true' EXIT
sleep 20
experiment during
docker compose unpause kafka-hdfs-writer
trap - EXIT
experiment after
