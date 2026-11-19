#!/usr/bin/env bash
# Run one or more HiveQL files through HiveServer2 for one architecture.
# Usage: run-hive.sh FILE [FILE...]
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

(( $# > 0 )) || die "usage: $(basename "$0") FILE [FILE...]"
require_cmd beeline
arch_env

for file in "$@"; do
    beeline_run "$file"
done
