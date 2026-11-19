#!/usr/bin/env python3
"""Check that HDFS can accept writes and YARN can schedule work."""
from __future__ import annotations

import json
import os
import sys
from urllib.request import urlopen


class ClusterNotReady(RuntimeError):
    pass


def read_json(url: str) -> dict:
    # Two probes must finish inside the dashboard's 2.5-second control timeout.
    with urlopen(url, timeout=1) as response:
        return json.load(response)


def check(*, require_yarn: bool = True) -> dict:
    problems = []
    free_bytes = 0
    hdfs_url = os.environ.get("HDFS_HTTP_URL", "http://hadoop:9870").rstrip("/")
    yarn_url = os.environ.get("YARN_HTTP_URL", "http://hadoop:8088").rstrip("/")
    try:
        info = read_json(hdfs_url + "/jmx?qry=Hadoop:service=NameNode,name=NameNodeInfo")["beans"][0]
        free_bytes = int(info["Free"])
        if info["Safemode"]:
            problems.append("HDFS is in safe mode and cannot write. Check free disk space and the NameNode log before leaving safe mode.")
        if not json.loads(info["LiveNodes"]):
            problems.append("HDFS has no live DataNode.")
        if info["NumberOfMissingBlocks"]:
            problems.append("HDFS reports missing blocks; inspect the DataNode before starting another run.")
    except (OSError, ValueError, KeyError, IndexError, TypeError) as error:
        problems.append(f"Cannot check HDFS readiness: {error}")
    if require_yarn:
        try:
            nodes = (read_json(yarn_url + "/ws/v1/cluster/nodes").get("nodes") or {}).get("node", [])
            if not any(node["state"] == "RUNNING" for node in nodes):
                detail = "; ".join(node.get("healthReport", "") for node in nodes).strip()
                problems.append("YARN has no healthy worker to run Hive or Sqoop." + (f" {detail}" if detail else ""))
        except (OSError, ValueError, KeyError, TypeError) as error:
            problems.append(f"Cannot check YARN readiness: {error}")
    return {"ready": not problems, "problems": problems, "freeBytes": free_bytes}


def require_ready(*, require_yarn: bool = True) -> dict:
    state = check(require_yarn=require_yarn)
    if not state["ready"]:
        raise ClusterNotReady(" ".join(state["problems"]))
    return state


def require_space(state: dict, lines: int, bytes_per_line: int) -> None:
    # This single-machine stack stores the live log, Kafka and HDFS on the same
    # filesystem. Budget their copies and leave 4 GiB for YARN and the host.
    needed = 4 * 1024**3 + lines * bytes_per_line
    available = state["freeBytes"]
    if available < needed:
        raise ClusterNotReady(
            f"Not enough disk space for this replay: {available / 1024**3:.1f} GiB free; "
            f"allow at least {needed / 1024**3:.1f} GiB for {lines:,} lines. "
            "Free more space or choose a smaller dataset. No replay or reset has started.")


if __name__ == "__main__":
    state = check()
    print("HDFS is writable and YARN has a healthy worker." if state["ready"] else " ".join(state["problems"]))
    sys.exit(0 if state["ready"] else 1)
