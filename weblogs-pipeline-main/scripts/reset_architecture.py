#!/usr/bin/env python3
"""Empty the data of one architecture so its next run starts from zero.

Deletes its live log and replay checkpoints, its ingested HDFS folders and Hive results,
and empties its MySQL result tables. The other architecture, the Kafka topics and the
reference data are left untouched. Run it while that architecture is idle: Flume restarts
from the beginning of the new live log because the file is shorter than its old position.

Usage: reset_architecture.py ARCH
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import architectures

RESULT_TABLES = ("top_pages", "hits_per_hour", "hits_per_day", "status_distribution",
                 "top_hosts", "data_quality")


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
    folders = [arch["rawDir"], arch["eventsDir"], arch["resultsRoot"]]
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
            for table in RESULT_TABLES:
                cursor.execute(f"TRUNCATE TABLE {table}")
        connection.commit()
    log(f"emptied the result tables of MySQL {arch['mysqlDb']}")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    arch = architectures.get(argv[1])
    log(f"resetting {arch['label']}")
    clear_live_dir(arch)
    clear_hdfs(arch)
    clear_mysql(arch)
    log("done; Hive forgets the removed day folders at the next analysis (MSCK ... SYNC PARTITIONS)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
