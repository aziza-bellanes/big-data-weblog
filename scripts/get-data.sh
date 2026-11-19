#!/usr/bin/env bash
# Download the NASA KSC HTTP access logs (July and August 1995).
# Usage: get-data.sh [TARGET_DIR] [--month jul|aug]
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

readonly MIRRORS=(
    "https://ita.ee.lbl.gov/traces/"
    "ftp://ita.ee.lbl.gov/traces/"
)

usage() { die "usage: $(basename "$0") [TARGET_DIR] [--month jul|aug]"; }

# download URL PART_FILE - resumable download that gives up on a stalled connection
# (less than 1 KB/s for 30 s) and retries from where it stopped.
download() {
    local url=$1 part=$2 attempt
    for attempt in 1 2 3 4 5; do
        curl --fail --location --progress-bar --connect-timeout 15 \
             --speed-limit 1024 --speed-time 30 --continue-at - \
             -o "$part" "$url" && return 0
        warn "attempt $attempt interrupted, resuming"
    done
    return 1
}

# fetch FILE DIR - download FILE into DIR from the first working mirror
fetch() {
    local file=$1 dir=$2 dest="$2/$1" base
    if [[ -f $dest ]] && gzip -t "$dest" 2>/dev/null; then
        log "$file already present, skipping"
        return
    fi
    for base in "${MIRRORS[@]}"; do
        log "downloading $file from $base"
        if download "$base$file" "$dest.part" && gzip -t "$dest.part" 2>/dev/null; then
            mv "$dest.part" "$dest"
            return
        fi
        warn "mirror failed: $base"
        rm -f "$dest.part"
    done
    die "could not download $file from any mirror. Search Kaggle for 'NASA HTTP access logs 1995' and place the .gz files in $dir manually."
}

main() {
    local target="" month="" files=() file
    while (( $# )); do
        case $1 in
            --month) [[ $# -ge 2 ]] || usage; month=$2; shift 2 ;;
            -h|--help) usage ;;
            *) [[ -z $target ]] || usage; target=$1; shift ;;
        esac
    done

    case $month in
        "")  files=(NASA_access_log_Jul95.gz NASA_access_log_Aug95.gz) ;;
        jul) files=(NASA_access_log_Jul95.gz) ;;
        aug) files=(NASA_access_log_Aug95.gz) ;;
        *)   usage ;;
    esac

    require_cmd curl gzip
    target=${target:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/data/raw"}
    mkdir -p "$target"

    for file in "${files[@]}"; do
        fetch "$file" "$target"
    done
    for file in "${files[@]}"; do
        log "$file: $(zcat "$target/$file" | wc -l) lines"
    done
}

main "$@"
