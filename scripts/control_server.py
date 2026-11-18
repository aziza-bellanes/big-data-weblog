#!/usr/bin/env python3
"""Run pipeline steps on request, for the web dashboard.

Runs inside the client container, which already has Hadoop, Hive, Sqoop and the Kafka
client, and the project mounted. It exposes a small JSON API on the compose network only
(never published to the host):

    GET  /health                     liveness probe
    GET  /status                     running jobs, recent jobs, dataset size
    POST /jobs        {"action": …, "arch": …}   start a job
    GET  /jobs/<id>/log?after=<seq>  log lines newer than <seq>
    POST /jobs/<id>/cancel           stop a running job
    GET  /runs                       recent run and comparison records
    GET  /runs/<id>                  one record, with its progress samples

A job is an ordered list of steps. Most steps run one of the project's own scripts, the
same ones the Makefile runs; the ingestion and comparison steps also measure the run
(scripts/runs.py) and every replay, pipeline and comparison leaves a record in /data/runs.

Jobs of the two architectures never block each other; within one architecture, a job
waits for nothing but is refused (409) while another job uses the same resource.
"""
from __future__ import annotations

import gzip
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable
from urllib.parse import parse_qs, urlparse

import architectures
import runs

PROJECT = Path(os.environ.get("PROJECT_HOME", "/opt/project"))
INPUT_DIR = Path("/data/input")
PORT = int(os.environ.get("CONTROL_PORT", "8000"))

LOG_CAPACITY = 3000          # lines kept per job
HISTORY = 8                  # finished jobs kept in memory
REPLAY_ACTIVE_WINDOW = 3.0   # seconds; a fresher checkpoint means a replay is running
SAMPLE_EVERY = 2.0           # seconds between progress samples during an ingestion
SETTLE_TIMEOUT = 900         # seconds allowed for HDFS to catch up after a replay
MAX_BODY = 8192
NOISE = re.compile(r"^SLF4J:|^\s*$")

ARCHS = tuple(architectures.ARCHITECTURES)
RATES = {100, 500, 1000, 2000, 5000, 10000, 20000}


def log(message: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} [INFO]  {message}", flush=True)


def _script(*parts: str) -> str:
    return str(PROJECT.joinpath(*parts))


def _ms(t: float | None) -> int | None:
    return None if t is None else int(t * 1000)


# ---- Steps -----------------------------------------------------------------------------------

@dataclass(frozen=True)
class Step:
    """One unit of work: a script (`command`) or an in-process measurement (`run`)."""
    key: str
    label: str
    command: list[str] = field(default_factory=list)
    arch: str | None = None
    env: tuple[tuple[str, str], ...] = ()
    run: Callable[["Job", "Step"], int] | None = field(default=None, compare=False)

    @property
    def shown_as(self) -> str:
        """The equivalent make command (or what is measured), echoed at the top of the step's log."""
        if not self.command:
            return f"# {self.label}"
        return f"make {self.key}" + (f" ARCH={self.arch}" if self.arch else "")


HIVE_FILES = {
    "sequential": ["hive/01_create_tables.sql"],
    "parallel": ["hive/01_create_tables.sql", "hive/03_kafka_events.sql"],
}
BATCH_KEYS = ("hive-tables", "sqoop-import", "hive-analysis", "sqoop-export")


def script_step(key: str, arch: str, label: str, command: list[str], **env: str) -> Step:
    return Step(key, label, command, arch, tuple(dict(env, ARCH=arch).items()))


def batch_step(key: str, arch: str) -> Step:
    hive = ["bash", _script("scripts/run-hive.sh")]
    commands = {
        "hive-tables": ("Create Hive tables", hive + [_script(f) for f in HIVE_FILES[arch]]),
        "sqoop-import": ("Sqoop import of status_codes", ["bash", _script("sqoop/import_status_codes.sh")]),
        "hive-analysis": ("Hive analysis", hive + [_script("hive/02_analysis.sql")]),
        "sqoop-export": ("Sqoop export to MySQL", ["bash", _script("sqoop/export_results.sh")]),
        "counts": ("No-loss check", ["bash", _script("scripts/check-counts.sh")]),
        "verify-ingestion": ("Check every branch against its source",
                             ["python3", _script("scripts/verify_ingestion.py")]),
        "reset": ("Empty this architecture's data", ["python3", _script("scripts/reset_architecture.py"), arch]),
    }
    label, command = commands[key]
    return script_step(key, arch, label, command)


def replay_command(arch: str) -> list[str]:
    """A replays into its live log; B starts its three branches (Flume, Kafka, Sqoop) at once."""
    if arch == "sequential":
        return ["bash", _script("docker/bigdata/roles/replayer.sh")]
    return ["python3", _script("scripts/parallel_ingestion.py")]


def ingest_step(arch: str, rate: int, limit: int) -> Step:
    label = f"{architectures.get(arch)['label']}: replay at {rate:,} lines/s"
    return Step("replay", label, replay_command(arch), arch,
                (("ARCH", arch), ("REPLAY_RATE", str(rate)), ("REPLAY_LIMIT", str(limit))),
                run=run_ingestion)


def branch_step(key: str, rate: int, limit: int) -> Step:
    """One branch of architecture B on its own."""
    commands = {
        "ingest-flume": ("Flume branch: replay into the live log", ["bash", _script("docker/bigdata/roles/replayer.sh")]),
        "ingest-kafka": ("Kafka branch: publish JSON events", ["python3", _script("scripts/kafka_ingestion.py"), "produce"]),
        "ingest-sqoop": ("Sqoop branch: import status_codes", ["bash", _script("sqoop/import_status_codes.sh")]),
    }
    label, command = commands[key]
    return script_step(key, "parallel", label, command, REPLAY_RATE=str(rate), REPLAY_LIMIT=str(limit))


# Batch part of each architecture. In B the Sqoop import is one of the three ingestion
# branches, so its batch part checks the branches against their sources instead.
PIPELINES = {
    "sequential": ("hive-tables", "sqoop-import", "hive-analysis", "sqoop-export"),
    "parallel": ("hive-tables", "verify-ingestion", "hive-analysis", "sqoop-export"),
}


def pipeline_steps(arch: str) -> list[Step]:
    return [batch_step(key, arch) for key in PIPELINES[arch]]


def fingerprint_step(arch: str) -> Step:
    return Step("fingerprint", "Fingerprint the MySQL results", arch=arch, run=run_fingerprint)


def compare_steps(rate: int, limit: int, fresh: bool) -> list[Step]:
    """A then B on the same lines at the same rate, each measured from replay to MySQL."""
    steps = [batch_step("reset", arch) for arch in ARCHS] if fresh else []
    for arch in ("sequential", "parallel"):
        steps += [ingest_step(arch, rate, limit), batch_step("counts", arch),
                  *pipeline_steps(arch), fingerprint_step(arch)]
    return steps + [Step("compare", "Compare the two runs", run=run_comparison)]


def replay_running(arch: str) -> bool:
    checkpoint = Path(architectures.get(arch)["liveDir"]) / "access.log.offset"
    try:
        return time.time() - checkpoint.stat().st_mtime < REPLAY_ACTIVE_WINDOW
    except FileNotFoundError:
        return False


# ---- Jobs ------------------------------------------------------------------------------------

@dataclass
class StepState:
    step: Step
    status: str = "pending"  # pending | running | succeeded | failed | cancelled | skipped
    started_at: float | None = None
    ended_at: float | None = None
    exit_code: int | None = None

    @property
    def seconds(self) -> float | None:
        if self.started_at is None or self.ended_at is None:
            return None
        return round(self.ended_at - self.started_at, 1)

    def to_json(self) -> dict:
        return {"key": self.step.key, "label": self.step.label, "arch": self.step.arch,
                "status": self.status, "startedAt": _ms(self.started_at),
                "endedAt": _ms(self.ended_at), "exitCode": self.exit_code}


@dataclass
class Job:
    action: str
    arch: str | None
    steps: list[StepState]
    params: dict = field(default_factory=dict)
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    status: str = "running"  # running | succeeded | failed | cancelled
    created_at: float = field(default_factory=time.time)
    ended_at: float | None = None
    lines: deque = field(default_factory=lambda: deque(maxlen=LOG_CAPACITY))
    next_seq: int = 0
    process: subprocess.Popen | None = None
    cancel_requested: bool = False
    # Measurements per architecture, kept in the run record.
    results: dict = field(default_factory=dict)
    progress: dict | None = None  # latest ingestion sample, shown live by the dashboard
    lock: threading.Lock = field(default_factory=threading.Lock)

    def append(self, text: str) -> None:
        with self.lock:
            self.lines.append((self.next_seq, text))
            self.next_seq += 1

    def log_after(self, after: int) -> list[dict]:
        with self.lock:
            return [{"seq": seq, "text": text} for seq, text in self.lines if seq > after]

    def arch_results(self, arch: str) -> dict:
        return self.results.setdefault(arch, {})

    def to_json(self) -> dict:
        return {"id": self.id, "action": self.action, "arch": self.arch, "params": self.params,
                "status": self.status, "createdAt": _ms(self.created_at),
                "endedAt": _ms(self.ended_at), "steps": [s.to_json() for s in self.steps],
                "progress": self.progress, "lastSeq": self.next_seq - 1}

    def record(self) -> dict:
        """What is saved in /data/runs once the job ends."""
        record = {"id": self.id, "kind": "comparison" if self.action == "compare" else "run",
                  "action": self.action, "arch": self.arch, "params": self.params,
                  "status": self.status, "createdAt": _ms(self.created_at),
                  "endedAt": _ms(self.ended_at), "architectures": {}}
        for arch in ARCHS:
            states = [s for s in self.steps if s.step.arch == arch]
            if not states:
                continue
            entry = dict(self.arch_results(arch))
            entry["steps"] = {s.step.key: s.seconds for s in states if s.seconds is not None}
            batch = [s.seconds for s in states if s.step.key in BATCH_KEYS + ("verify-ingestion",)]
            entry["batchSeconds"] = round(sum(b for b in batch if b), 1) if any(batch) else None
            record["architectures"][arch] = entry
        if "comparison" in self.results:
            record["comparison"] = self.results["comparison"]
        return record


# ---- Step bodies -----------------------------------------------------------------------------

def run_process(job: Job, step: Step) -> int:
    """Run the step's script in its own process group, streaming its output to the job log."""
    env = dict(os.environ, **dict(step.env))
    process = subprocess.Popen(step.command, cwd=PROJECT, env=env, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, text=True, errors="replace", bufsize=1,
                               start_new_session=True)
    job.process = process
    if job.cancel_requested:
        stop_process(process)
    assert process.stdout is not None
    for line in process.stdout:
        line = line.rstrip()
        if not NOISE.search(line):
            job.append(line)
    return process.wait()


def stop_process(process: subprocess.Popen) -> None:
    if process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


def run_ingestion(job: Job, step: Step) -> int:
    """Replay, sampling the progress, then wait until HDFS holds every line in closed files."""
    ingestion = runs.Ingestion(step.arch)
    finished = threading.Event()

    def sample() -> None:
        while not finished.wait(SAMPLE_EVERY):
            job.progress = dict(ingestion.sample(), arch=step.arch, phase="replay")

    sampler = threading.Thread(target=sample, daemon=True)
    sampler.start()
    try:
        code = run_process(job, step)
    finally:
        finished.set()
        sampler.join()
    ingestion.replay_ended_at = time.time()
    if code != 0 or job.cancel_requested:
        return code or 1
    job.append(f"replay finished; waiting until HDFS holds every line (at most {SETTLE_TIMEOUT // 60} min)")
    job.progress = dict(ingestion.progress(), arch=step.arch, phase="settle")
    def settling(point: dict) -> None:
        job.progress = dict(point, arch=step.arch, phase="settle")

    settled = ingestion.settle(SETTLE_TIMEOUT, job.append, on_sample=settling)
    job.arch_results(step.arch)["ingestion"] = ingestion.summary()
    job.progress = None
    if not settled:
        job.append("HDFS did not catch up in time; the run record keeps the last sample")
        return 1
    summary = job.arch_results(step.arch)["ingestion"]
    job.append(f"{summary['lines']:,} lines in HDFS after {summary['allWrittenSeconds']} s, "
               f"files closed after {summary['allClosedSeconds']} s")
    return 0


def run_fingerprint(job: Job, step: Step) -> int:
    database = architectures.get(step.arch)["mysqlDb"]
    fingerprints = runs.result_fingerprints(database)
    job.arch_results(step.arch)["results"] = fingerprints
    for table, value in fingerprints.items():
        job.append(f"{database}.{table}: {value['rows']} rows, sha256 {value['sha256'][:12]}")
    return 0


def run_comparison(job: Job, _step: Step) -> int:
    a, b = (job.arch_results(arch) for arch in ("sequential", "parallel"))
    match = runs.results_match(a.get("results", {}), b.get("results", {}))
    job.results["comparison"] = {"resultsMatch": match, "allResultsMatch": all(match.values())}
    for table, same in match.items():
        job.append(f"{table:<20} {'identical' if same else 'DIFFERENT'}")
    return 0 if all(match.values()) else 1


# ---- Runner ----------------------------------------------------------------------------------

class Conflict(Exception):
    pass


# Resources each job holds while it runs. A and B share none, so they never block each other.
BRANCHES = {"ingest-flume": "par-flume", "ingest-kafka": "par-kafka", "ingest-sqoop": "par-sqoop"}


def resources(action: str, arch: str | None) -> set[str]:
    if action == "compare":
        return {"seq-ingest", "seq-batch", "par-flume", "par-kafka", "par-sqoop", "par-batch"}
    if arch == "sequential":
        return {"replay": {"seq-ingest"}, "reset": {"seq-ingest", "seq-batch"}}.get(action, {"seq-batch"})
    if action in BRANCHES:
        return {BRANCHES[action]}
    if action == "replay":
        return {"par-flume", "par-kafka", "par-sqoop"}
    if action == "reset":
        return {"par-flume", "par-kafka", "par-sqoop", "par-batch"}
    if action == "sqoop-import":
        return {"par-sqoop"}
    return {"par-batch"}


INGESTING = {"replay", "reset", "compare", *BRANCHES}
RECORDED = {"replay", "pipeline", "compare"}


class Runner:
    """Runs jobs in background threads; jobs sharing a resource are refused, not queued."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.active: dict[str, Job] = {}
        self.history: deque[Job] = deque(maxlen=HISTORY)

    def find(self, job_id: str) -> Job | None:
        with self._lock:
            jobs = list(self.active.values()) + list(self.history)
        return next((j for j in jobs if j.id == job_id), None)

    def start(self, action: str, arch: str | None, steps: list[Step], params: dict | None = None) -> Job:
        wanted = resources(action, arch)
        with self._lock:
            busy = [job for job in self.active.values() if wanted & resources(job.action, job.arch)]
            if busy:
                raise Conflict(f"'{busy[0].action}' is still running for the same architecture")
            if action in INGESTING:
                for name in (ARCHS if action == "compare" else (arch,)):
                    if replay_running(name):
                        raise Conflict(f"a replay started outside the dashboard is running for {name}")
            job = Job(action, arch, [StepState(s) for s in steps], params or {})
            self.active[job.id] = job
        threading.Thread(target=self._run, args=(job,), daemon=True).start()
        log(f"job {job.id} started: {action} {arch or ''}".rstrip())
        return job

    def cancel(self, job: Job) -> None:
        job.cancel_requested = True
        if job.process:
            stop_process(job.process)

    def _run(self, job: Job) -> None:
        for state in job.steps:
            if job.status != "running":
                state.status = "skipped"  # an earlier step failed or was cancelled
                continue
            try:
                self._run_step(job, state)
            except Exception as error:
                job.append(f"error: {error}")
                state.status, state.ended_at = "failed", time.time()
            if state.status != "succeeded":
                job.status = state.status
        if job.status == "running":
            job.status = "succeeded"
        job.ended_at = time.time()
        job.progress = None
        if job.action in RECORDED:
            try:
                runs.save(job.record())
            except OSError as error:
                job.append(f"could not save the run record: {error}")
        log(f"job {job.id} {job.status}")
        with self._lock:
            self.history.appendleft(job)
            self.active.pop(job.id, None)

    @staticmethod
    def _run_step(job: Job, state: StepState) -> None:
        if job.cancel_requested:
            state.status = "cancelled"
            return
        state.status, state.started_at = "running", time.time()
        job.append(f"$ {state.step.shown_as}")
        body = state.step.run or run_process
        state.exit_code = body(job, state.step)
        state.ended_at = time.time()
        if job.cancel_requested:
            state.status = "cancelled"
        else:
            state.status = "succeeded" if state.exit_code == 0 else "failed"


# ---- Requests --------------------------------------------------------------------------------

class BadRequest(Exception):
    pass


SINGLE = ("hive-tables", "sqoop-import", "hive-analysis", "sqoop-export", "counts", "reset")


def plan(body: dict) -> tuple[str, str | None, list[Step], dict]:
    """Turn a request body into (action, arch, steps, params), or raise BadRequest."""
    action = body.get("action")
    arch = body.get("arch", architectures.DEFAULT)
    rate, limit = body.get("rate", 5000), body.get("limit", 0)
    if not isinstance(action, str) or not isinstance(arch, str):
        raise BadRequest("action and arch must be strings")
    if action == "compare":
        arch = None
    elif arch not in ARCHS:
        raise BadRequest(f"arch must be one of {', '.join(ARCHS)}")
    if action in ("replay", "compare", *BRANCHES):
        integers = all(isinstance(v, int) and not isinstance(v, bool) for v in (rate, limit))
        if not integers or rate not in RATES or limit < 0:
            raise BadRequest(f"rate must be one of {sorted(RATES)}, limit an integer >= 0")
    if action == "compare":
        fresh = body.get("fresh", True) is True
        return action, None, compare_steps(rate, limit, fresh), {"rate": rate, "limit": limit, "fresh": fresh}
    if action == "replay":
        return action, arch, [ingest_step(arch, rate, limit)], {"rate": rate, "limit": limit}
    if action == "pipeline":
        return action, arch, pipeline_steps(arch), {}
    if action in SINGLE:
        return action, arch, [batch_step(action, arch)], {}
    if action in BRANCHES or action == "verify-ingestion":
        if arch != "parallel":
            raise BadRequest(f"{action} belongs to architecture B (parallel)")
        step = branch_step(action, rate, limit) if action in BRANCHES else batch_step(action, arch)
        return action, arch, [step], {"rate": rate, "limit": limit} if action in BRANCHES else {}
    raise BadRequest(f"unknown action {action!r}")


# ---- Dataset size (counted once, in the background) ------------------------------------------

class Dataset:
    def __init__(self) -> None:
        self.total_lines: int | None = None
        threading.Thread(target=self._count, daemon=True).start()

    def _count(self) -> None:
        total = 0
        for path in sorted(INPUT_DIR.glob("NASA_access_log_*")):
            opener = gzip.open if path.suffix == ".gz" else open
            last = b"\n"
            with opener(path, "rb") as source:
                for chunk in iter(lambda: source.read(1 << 20), b""):
                    total += chunk.count(b"\n")
                    last = chunk[-1:]
            total += last != b"\n"  # a last line without a final newline is still a line
        self.total_lines = total or None
        log(f"dataset: {total} lines")


# ---- HTTP ------------------------------------------------------------------------------------

RUNNER = Runner()
DATASET = Dataset()


class Handler(BaseHTTPRequestHandler):
    server_version = "weblogs-control"

    def do_GET(self) -> None:
        url = urlparse(self.path)
        parts = url.path.strip("/").split("/")
        if url.path == "/health":
            return self._json(200, {"ok": True})
        if url.path == "/status":
            with RUNNER._lock:
                active = [j.to_json() for j in RUNNER.active.values()]
                payload = {
                    "current": active[0] if active else None,
                    "active": active,
                    "history": [j.to_json() for j in RUNNER.history],
                    "datasetLines": DATASET.total_lines,
                    "defaultArch": architectures.DEFAULT,
                    "replayRunning": {arch: replay_running(arch) for arch in ARCHS},
                }
            return self._json(200, payload)
        if len(parts) == 3 and parts[0] == "jobs" and parts[2] == "log":
            job = RUNNER.find(parts[1])
            if not job:
                return self._json(404, {"error": "unknown job"})
            try:
                after = int(parse_qs(url.query).get("after", ["-1"])[0])
            except ValueError:
                return self._json(400, {"error": "after must be an integer"})
            return self._json(200, {"job": job.to_json(), "lines": job.log_after(after)})
        if parts == ["runs"]:
            return self._json(200, {"runs": runs.load_all()})
        if len(parts) == 2 and parts[0] == "runs":
            record = runs.load(parts[1])
            return self._json(200, record) if record else self._json(404, {"error": "unknown run"})
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        parts = urlparse(self.path).path.strip("/").split("/")
        if parts == ["jobs"]:
            return self._start()
        if len(parts) == 3 and parts[0] == "jobs" and parts[2] == "cancel":
            job = RUNNER.find(parts[1])
            if not job or job.status != "running":
                return self._json(404, {"error": "no such running job"})
            RUNNER.cancel(job)
            return self._json(202, job.to_json())
        self._json(404, {"error": "not found"})

    def _start(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length < 0 or length > MAX_BODY:
                raise BadRequest("body too large")
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise BadRequest("expected a JSON object")
            action, arch, steps, params = plan(body)
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {"error": "invalid JSON body"})
        except BadRequest as error:
            return self._json(400, {"error": str(error)})
        try:
            job = RUNNER.start(action, arch, steps, params)
        except Conflict as error:
            return self._json(409, {"error": str(error)})
        self._json(202, job.to_json())

    def _json(self, status: int, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_args) -> None:  # requests are polled every second; keep logs quiet
        pass


def main() -> int:
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown).start())
    log(f"control API listening on port {PORT}")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
