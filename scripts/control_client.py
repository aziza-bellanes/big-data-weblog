#!/usr/bin/env python3
"""Start a job on the control API and follow its log until it ends, like the dashboard does.

A job started from the terminal is the same job, with the same record, as one started
from the web page.

Usage: control_client.py ACTION [--rate N] [--limit N]
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
    parser.add_argument("--rate", type=int, default=5000)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    body = {"action": args.action, "rate": args.rate, "limit": args.limit}
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
    return 0 if job["status"] == "succeeded" else 1


if __name__ == "__main__":
    sys.exit(main())
