#!/usr/bin/env bash
# Source-aware reconciliation of closed files.
set -euo pipefail
exec python3 "$(dirname "${BASH_SOURCE[0]}")/verify_ingestion.py" "$@"
