#!/usr/bin/env python3
"""Architecture B: reconcile each ingestion branch with its source. Unknown never passes.

    flume  the lines in closed HDFS files are exactly the lines of the live log
    kafka  every acknowledged event ID is in HDFS once or more, and the consumer lag is 0
    sqoop  the HDFS reference copy has exactly the rows of the MySQL table
"""
import argparse
import hashlib
import json
import os
import sqlite3
import subprocess
import tempfile
import time
from collections import Counter
from pathlib import Path

import architectures
from events import CLF, records, source_files

ARCH = architectures.get('parallel')
ZONES = {'flume': ARCH['rawDir'], 'kafka': ARCH['eventsDir'], 'sqoop': ARCH['referenceDir']}
LIVE_LOG = Path(ARCH['liveLog'])
PRODUCER_OFFSET = Path(ARCH['liveDir']) / 'producer.offset'


def lines(zone):
    listing = subprocess.run(['hdfs', 'dfs', '-ls', '-R', ZONES[zone]],
                             check=True, capture_output=True, text=True).stdout
    paths = []
    for row in listing.splitlines():
        if not row.startswith('-'):
            continue
        path = row.split()[-1]
        if Path(path).name.startswith(('_', '.')):
            if '_weblogs' in path or '_inprogress' in path:
                # Kafka crash debris is hidden and does not represent committed data.
                if zone == 'flume':
                    raise ValueError('Flume files are still open')
            continue
        paths.append(path)
    if not paths:
        raise ValueError(f'No closed files in {zone}')
    # Stream many files through each JVM, keeping argv bounded for older runs
    # that contain thousands of small files.
    for start in range(0, len(paths), 200):
        batch = paths[start:start + 200]
        process = subprocess.Popen(['hdfs', 'dfs', '-cat', *batch], stdout=subprocess.PIPE)
        try:
            for raw in process.stdout:
                yield raw.rstrip(b'\r\n')
        finally:
            process.stdout.close()
            if process.wait():
                raise ValueError(f'Cannot read HDFS {zone} batch')


def verify():
    report = {'run_id': time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()),
              'observed_at': time.time(), 'source': 'closed HDFS files, checkpoints and MySQL',
              'flume': None, 'kafka': None, 'sqoop': None, 'errors': []}
    try:
        expected = int(Path(f'{LIVE_LOG}.offset').read_text())
        source = Counter()
        with open(LIVE_LOG, 'rb') as stream:
            for line in stream:
                source[hashlib.sha256(line.rstrip(b'\r\n')).digest()] += 1
        output, malformed = Counter(), 0
        for raw in lines('flume'):
            output[hashlib.sha256(raw).digest()] += 1
            malformed += CLF.fullmatch(raw.decode('latin-1')) is None
        report['flume'] = dict(input_lines=expected, closed_hdfs_lines=sum(output.values()),
                               malformed=malformed, content_matches=source == output)
        if expected <= 0 or sum(source.values()) != expected or source != output:
            raise ValueError('Canonical raw content/count mismatch')
    except Exception as exc:
        report['errors'].append(f'flume: {exc}')
    try:
        expected = int(PRODUCER_OFFSET.read_text())
        with tempfile.TemporaryDirectory() as directory:
            db = sqlite3.connect(str(Path(directory) / 'ids.db'))
            db.execute('CREATE TABLE ids (id TEXT PRIMARY KEY)')
            physical = malformed = 0
            for raw in lines('kafka'):
                value = json.loads(raw)
                db.execute('INSERT OR IGNORE INTO ids VALUES (?)', (value['event_id'],))
                physical += 1
                malformed += bool(value.get('parse_error'))
            unique = db.execute('SELECT COUNT(*) FROM ids').fetchone()[0]
            # Compare actual source identities, including missing/unexpected IDs.
            missing = 0
            for index, value in enumerate(records(source_files('/data/input'))):
                if index >= expected:
                    break
                missing += db.execute('SELECT 1 FROM ids WHERE id=?', (value['event_id'],)).fetchone() is None
            db.close()
        from confluent_kafka import Consumer, TopicPartition
        topic = ARCH['kafkaTopic']
        consumer = Consumer({'bootstrap.servers': os.environ.get('KAFKA_BOOTSTRAP_SERVERS', 'kafka:9092'),
                             'group.id': ARCH['consumerGroup'], 'enable.auto.commit': False})
        try:
            metadata = consumer.list_topics(topic, timeout=10).topics[topic]
            if metadata.error:
                raise RuntimeError(metadata.error)
            committed = consumer.committed([TopicPartition(topic, p) for p in metadata.partitions], timeout=10)
            offsets = []
            for partition in committed:
                low, high = consumer.get_watermark_offsets(partition, timeout=10)
                position = max(low, partition.offset)
                offsets.append(dict(partition=partition.partition, committed=position, end=high,
                                    lag=max(0, high-position)))
        finally:
            consumer.close()
        lag = sum(p['lag'] for p in offsets)
        report['kafka'] = dict(acknowledged_events=expected, hdfs_physical_rows=physical,
                               unique_event_ids=unique, duplicates=physical-unique,
                               missing_event_ids=missing, malformed_physical_rows=malformed,
                               consumer_lag=lag, offsets=offsets)
        if expected <= 0 or unique != expected or missing or lag:
            raise ValueError('Kafka logical event IDs do not match acknowledged source')
    except Exception as exc:
        report['errors'].append(f'kafka: {exc}')
    try:
        import pymysql
        with pymysql.connect(host=os.environ.get('MYSQL_HOST', 'mysql'),
                             user=os.environ.get('SQOOP_DB_USER', 'sqoop'),
                             password=os.environ.get('SQOOP_DB_PASSWORD', 'sqoop'),
                             database=ARCH['mysqlDb']) as connection:
            with connection.cursor() as cursor:
                cursor.execute('SELECT code,label,category FROM status_codes')
                source = Counter('\t'.join(map(str, row)) for row in cursor.fetchall())
        target = Counter(raw.decode() for raw in lines('sqoop'))
        report['sqoop'] = dict(mysql_rows=sum(source.values()), hdfs_rows=sum(target.values()),
                               content_matches=source == target)
        if not source or source != target:
            raise ValueError('Sqoop reference content mismatch')
    except Exception as exc:
        report['errors'].append(f'sqoop: {exc}')
    report['status'] = 'fail' if report['errors'] else 'pass'
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--wait', type=int, default=180, help='wait for rollover/consumer drain')
    args = parser.parse_args()
    deadline = time.monotonic() + args.wait
    while True:
        report = verify()
        if report['status'] == 'pass' or time.monotonic() >= deadline:
            break
        print(json.dumps({'waiting': report['errors']}), flush=True)
        time.sleep(5)
    output = Path(os.environ.get('ARTIFACT_DIR', '/opt/artifacts')) / 'verification'
    output.mkdir(parents=True, exist_ok=True)
    (output / (report['run_id'] + '.json')).write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return int(report['status'] != 'pass')


if __name__ == '__main__':
    raise SystemExit(main())
