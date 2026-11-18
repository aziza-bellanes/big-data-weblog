#!/usr/bin/env python3
"""Host-side writer-outage experiment. Requires active Flume/Kafka replay and a running dashboard."""
import json
import subprocess
import time
import urllib.request
from pathlib import Path


def snapshot():
    with urllib.request.urlopen('http://localhost:3030/api/pipeline', timeout=15) as response:
        return json.load(response)


def run():
    report = {'run_id': time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()),
              'scenario': 'kafka-writer-outage', 'status': 'INCONCLUSIVE', 'samples': []}
    paused = False
    try:
        state = subprocess.run(['docker', 'compose', 'ps', '--format', 'json', 'kafka-hdfs-writer'],
                               check=True, capture_output=True, text=True).stdout
        if 'running' not in state.lower():
            raise ValueError('Start the writer and both replays before this experiment')
        report['samples'].append(snapshot())
        subprocess.run(['docker', 'compose', 'pause', 'kafka-hdfs-writer'], check=True)
        paused = True
        time.sleep(15)
        report['samples'].append(snapshot())
        subprocess.run(['docker', 'compose', 'unpause', 'kafka-hdfs-writer'], check=True)
        paused = False
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            current = snapshot()
            report['samples'].append(current)
            if current['kafka']['state'] != 'down' and current['kafka']['consumerLag'] == 0:
                break
            time.sleep(5)
        before, during, after = report['samples'][0], report['samples'][1], report['samples'][-1]
        grew = during['kafka']['consumerLag'] > before['kafka']['consumerLag']
        independent = during['agent1']['eventsOut'] > before['agent1']['eventsOut']
        if not grew or not independent:
            raise ValueError('Insufficient concurrent traffic to demonstrate lag growth and Flume isolation')
        check = subprocess.run(['docker', 'compose', 'exec', '-T', 'client', 'python3',
                                '/opt/project/scripts/verify_ingestion.py'], capture_output=True, text=True)
        report['verification'] = check.stdout + check.stderr
        report['status'] = 'PASS' if check.returncode == 0 and after['kafka']['consumerLag'] == 0 else 'FAIL'
    except Exception as error:
        report['error'] = str(error)
    finally:
        if paused:
            subprocess.run(['docker', 'compose', 'unpause', 'kafka-hdfs-writer'], check=False)
        target = Path('artifacts/experiments')
        target.mkdir(parents=True, exist_ok=True)
        (target / (report['run_id'] + '.json')).write_text(json.dumps(report, indent=2))
    print(report['status'])
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(run())
