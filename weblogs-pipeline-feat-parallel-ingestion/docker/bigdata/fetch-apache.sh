#!/usr/bin/env bash
# Build-time helper: download an Apache release, verify it, unpack it.
# Usage: fetch-apache RELATIVE_PATH DEST_DIR ALGO:HASH
#   RELATIVE_PATH  path under the Apache dist root, e.g. flume/1.9.0/apache-flume-1.9.0-bin.tar.gz
#   ALGO:HASH      official checksum, ALGO one of md5, sha256, sha512
# Mirrors are tried in the order of $APACHE_MIRRORS. A mirror that does not have the file
# is skipped at once; a dropped or stalled connection is resumed where it stopped.
set -euo pipefail

(( $# == 3 )) || { echo "usage: fetch-apache RELATIVE_PATH DEST_DIR ALGO:HASH" >&2; exit 2; }
readonly REL_PATH=$1 DEST=$2 ALGO=${3%%:*} HASH=${3#*:}
ARCHIVE="/tmp/${REL_PATH##*/}"
readonly ARCHIVE
readonly RESUME_ATTEMPTS=10
readonly CURL_HTTP_ERROR=22
: "${APACHE_MIRRORS:?must list at least one mirror}"

# download URL: 0 when complete, 1 when the mirror lacks the file or keeps failing.
download() {
    local url=$1 attempt status
    for (( attempt = 1; attempt <= RESUME_ATTEMPTS; attempt++ )); do
        status=0
        curl -fL --connect-timeout 15 --speed-limit 10240 --speed-time 60 \
             --continue-at - -o "$ARCHIVE" "$url" || status=$?
        (( status == 0 )) && return 0
        (( status == CURL_HTTP_ERROR )) && return 1
        echo "connection lost (curl $status), resuming (attempt $attempt/$RESUME_ATTEMPTS)" >&2
        sleep 3
    done
    return 1
}

for mirror in $APACHE_MIRRORS; do
    echo "fetching $REL_PATH from $mirror"
    rm -f "$ARCHIVE"
    if download "$mirror/$REL_PATH" && echo "$HASH  $ARCHIVE" | "${ALGO}sum" -c --quiet -; then
        mkdir -p "$DEST"
        tar -xzf "$ARCHIVE" -C "$DEST" --strip-components=1
        rm -f "$ARCHIVE"
        exit 0
    fi
    echo "mirror unavailable or checksum mismatch: $mirror" >&2
done

echo "could not fetch $REL_PATH from any mirror" >&2
exit 1
