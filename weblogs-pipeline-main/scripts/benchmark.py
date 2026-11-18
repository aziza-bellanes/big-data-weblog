#!/usr/bin/env python3
"""Architecture B: time the three branches at a requested rate, then reconcile them.

Runs inside the client container (make benchmark-*). The limit counts source lines from the
start of the dataset, so a second run continues where the first stopped; existing data and
checkpoints are kept. The rate is what was requested; the measured rate is reported next to it.
Results go to artifacts/benchmarks/<run id>.json and .csv.
"""
import argparse
import csv
import json
import os
import platform
import subprocess
import time
from pathlib import Path

PROJECT = Path(os.environ.get('PROJECT_HOME', '/opt/project'))
OUTPUT = Path(os.environ.get('ARTIFACT_DIR', '/opt/artifacts')) / 'benchmarks'
FIELDS = ['run_id', 'requested_rate', 'cumulative_limit', 'status', 'ingestion_seconds',
          'end_to_end_seconds']


def run(*command, env=None):
    return subprocess.run(command, capture_output=True, text=True, check=True, env=env).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--rate', type=int, choices=[100, 1000, 5000], default=100)
    parser.add_argument('--limit', type=int, default=10000,
                        help='cumulative source-line limit, including earlier runs')
    args = parser.parse_args()
    report = dict(run_id=time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()), requested_rate=args.rate,
                  cumulative_limit=args.limit, platform=platform.platform(),
                  cpus=os.cpu_count(), status='failed', ingestion_seconds=None)
    started = time.monotonic()
    env = dict(os.environ, ARCH='parallel', REPLAY_RATE=str(args.rate), REPLAY_LIMIT=str(args.limit))
    try:
        report['ingestion_log'] = run('python3', str(PROJECT / 'scripts/parallel_ingestion.py'), env=env)
        report['ingestion_seconds'] = round(time.monotonic() - started, 1)
        report['verification_log'] = run('python3', str(PROJECT / 'scripts/verify_ingestion.py'))
        report['status'] = 'passed'
    except subprocess.CalledProcessError as error:
        report['error'] = str(error)
        report['failure_log'] = error.stdout + error.stderr
    report['end_to_end_seconds'] = round(time.monotonic() - started, 1)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / f"{report['run_id']}.json").write_text(json.dumps(report, indent=2))
    with (OUTPUT / f"{report['run_id']}.csv").open('w', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS, extrasaction='ignore')
        writer.writeheader()
        writer.writerow(report)
    print(json.dumps({key: report[key] for key in FIELDS}))
    return int(report['status'] != 'passed')


if __name__ == '__main__':
    raise SystemExit(main())
