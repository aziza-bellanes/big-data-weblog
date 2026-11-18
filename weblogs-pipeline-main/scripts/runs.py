"""Measurements behind the run records and the A/B comparison of the control API.

Everything here reads the running stack without changing it:
  * progress counters: replay and producer checkpoints, Flume and writer sink counters;
  * Kafka consumer lag of an architecture's topic;
  * HDFS folder summaries (WebHDFS) and files still being written;
  * a fingerprint of every MySQL result table, to tell whether two runs agree.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import architectures

RUNS_DIR = Path(os.environ.get("RUNS_DIR", "/data/runs"))
WEBHDFS = os.environ.get("HDFS_HTTP_URL", "http://hadoop:9870") + "/webhdfs/v1"
BROKERS = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
RESULT_TABLES = ("top_pages", "hits_per_hour", "hits_per_day", "status_distribution",
                 "top_hosts", "data_quality")

# HDFS sinks of each architecture, read through the Flume HTTP metrics (the Kafka HDFS
# writer answers in the same format).
SINKS = {
    "sequential": {"flume": "http://flume-agent2:34545/metrics"},
    "parallel": {"flume": "http://flume-direct:34545/metrics",
                 "kafka": "http://kafka-hdfs-writer:34545/metrics"},
}


# ---- Probes (each returns None when the component cannot be reached) ------------------------

def read_counter(path: Path) -> int:
    try:
        return int(path.read_text().strip() or 0)
    except (FileNotFoundError, ValueError):
        return 0


def sink_drained(url: str) -> int | None:
    """Flume drain count, or the Kafka writer's durable committed offset count."""
    try:
        with urllib.request.urlopen(url, timeout=3) as response:
            metrics = json.load(response)
    except (OSError, ValueError):
        return None
    return sum(int(v.get("EventDrainSuccessCount", 0)) for k, v in metrics.items() if k.startswith("SINK."))


def hdfs_summary(path: str) -> dict | None:
    try:
        with urllib.request.urlopen(f"{WEBHDFS}{path}?op=GETCONTENTSUMMARY&user.name=hadoop",
                                    timeout=5) as response:
            summary = json.load(response)["ContentSummary"]
    except (OSError, ValueError, KeyError):
        return None
    files, size = summary["fileCount"], summary["length"]
    return {"files": files, "bytes": size, "avgFileBytes": round(size / files) if files else 0}


def open_files(path: str) -> int:
    """Files a sink is still writing: their names start with "_" until they are closed."""
    listing = subprocess.run(["hdfs", "dfs", "-ls", "-R", path], capture_output=True, text=True).stdout
    return sum(1 for row in listing.splitlines()
               if row.startswith("-") and Path(row.split()[-1]).name.startswith("_"))


def kafka_lag(topic: str, group: str) -> int | None:
    try:
        from confluent_kafka import Consumer, TopicPartition
        consumer = Consumer({"bootstrap.servers": BROKERS, "group.id": group,
                             "enable.auto.commit": False})
    except Exception:
        return None
    try:
        metadata = consumer.list_topics(topic, timeout=5).topics[topic]
        partitions = [TopicPartition(topic, p) for p in metadata.partitions]
        lag = 0
        for partition in consumer.committed(partitions, timeout=5):
            low, high = consumer.get_watermark_offsets(partition, timeout=5)
            lag += max(0, high - max(low, partition.offset))
        return lag
    except Exception:
        return None
    finally:
        consumer.close()


def result_fingerprints(database: str) -> dict:
    """Row count and SHA-256 of the sorted rows of every result table."""
    import pymysql

    fingerprints = {}
    with pymysql.connect(host=os.environ.get("MYSQL_HOST", "mysql"),
                         user=os.environ.get("SQOOP_DB_USER", "sqoop"),
                         password=os.environ.get("SQOOP_DB_PASSWORD", "sqoop"),
                         database=database) as connection:
        with connection.cursor() as cursor:
            for table in RESULT_TABLES:
                cursor.execute(f"SELECT * FROM {table}")
                rows = sorted("\t".join(map(str, row)) for row in cursor.fetchall())
                fingerprints[table] = {"rows": len(rows),
                                       "sha256": hashlib.sha256("\n".join(rows).encode()).hexdigest()}
    return fingerprints


# ---- Ingestion of one architecture, from start to "everything closed in HDFS" ----------------

@dataclass
class Ingestion:
    """Samples the progress of one architecture's ingestion and decides when it has settled.

    Settled means: every line replayed during this run has been written by the HDFS sinks
    (for B, also every event produced), the Kafka lag is zero and no file is still open.
    """
    arch_name: str
    started_at: float = field(default_factory=time.time)
    samples: list = field(default_factory=list)
    replay_ended_at: float | None = None
    written_at: float | None = None   # every line written to HDFS
    closed_at: float | None = None    # every file closed, readable by Hive
    peak_lag: int = 0

    def __post_init__(self) -> None:
        self.arch = architectures.get(self.arch_name)
        self.live_dir = Path(self.arch["liveDir"])
        self.start_replayed = read_counter(self.live_dir / "access.log.offset")
        self.start_produced = read_counter(self.live_dir / "producer.offset")
        self.start_sinks = {name: sink_drained(url) or 0 for name, url in SINKS[self.arch_name].items()}

    def progress(self) -> dict:
        replayed = read_counter(self.live_dir / "access.log.offset") - self.start_replayed
        sinks = {name: (sink_drained(url) or 0) - self.start_sinks[name]
                 for name, url in SINKS[self.arch_name].items()}
        lag = kafka_lag(self.arch["kafkaTopic"], self.arch["consumerGroup"])
        point = {"t": round(time.time() - self.started_at, 1), "replayed": replayed,
                 "inHdfs": max(0, sinks["flume"]), "lag": lag}
        if "kafka" in sinks:
            point["produced"] = read_counter(self.live_dir / "producer.offset") - self.start_produced
            point["eventsInHdfs"] = max(0, sinks["kafka"])
        self.peak_lag = max(self.peak_lag, lag or 0)
        return point

    def sample(self) -> dict:
        point = self.progress()
        self.samples.append(point)
        return point

    def all_written(self, point: dict) -> bool:
        done = point["inHdfs"] >= point["replayed"] > 0 and point["lag"] == 0
        if "produced" in point:
            done = done and point["eventsInHdfs"] >= point["produced"]
        return done

    def settle(self, timeout: float, log, on_sample=None) -> bool:
        """After the replay: wait until every line is in HDFS, then until every file is closed."""
        self.replay_ended_at = self.replay_ended_at or time.time()
        deadline = time.time() + timeout
        while time.time() < deadline:
            point = self.sample()
            if on_sample is not None:
                on_sample(point)
            if self.written_at is None and self.all_written(point):
                self.written_at = time.time()
                log(f"every line is in HDFS ({point['inHdfs']:,} lines); waiting for the files to close")
            if self.written_at is not None and open_files(self.arch["rawDir"]) == 0:
                self.closed_at = time.time()
                log("every HDFS file is closed")
                return True
            time.sleep(5)
        return False

    def summary(self) -> dict:
        last = self.samples[-1] if self.samples else self.progress()
        seconds = lambda end: None if end is None else round(end - self.started_at, 1)
        written = seconds(self.written_at)
        result = {
            "lines": last["replayed"],
            "replaySeconds": seconds(self.replay_ended_at),
            "allWrittenSeconds": written,
            "allClosedSeconds": seconds(self.closed_at),
            "linesPerSecond": round(last["replayed"] / written) if written else None,
            "peakKafkaLag": self.peak_lag,
            "raw": hdfs_summary(self.arch["rawDir"]),
            "samples": self.samples,
        }
        if self.arch["eventsDir"]:
            result["events"] = hdfs_summary(self.arch["eventsDir"])
            result["eventsProduced"] = last.get("produced")
        return result


# ---- Records ---------------------------------------------------------------------------------

def save(record: dict) -> None:
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    temporary = RUNS_DIR / f".{record['id']}.json"
    temporary.write_text(json.dumps(record, indent=1))
    temporary.replace(RUNS_DIR / f"{record['id']}.json")


def load_all(limit: int = 20) -> list[dict]:
    """Most recent records first; the samples are left out of the listing."""
    paths = sorted(RUNS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:limit]
    records = []
    for path in paths:
        try:
            records.append(strip_samples(json.loads(path.read_text())))
        except (OSError, ValueError):
            continue
    return records


def load(record_id: str) -> dict | None:
    if not record_id.replace("-", "").isalnum():
        return None
    path = RUNS_DIR / f"{record_id}.json"
    return json.loads(path.read_text()) if path.exists() else None


def strip_samples(record: dict) -> dict:
    copy = json.loads(json.dumps(record))
    for run in (copy.get("architectures") or {}).values():
        (run.get("ingestion") or {}).pop("samples", None)
    return copy


def results_match(left: dict, right: dict) -> dict:
    return {table: left.get(table) == right.get(table) for table in RESULT_TABLES}
