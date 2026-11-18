#!/usr/bin/env python3
"""Start a job on the control API and follow its log until it ends, like the dashboard does.

Used by `make compare`, so a comparison started from the terminal is the same job, with
the same record, as one started from the web page.

Usage: control_client.py ACTION [--arch A] [--rate N] [--limit N] [--keep-data]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

API = os.environ.get("CONTROL_URL", "http://localhost:8000")


def call(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(API + path, data=data, method=method,
                                     headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit(f"control API: {json.load(error).get('error', error.reason)}") from None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("action")
    parser.add_argument("--arch")
    parser.add_argument("--rate", type=int, default=5000)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--keep-data", action="store_true",
                        help="compare only: do not empty both architectures first")
    args = parser.parse_args()
    if args.action == "show-comparison":
        records = call("GET", "/runs")["runs"]
        record = next((r for r in records if r["kind"] == "comparison"
                       and r["status"] == "succeeded" and r.get("params", {}).get("limit") == 0), None)
        if record is None:
            raise SystemExit("no successful full comparison recorded")
        print(f"stored full comparison {record['id']}")
        print_comparison(record)
        return 0
    body = {"action": args.action, "rate": args.rate, "limit": args.limit}
    if args.arch:
        body["arch"] = args.arch
    if args.action == "compare":
        body["fresh"] = not args.keep_data
    job = call("POST", "/jobs", body)
    print(f"job {job['id']} started; it keeps running if you press Ctrl+C", flush=True)
    seq = -1
    try:
        while True:
            update = call("GET", f"/jobs/{job['id']}/log?after={seq}")
            for line in update["lines"]:
                print(line["text"], flush=True)
                seq = line["seq"]
            if update["job"]["status"] != "running":
                job = update["job"]
                break
            time.sleep(1)
    except KeyboardInterrupt:
        print(f"\nstopped following; job {job['id']} is still running", file=sys.stderr)
        return 130
    print(f"job {job['id']} {job['status']}", flush=True)
    if job["action"] == "compare":
        print_comparison(call("GET", f"/runs/{job['id']}"))
    return 0 if job["status"] == "succeeded" else 1


def print_comparison(record: dict) -> None:
    rows = [("lines", "lines"), ("every line in HDFS (s)", "allWrittenSeconds"),
            ("every file closed (s)", "allClosedSeconds"), ("lines per second", "linesPerSecond"),
            ("peak Kafka lag", "peakKafkaLag")]
    archs = record["architectures"]
    print(f"\n{'':<26}{'A · Sequential':>16}{'B · Parallel':>16}")
    for label, key in rows:
        values = [str(archs.get(a, {}).get("ingestion", {}).get(key, "-")) for a in ("sequential", "parallel")]
        print(f"{label:<26}{values[0]:>16}{values[1]:>16}")
    batch = [str(archs.get(a, {}).get("batchSeconds", "-")) for a in ("sequential", "parallel")]
    print(f"{'batch part (s)':<26}{batch[0]:>16}{batch[1]:>16}")
    match = record.get("comparison", {}).get("allResultsMatch")
    print(f"\nresult tables identical: {'yes' if match else 'NO'}")


if __name__ == "__main__":
    sys.exit(main())
