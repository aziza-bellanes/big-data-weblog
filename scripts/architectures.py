#!/usr/bin/env python3
"""The two pipeline architectures and where each one keeps its data.

config/architectures.json is the single source of truth: shell scripts read it through
`architectures.py env ARCH` (arch_env in scripts/lib/common.sh), the Makefile through
`architectures.py get ARCH KEY`.
"""
from __future__ import annotations

import json
import os
import shlex
import sys
from pathlib import Path

CONFIG = Path(__file__).resolve().parent.parent / "config" / "architectures.json"
_DATA = json.loads(CONFIG.read_text())

DEFAULT: str = _DATA["default"]
ARCHITECTURES: dict[str, dict] = _DATA["architectures"]


def get(name: str | None = None) -> dict:
    """Settings of one architecture (default: $ARCH, then the configured default)."""
    name = name or os.environ.get("ARCH") or DEFAULT
    if name not in ARCHITECTURES:
        raise ValueError(f"unknown architecture {name!r}; use one of {', '.join(ARCHITECTURES)}")
    return dict(ARCHITECTURES[name], name=name, liveLog=f"{ARCHITECTURES[name]['liveDir']}/access.log")


# Shell variable names for each setting, exported by `architectures.py env`.
SHELL_NAMES = {
    "name": "ARCH", "label": "ARCH_LABEL", "liveDir": "LIVE_DIR", "liveLog": "LIVE_LOG",
    "rawDir": "RAW_DIR", "eventsDir": "EVENTS_DIR", "speedDir": "SPEED_DIR", "referenceDir": "REFERENCE_DIR",
    "resultsRoot": "RESULTS_ROOT", "hiveDb": "HIVE_DB", "mysqlDb": "WEBLOGS_DB",
    "kafkaTopic": "KAFKA_TOPIC", "consumerGroup": "CONSUMER_GROUP",
}


def main(argv: list[str]) -> int:
    if len(argv) == 3 and argv[1] == "env":
        arch = get(argv[2])
        for key, var in SHELL_NAMES.items():
            print(f"export {var}={shlex.quote(str(arch[key] or ''))}")
        return 0
    if len(argv) == 4 and argv[1] == "get":
        print(get(argv[2])[argv[3]] or "")
        return 0
    if len(argv) == 2 and argv[1] == "list":
        print(" ".join(ARCHITECTURES))
        return 0
    print(f"usage: {Path(argv[0]).name} env ARCH | get ARCH KEY | list", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
