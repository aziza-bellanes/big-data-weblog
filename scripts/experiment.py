#!/usr/bin/env python3
"""Architecture B: the Kafka HDFS writer goes down during an ingestion, nothing is lost.

Runs inside the client container in three phases; scripts/experiment-kafka-recovery.sh
pauses and resumes the writer container between them (make experiment-kafka-recovery):

    start   publish EXTRA events through the Kafka branch (a control API job)
    during  with the writer paused: Kafka keeps accepting events and the lag grows
    after   with the writer resumed: the lag drains to zero and verify_ingestion passes

The report is written to artifacts/experiments/<run id>.json.
"""
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

import architectures
import runs
from verify_ingestion import verify

ARCH = architectures.get('parallel')
API = 'http://localhost:8000'
STATE = Path('/tmp/kafka-recovery-experiment.json')
OUTPUT = Path(os.environ.get('ARTIFACT_DIR', '/opt/artifacts')) / 'experiments'
EXTRA = 60000   # events published during the experiment
RATE = 2000


def post(path, body):
    request = urllib.request.Request(API + path, data=json.dumps(body).encode(), method='POST',
                                     headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def get(path):
    with urllib.request.urlopen(API + path, timeout=10) as response:
        return json.load(response)


def sample(label):
    point = {'label': label, 'at': time.time(),
             'produced': runs.read_counter(Path(ARCH['liveDir']) / 'producer.offset'),
             'lag': runs.kafka_lag(ARCH['kafkaTopic'], ARCH['consumerGroup'])}
    print(json.dumps(point), flush=True)
    return point


def start():
    first = sample('before')
    if first['produced'] + EXTRA > get('/status')['datasetLines']:
        raise SystemExit('Recovery probe needs 60,000 unread source events; run a fresh partial ingestion first.')
    job = post('/jobs', {'action': 'ingest-kafka', 'arch': 'parallel', 'rate': RATE,
                         'limit': first['produced'] + EXTRA})
    STATE.write_text(json.dumps({'run_id': time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()),
                                 'job': job['id'], 'samples': [first]}))
    time.sleep(5)  # let the writer consume a little before it is paused
    return 0


def during():
    state = json.loads(STATE.read_text())
    state['samples'].append(sample('writer paused'))
    STATE.write_text(json.dumps(state))
    return 0


def after():
    state = json.loads(STATE.read_text())
    before, paused = state['samples'][0], state['samples'][-1]
    deadline = time.time() + 600
    while time.time() < deadline:
        job = get(f"/jobs/{state['job']}/log?after=999999")['job']
        point = sample('writer resumed')
        if job['status'] != 'running' and point['lag'] == 0:
            break
        time.sleep(5)
    state['samples'].append(point)
    report = verify()
    checks = {
        'kafka kept accepting events while the writer was down': paused['produced'] > before['produced'],
        'the lag grew while the writer was down': (paused['lag'] or 0) > (before['lag'] or 0),
        'the producer job finished': job['status'] == 'succeeded',
        'the lag drained to zero': point['lag'] == 0,
        'every branch matches its source': report['status'] == 'pass',
    }
    result = dict(state, scenario='kafka-writer-outage', checks=checks, verification=report,
                  status='PASS' if all(checks.values()) else 'FAIL')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / f"{state['run_id']}.json").write_text(json.dumps(result, indent=2))
    for name, passed in checks.items():
        print(f"{'ok  ' if passed else 'FAIL'} {name}")
    print(result['status'])
    return 0 if result['status'] == 'PASS' else 1


if __name__ == '__main__':
    phases = {'start': start, 'during': during, 'after': after}
    if len(sys.argv) != 2 or sys.argv[1] not in phases:
        sys.exit(f'usage: experiment.py {"|".join(phases)}')
    sys.exit(phases[sys.argv[1]]())
