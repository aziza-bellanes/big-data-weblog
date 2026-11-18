#!/usr/bin/env python3
"""Measure resumed parallel ingestion without deleting data. Rate is requested, never asserted."""
import argparse
import csv
import json
import platform
import subprocess
import time
from pathlib import Path


def command(args):
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rate', type=int, choices=[100, 1000, 5000], default=100)
    parser.add_argument('--limit', type=int, default=10000, help='cumulative source-line limit, including prior replays')
    args = parser.parse_args()
    run_id = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    report = dict(run_id=run_id, requested_rate=args.rate, cumulative_limit=args.limit,
                  platform=platform.platform(), cpu=platform.processor(), status='failed',
                  observed_events_per_second=None, max_lag=None,
                  note='Unavailable measurements remain null. Existing checkpoints are preserved.')
    started = time.monotonic()
    try:
        report['docker'] = command(['docker', 'info', '--format', '{{json .}}'])
        try:
            report['git_commit'] = command(['git', 'rev-parse', 'HEAD']).strip()
        except subprocess.CalledProcessError:
            report['git_commit'] = None
        report['ingestion_log'] = command(['docker', 'compose', 'exec', '-T',
            '-e', f'REPLAY_RATE={args.rate}', '-e', f'REPLAY_LIMIT={args.limit}', 'client',
            'python3', '/opt/project/scripts/parallel_ingestion.py'])
        report['ingestion_seconds'] = time.monotonic() - started
        report['verification_log'] = command(['docker', 'compose', 'exec', '-T', 'client',
            'python3', '/opt/project/scripts/verify_ingestion.py'])
        report['status'] = 'passed'
    except Exception as error:
        report['error'] = str(error)
        if isinstance(error, subprocess.CalledProcessError):
            report['failure_log'] = error.stdout + error.stderr
    report['end_to_end_seconds'] = time.monotonic() - started
    target = Path('artifacts/benchmarks')
    target.mkdir(parents=True, exist_ok=True)
    (target / (run_id + '.json')).write_text(json.dumps(report, indent=2))
    fields = ['run_id', 'requested_rate', 'cumulative_limit', 'status', 'end_to_end_seconds']
    with (target / (run_id + '.csv')).open('w', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction='ignore')
        writer.writeheader()
        writer.writerow(report)
    print(json.dumps({key: report[key] for key in fields}))
    return int(report['status'] != 'passed')


if __name__ == '__main__':
    raise SystemExit(main())
