#!/usr/bin/env bash
# Marker script used as a recorded "npm test" stand-in for replay proofs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
echo "GK28-REPLAY-HIT $(date -Iseconds)" >> "$ROOT/work/replay-hits.txt"
echo "GK28-REPLAY-HIT"
