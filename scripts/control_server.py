#!/usr/bin/env python3
"""Run pipeline steps on request, for the web dashboard.

Runs inside the client container, which already has Hadoop, Hive and Sqoop
and the project mounted. It exposes a small JSON API on the compose network
only (never published to the host):

    GET  /health                     liveness probe
    GET  /status                     current job, recent jobs, dataset size
    POST /jobs        {"action": …}  start a job (independent branches may overlap)
    GET  /jobs/<id>/log?after=<seq>  log lines newer than <seq>
    POST /jobs/<id>/cancel           stop the running job

A job is an ordered list of steps; each step is one of the project's own
scripts, the same ones the Makefile runs.
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
from urllib.parse import parse_qs, urlparse

PROJECT = Path(os.environ.get("PROJECT_HOME", "/opt/project"))
INPUT_DIR = Path("/data/input")
REPLAY_STATE = Path("/data/live/access.log.offset")
PORT = int(os.environ.get("CONTROL_PORT", "8000"))

LOG_CAPACITY = 3000          # lines kept per job
HISTORY = 8                  # finished jobs kept in memory
REPLAY_ACTIVE_WINDOW = 3.0   # seconds; a fresher state file means a replay is running
NOISE = re.compile(r"^SLF4J:|^\s*$")


@dataclass(frozen=True)
class Step:
    key: str
    label: str
    command: list[str]

    @property
    def shown_as(self) -> str:
        """The equivalent make command, echoed at the top of the step's log."""
        return f"make {self.key}"


def _script(*parts: str) -> str:
    return str(PROJECT.joinpath(*parts))


STEPS: dict[str, Step] = {
    "ingest-flume": Step("ingest-flume", "Flume raw replay", ["bash", _script("docker/bigdata/roles/replayer.sh")]),
    "ingest-kafka": Step("ingest-kafka", "Kafka event replay", ["python3", _script("scripts/kafka_ingestion.py"), "produce"]),
    "ingest-sqoop": Step("ingest-sqoop", "Sqoop reference import", ["bash", _script("sqoop/import_status_codes.sh")]),
    "ingest-parallel": Step("ingest-parallel", "Three concurrent ingestion branches", ["python3", _script("scripts/parallel_ingestion.py")]),
    "verify-ingestion": Step("verify-ingestion", "Source-aware reconciliation", ["python3", _script("scripts/verify_ingestion.py")]),
    "hive-tables": Step("hive-tables", "Create Hive tables",
                        ["bash", _script("scripts/run-hive.sh"), _script("hive/01_create_tables.sql")]),
    "sqoop-import": Step("sqoop-import", "Sqoop import of status_codes",
                         ["bash", _script("sqoop/import_status_codes.sh")]),
    "hive-analysis": Step("hive-analysis", "Hive analysis",
                          ["bash", _script("scripts/run-hive.sh"), _script("hive/02_analysis.sql")]),
    "sqoop-export": Step("sqoop-export", "Sqoop export to MySQL",
                         ["bash", _script("sqoop/export_results.sh")]),
    "counts": Step("counts", "No-loss check", ["bash", _script("scripts/check-counts.sh")]),
}

# Each action is a sequence of step keys; "replay" is built per request (rate, limit).
ACTIONS: dict[str, list[str]] = {
    "pipeline": ["hive-tables", "verify-ingestion", "hive-analysis", "sqoop-export"],
    **{key: [key] for key in STEPS},
}
RATES = {100, 500, 1000, 2000, 5000, 10000}


def log(message: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} [INFO]  {message}", flush=True)


def replay_step(rate: int, limit: int) -> Step:
    env = f"REPLAY_RATE={rate} REPLAY_LIMIT={limit}"
    return Step("replay", f"Replay at {rate:,} lines/s",
                ["bash", "-c", f"{env} exec bash {_script('docker/bigdata/roles/replayer.sh')}"])


def replay_running() -> bool:
    try:
        return time.time() - REPLAY_STATE.stat().st_mtime < REPLAY_ACTIVE_WINDOW
    except FileNotFoundError:
        return False


# ---- Jobs ----------------------------------------------------------------------------------

@dataclass
class StepState:
    step: Step
    status: str = "pending"  # pending | running | succeeded | failed | cancelled | skipped
    started_at: float | None = None
    ended_at: float | None = None
    exit_code: int | None = None

    def to_json(self) -> dict:
        return {"key": self.step.key, "label": self.step.label, "status": self.status,
                "startedAt": _ms(self.started_at), "endedAt": _ms(self.ended_at),
                "exitCode": self.exit_code}


@dataclass
class Job:
    action: str
    steps: list[StepState]
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    status: str = "running"  # running | succeeded | failed | cancelled
    created_at: float = field(default_factory=time.time)
    ended_at: float | None = None
    lines: deque = field(default_factory=lambda: deque(maxlen=LOG_CAPACITY))
    next_seq: int = 0
    process: subprocess.Popen | None = None
    cancel_requested: bool = False
    lock: threading.Lock = field(default_factory=threading.Lock)

    def append(self, text: str) -> None:
        with self.lock:
            self.lines.append((self.next_seq, text))
            self.next_seq += 1

    def log_after(self, after: int) -> list[dict]:
        with self.lock:
            return [{"seq": seq, "text": text} for seq, text in self.lines if seq > after]

    def to_json(self) -> dict:
        return {"id": self.id, "action": self.action, "status": self.status,
                "createdAt": _ms(self.created_at), "endedAt": _ms(self.ended_at),
                "steps": [s.to_json() for s in self.steps], "lastSeq": self.next_seq - 1}


def _ms(t: float | None) -> int | None:
    return None if t is None else int(t * 1000)


class Runner:
    """Runs at most one job at a time, in a background thread."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.active: dict[str, Job] = {}
        self.history: deque[Job] = deque(maxlen=HISTORY)

    @property
    def current(self):
        return next(iter(self.active.values()), None)

    @staticmethod
    def resources(action):
        if action in ("replay", "ingest-flume"):
            return {"flume"}
        if action == "ingest-kafka":
            return {"kafka"}
        if action in ("sqoop-import", "ingest-sqoop"):
            return {"sqoop"}
        return {"flume", "kafka", "sqoop", "analytics"}

    def find(self, job_id: str) -> Job | None:
        with self._lock:
            jobs = list(self.active.values()) + list(self.history)
        return next((j for j in jobs if j.id == job_id), None)

    def start(self, action: str, steps: list[Step]) -> Job:
        with self._lock:
            if any(self.resources(action) & self.resources(job.action) for job in self.active.values()):
                raise Conflict("a conflicting branch job is already running")
            if "flume" in self.resources(action) and replay_running():
                raise Conflict("a replay is running; wait for it to finish")
            job = Job(action, [StepState(s) for s in steps])
            self.active[job.id] = job
        threading.Thread(target=self._run, args=(job,), daemon=True).start()
        log(f"job {job.id} started: {action}")
        return job

    def cancel(self, job: Job) -> None:
        job.cancel_requested = True
        if job.process and job.process.poll() is None:
            # Each step runs in its own process group: stop the shell and everything it started.
            try:
                os.killpg(job.process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass

    def _run(self, job: Job) -> None:
        for state in job.steps:
            if job.status != "running":
                state.status = "skipped"  # an earlier step failed or was cancelled
                continue
            try:
                self._run_step(job, state)
            except Exception as error:
                job.append(str(error))
                state.status, state.ended_at = "failed", time.time()
            if state.status != "succeeded":
                job.status = state.status
        if job.status == "running":
            job.status = "succeeded"
        job.ended_at = time.time()
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
        process = subprocess.Popen(
            state.step.command, cwd=PROJECT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, errors="replace", bufsize=1, start_new_session=True,
        )
        job.process = process
        if job.cancel_requested and process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        assert process.stdout is not None
        for line in process.stdout:
            line = line.rstrip()
            if not NOISE.search(line):
                job.append(line)
        state.exit_code = process.wait()
        state.ended_at = time.time()
        if job.cancel_requested:
            state.status = "cancelled"
        else:
            state.status = "succeeded" if state.exit_code == 0 else "failed"


class Conflict(Exception):
    pass


# ---- Dataset size (counted once, in the background) -----------------------------------------

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
                current = RUNNER.current
                payload = {
                    "current": current.to_json() if current else None,
                    "history": [j.to_json() for j in RUNNER.history],
                    "active": [j.to_json() for j in RUNNER.active.values()],
                    "datasetLines": DATASET.total_lines,
                    "replayRunning": replay_running(),
                }
            return self._json(200, payload)
        if len(parts) == 3 and parts[0] == "jobs" and parts[2] == "log":
            job = RUNNER.find(parts[1])
            if not job:
                return self._json(404, {"error": "unknown job"})
            after = int(parse_qs(url.query).get("after", ["-1"])[0])
            return self._json(200, {"job": job.to_json(), "lines": job.log_after(after)})
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
            if length < 0 or length > 8192:
                raise ValueError('body too large')
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise ValueError('expected object')
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {"error": "invalid JSON body"})
        action = body.get("action")
        if action == "replay":
            rate, limit = body.get("rate", 5000), body.get("limit", 0)
            if rate not in RATES or not isinstance(limit, int) or limit < 0:
                return self._json(400, {"error": f"rate must be one of {sorted(RATES)}, limit >= 0"})
            steps = [replay_step(rate, limit)]
        elif action in ACTIONS:
            steps = [STEPS[key] for key in ACTIONS[action]]
        else:
            return self._json(400, {"error": f"unknown action {action!r}"})
        try:
            job = RUNNER.start(action, steps)
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
