#!/usr/bin/env python3
"""Replay access-log lines into an output file at a controlled rate.

Simulates live web traffic for Flume. Progress is persisted in a state file
so a restart resumes exactly where the previous run stopped.
"""
from __future__ import annotations

import argparse
import gzip
import os
import signal
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Iterator

BATCH_INTERVAL = 0.1  # seconds between batches
PROGRESS_INTERVAL = 10.0  # seconds between progress logs


@dataclass(frozen=True)
class Config:
    inputs: list[Path]
    output: Path
    rate: int
    limit: int
    state_file: Path


def log(message: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} [INFO]  {message}", flush=True)


def parse_args() -> Config:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", action="append", required=True, type=Path,
                        help="source log, plain or .gz (repeatable, order preserved)")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--rate", type=int, default=500, help="lines per second")
    parser.add_argument("--limit", type=int, default=0, help="max lines in total, 0 = no limit")
    parser.add_argument("--state-file", type=Path, help="default: <output>.offset")
    args = parser.parse_args()
    if args.rate <= 0:
        parser.error("--rate must be positive")
    missing = [str(p) for p in args.input if not p.is_file()]
    if missing:
        parser.error(f"input file not found: {', '.join(missing)}")
    state = args.state_file or args.output.with_name(args.output.name + ".offset")
    return Config(args.input, args.output, args.rate, args.limit, state)


def open_source(path: Path) -> BinaryIO:
    return gzip.open(path, "rb") if path.suffix == ".gz" else open(path, "rb")


def read_lines(paths: list[Path], skip: int) -> Iterator[bytes]:
    """Yield source lines in order, skipping the first `skip` lines."""
    for path in paths:
        with open_source(path) as source:
            for line in source:
                if skip:
                    skip -= 1
                    continue
                yield line if line.endswith(b"\n") else line + b"\n"


def load_state(path: Path) -> int:
    try:
        return int(path.read_text().strip() or 0)
    except FileNotFoundError:
        return 0


def save_state(path: Path, written: int) -> None:
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, 'w') as stream:
        stream.write(f"{written}\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, path)


class StopFlag:
    """Set by SIGTERM/SIGINT; checked between batches."""

    def __init__(self) -> None:
        self.stopped = False
        signal.signal(signal.SIGTERM, self._stop)
        signal.signal(signal.SIGINT, self._stop)

    def _stop(self, signum: int, _frame: object) -> None:
        log(f"received {signal.Signals(signum).name}, stopping after current batch")
        self.stopped = True


def replay(cfg: Config) -> None:
    written = load_state(cfg.state_file)
    if cfg.limit and written >= cfg.limit:
        log(f"limit already reached ({written} lines), nothing to do")
        return
    log(f"resuming at line {written}" if written else "starting from the beginning")

    batch_size = max(1, round(cfg.rate * BATCH_INTERVAL))
    lines = read_lines(cfg.inputs, written)
    stop = StopFlag()
    start = last_log = time.monotonic()
    session = 0
    cfg.output.parent.mkdir(parents=True, exist_ok=True)

    with open(cfg.output, "ab") as out:
        while not stop.stopped:
            room = cfg.limit - written if cfg.limit else batch_size
            batch = [line for _, line in zip(range(min(batch_size, room)), lines)]
            if not batch:
                break
            out.writelines(batch)
            out.flush()
            os.fsync(out.fileno())
            written += len(batch)
            session += len(batch)
            save_state(cfg.state_file, written)

            # Sleep until the schedule implied by the target rate catches up.
            now = time.monotonic()
            time.sleep(max(0.0, start + session / cfg.rate - now))
            if now - last_log >= PROGRESS_INTERVAL:
                log(f"{written} lines written, {session / (now - start):.0f} lines/s")
                last_log = now

    elapsed = max(time.monotonic() - start, 1e-9)
    log(f"done: {session} lines this run, {written} total, "
        f"{session / elapsed:.0f} lines/s average")


def main() -> int:
    import fcntl
    cfg = parse_args()
    cfg.output.parent.mkdir(parents=True, exist_ok=True)
    with open(str(cfg.state_file) + '.lock', 'w') as guard:
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        replay(cfg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
