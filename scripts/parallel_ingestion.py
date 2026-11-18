#!/usr/bin/env python3
"""Launch three independent ingress jobs and await each result without cancelling siblings."""
import os
import signal
import subprocess
import sys
import json
import threading
import time
from pathlib import Path


def main():
    project = Path(os.environ.get('PROJECT_HOME', '/opt/project'))
    commands = {
        'flume': ['bash', str(project / 'docker/bigdata/roles/replayer.sh')],
        'kafka': ['python3', str(project / 'scripts/kafka_ingestion.py'), 'produce'],
        'sqoop': ['bash', str(project / 'sqoop/import_status_codes.sh')],
    }
    run_id = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    states = {name: {'status': 'starting', 'started_at': time.time()} for name in commands}
    children = {name: subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                       text=True, errors='replace') for name, command in commands.items()}
    for state in states.values():
        state['status'] = 'running'
    lock = threading.Lock()

    def observe(name, child):
        for line in child.stdout:
            print(f'[{name}] {line.rstrip()}', flush=True)
        code = child.wait()
        with lock:
            states[name].update(status='completed' if code == 0 else 'failed', exit_code=code,
                                ended_at=time.time())

    observers = [threading.Thread(target=observe, args=(name, child)) for name, child in children.items()]
    for observer in observers:
        observer.start()

    def stop(*_):
        for child in children.values():
            if child.poll() is None:
                child.terminate()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    results = {name: child.wait() for name, child in children.items()}
    for observer in observers:
        observer.join()
    artifact = Path(os.environ.get('ARTIFACT_DIR', '/opt/artifacts')) / 'ingestion'
    artifact.mkdir(parents=True, exist_ok=True)
    (artifact / (run_id + '.json')).write_text(json.dumps({'run_id': run_id, 'branches': states}, indent=2))
    for name, code in results.items():
        print(f'{name}: {"PASS" if code == 0 else "FAIL"} (exit={code})', flush=True)
    return int(any(results.values()))


if __name__ == '__main__':
    sys.exit(main())
