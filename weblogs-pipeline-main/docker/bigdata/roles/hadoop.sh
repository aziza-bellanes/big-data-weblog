#!/usr/bin/env bash
# Single-node Hadoop: HDFS (NameNode + DataNode), YARN and the MapReduce history server.
set -euo pipefail
# Installed from scripts/lib/common.sh by the Dockerfile.
# shellcheck source=../../../scripts/lib/common.sh
source /usr/local/lib/bigdata/common.sh

readonly NAME_DIR=/var/lib/hadoop/dfs/name
readonly READY_FLAG=/tmp/hadoop.ready

# HDFS folders used by the pipeline, created once the NameNode is up.
# Zones of both architectures, as in config/architectures.json.
readonly HDFS_DIRS=(
    # A · Sequential
    /data/weblogs /data/reference /data/results
    # B · Parallel
    /data/nasa/raw/flume /data/nasa/streaming/kafka /data/nasa/reference/sqoop /data/nasa/results
    # Hive scratch space and warehouse
    /tmp /tmp/hive /user/hive/warehouse
)

stop_all() {
    log "stopping Hadoop daemons"
    mapred --daemon stop historyserver || true
    yarn --daemon stop nodemanager || true
    yarn --daemon stop resourcemanager || true
    hdfs --daemon stop datanode || true
    hdfs --daemon stop namenode || true
    exit 0
}
trap stop_all SIGTERM SIGINT

rm -f "$READY_FLAG"

if [[ ! -d "$NAME_DIR/current" ]]; then
    log "formatting a new NameNode"
    hdfs namenode -format -nonInteractive -force
fi

hdfs --daemon start namenode
hdfs --daemon start datanode
yarn --daemon start resourcemanager
yarn --daemon start nodemanager
mapred --daemon start historyserver

hdfs dfsadmin -safemode wait
hdfs dfs -mkdir -p "${HDFS_DIRS[@]}"
hdfs dfs -chmod -R 1777 /tmp
touch "$READY_FLAG"
log "Hadoop is ready (NameNode UI :9870, YARN UI :8088)"

# Keep the container in the foreground and show daemon logs in `docker compose logs`.
tail -n 0 -F "$HADOOP_LOG_DIR"/*.log &
wait $!
