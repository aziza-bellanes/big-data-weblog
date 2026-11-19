#!/usr/bin/env python3
"""Kafka branch: structured events from the NASA files to Kafka, and an archive in HDFS.

    produce  read the source files, turn every line into a JSON event (events.py) and
             publish it to Kafka with an idempotent producer (acks=all); progress is
             checkpointed only after Kafka acknowledged the batch.
    consume  read Kafka in batches, write each batch to HDFS as a closed file per day,
             then commit the offsets: at-least-once delivery, duplicates are removed by
             event_id in Hive (kafka_events_unique).

The topic has a second consumer, the Spark speed layer (spark_speed_layer.py).
"""
import argparse
import fcntl
import hashlib
import json
import os
import re
import subprocess
import tempfile
import threading
import time
import uuid
from collections import defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import architectures
from events import records, source_files
from replay import StopFlag, load_state, save_state

ARCH = architectures.get('parallel')
ROOT = ARCH['eventsDir']
STATE_DIR = Path(ARCH['liveDir'])
CHECKPOINT = STATE_DIR / 'producer.offset'
EVENT_DATE = re.compile(r'1995-\d{2}-\d{2}|unknown')
FLUSH_EVERY = 500  # events per acknowledged producer batch


def hdfs(*args):
    return subprocess.run(['hdfs', 'dfs', *args], check=True, capture_output=True)


def publish(messages):
    """Closed files become visible before Kafka offsets advance. Retries may duplicate IDs."""
    grouped = defaultdict(list)
    for message in messages:
        raw = message.value().decode('utf-8')
        value = json.loads(raw)
        dt = value.get('dt', 'unknown')
        if not EVENT_DATE.fullmatch(dt):
            raise ValueError(f'Unsafe or unexpected event date: {dt}')
        grouped[dt].append(raw)
    for dt, rows in grouped.items():
        directory = f'{ROOT}/dt={dt}'
        name = uuid.uuid4().hex
        temporary = f'{directory}/_inprogress-{name}'
        final = f'{directory}/part-{name}.jsonl'
        hdfs('-mkdir', '-p', directory)
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8') as local:
            local.write('\n'.join(rows) + '\n')
            local.flush()
            hdfs('-put', local.name, temporary)
        hdfs('-mv', temporary, final)


def persist_and_commit(consumer, batch):
    from confluent_kafka import TopicPartition
    publish(batch)
    offsets = {}
    for message in batch:
        offsets[(message.topic(), message.partition())] = message.offset() + 1
    consumer.commit(offsets=[TopicPartition(t, p, o) for (t, p), o in offsets.items()],
                    asynchronous=False)
    return offsets


def produce(args):
    from confluent_kafka import Producer
    producer = Producer({'bootstrap.servers': args.brokers, 'enable.idempotence': True,
                         'acks': 'all', 'delivery.timeout.ms': 120000})
    checkpoint = CHECKPOINT
    written = load_state(checkpoint)
    # Checkpoint reuse against another dataset must fail instead of skipping input.
    files = source_files('/data/input')
    digest = hashlib.sha256()
    for path in files:
        digest.update(path.name.encode())
        with path.open('rb') as source:
            for block in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(block)
    fingerprint = checkpoint.with_suffix('.dataset')
    identity = json.dumps({'dataset': digest.hexdigest(), 'topic': args.topic, 'brokers': args.brokers}, sort_keys=True)
    if fingerprint.exists() and fingerprint.read_text() != identity:
        raise ValueError('Producer checkpoint belongs to another dataset/topic; run make reset ARCH=parallel')
    fingerprint.write_text(identity)
    stop = StopFlag()
    start, session = time.monotonic(), 0
    pending, errors = [], []

    def delivered(error, _message):
        if error:
            errors.append(str(error))

    def flush():
        nonlocal written
        if producer.flush(130) or errors:
            raise RuntimeError(f'Kafka delivery failed: {errors}')
        written += len(pending)
        save_state(checkpoint, written)
        pending.clear()
        print(json.dumps({'acknowledged_events': written, 'observed_at': time.time()}), flush=True)

    for index, value in enumerate(records(files)):
        if index < written:
            continue
        if stop.stopped or (args.limit and index >= args.limit):
            break
        while True:
            try:
                producer.produce(args.topic, key=value['event_id'],
                                 value=json.dumps(value).encode(), on_delivery=delivered)
                break
            except BufferError:
                producer.poll(0.1)
        pending.append(value['event_id'])
        producer.poll(0)
        session += 1
        if len(pending) >= FLUSH_EVERY:
            flush()
        if args.rate:
            time.sleep(max(0, start + session / args.rate - time.monotonic()))
    flush()


def consume(args):
    from confluent_kafka import Consumer, TopicPartition
    metrics = {'events': 0, 'batches': 0, 'observed_at': time.time()}

    class MetricsHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            payload = json.dumps({'SINK.hdfs': {'EventDrainSuccessCount': metrics['events']},
                                  'writer': dict(metrics, source='closed HDFS files and synchronous Kafka commits')}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_):
            pass

    consumer = Consumer({'bootstrap.servers': args.brokers, 'group.id': ARCH['consumerGroup'],
                         'enable.auto.commit': False, 'enable.auto.offset.store': False,
                         'auto.offset.reset': 'earliest', 'max.poll.interval.ms': 900000})
    # Absolute committed positions survive a process restart. A process-local event
    # counter would reset to zero and leave an in-flight run waiting forever.
    metadata = consumer.list_topics(args.topic, timeout=30).topics[args.topic]
    if metadata.error:
        raise RuntimeError(metadata.error)
    committed = consumer.committed([TopicPartition(args.topic, p) for p in metadata.partitions], timeout=30)
    positions = {(p.topic, p.partition): max(0, p.offset) for p in committed}
    metrics['events'] = sum(positions.values())
    consumer.subscribe([args.topic])
    server = ThreadingHTTPServer(('0.0.0.0', 34545), MetricsHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    stop = StopFlag()
    try:
        while not stop.stopped:
            # One HDFS CLI launch starts a JVM. Amortise that cost across a larger
            # bounded batch rather than launching several JVMs per 1,000 events.
            batch = consumer.consume(num_messages=args.batch_size, timeout=2)
            if not batch:
                continue
            for message in batch:
                if message.error():
                    raise RuntimeError(message.error())
            positions.update(persist_and_commit(consumer, batch))
            metrics.update(events=sum(positions.values()), batches=metrics['batches'] + 1,
                           observed_at=time.time())
            print(json.dumps({'persisted_batch': len(batch), 'observed_at': time.time()}), flush=True)
    finally:
        consumer.close()
        server.shutdown()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['produce', 'consume'])
    parser.add_argument('--brokers', default=os.environ.get('KAFKA_BOOTSTRAP_SERVERS', 'kafka:9092'))
    parser.add_argument('--topic', default=ARCH['kafkaTopic'])
    parser.add_argument('--rate', type=int, default=int(os.environ.get('REPLAY_RATE', '500')))
    parser.add_argument('--limit', type=int, default=int(os.environ.get('REPLAY_LIMIT', '0')))
    parser.add_argument('--batch-size', type=int, default=50000)
    args = parser.parse_args()
    if args.rate < 0 or args.limit < 0:
        parser.error('rate and limit must be nonnegative')
    if args.batch_size <= 0:
        parser.error('batch size must be positive')
    if args.mode == 'produce':
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        with open(STATE_DIR / 'producer.lock', 'w') as guard:
            fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
            produce(args)
    else:
        consume(args)
