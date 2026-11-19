#!/usr/bin/env python3
"""Empty the ingested data so the next run starts from zero.

Deletes the live log and replay checkpoints, the ingested HDFS folders (Flume, Kafka and
Spark outputs) and Hive results, and empties the MySQL result and speed layer tables. The
Kafka topic, the Spark checkpoint and the reference data are left untouched, so Spark does
not read earlier runs again. Run it while the pipeline is idle: Flume restarts from the
beginning of the new live log because the file is shorter than its old position.

Usage: reset_architecture.py ARCH
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import architectures
from cluster_ready import ClusterNotReady, require_ready

RESULT_TABLES = ("top_pages", "hits_per_hour", "hits_per_day", "status_distribution",
                 "top_hosts", "data_quality")
SPEED_TABLES = ("speed_batches", "speed_minute", "speed_host_minute", "speed_alerts")


def log(message: str) -> None:
    print(f"[reset] {message}", flush=True)


def clear_live_dir(arch: dict) -> None:
    live = Path(arch["liveDir"])
    for name in ("access.log", "access.log.offset", "producer.offset", "producer.dataset"):
        path = live / name
        if path.exists():
            path.unlink()
            log(f"deleted {path}")


def clear_hdfs(arch: dict) -> None:
    folders = [arch["rawDir"], arch["eventsDir"], arch["speedDir"], arch["resultsRoot"]]
    for folder in filter(None, folders):
        subprocess.run(["hdfs", "dfs", "-rm", "-r", "-f", "-skipTrash", folder], check=True,
                       stdout=subprocess.DEVNULL)
        subprocess.run(["hdfs", "dfs", "-mkdir", "-p", folder], check=True)
        log(f"emptied hdfs://{folder}")


def clear_mysql(arch: dict) -> None:
    import pymysql

    with pymysql.connect(host=os.environ.get("MYSQL_HOST", "mysql"),
                         user=os.environ.get("SQOOP_DB_USER", "sqoop"),
                         password=os.environ.get("SQOOP_DB_PASSWORD", "sqoop"),
                         database=arch["mysqlDb"]) as connection:
        with connection.cursor() as cursor:
            for table in RESULT_TABLES + SPEED_TABLES:
                cursor.execute(f"TRUNCATE TABLE {table}")
        connection.commit()
    log(f"emptied the result and speed layer tables of MySQL {arch['mysqlDb']}")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    arch = architectures.get(argv[1])
    # Refuse before removing checkpoints: otherwise a failed HDFS reset leaves the
    # next replay starting at zero against the previous run's data.
    try:
        require_ready(require_yarn=False)
    except ClusterNotReady as error:
        log(str(error))
        return 1
    log("resetting the pipeline data")
    clear_hdfs(arch)
    clear_mysql(arch)
    clear_live_dir(arch)
    log("done; Hive forgets the removed day folders at the next analysis (MSCK ... SYNC PARTITIONS)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
