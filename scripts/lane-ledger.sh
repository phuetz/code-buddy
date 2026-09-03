#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
exec node "$SCRIPT_DIR/lane-ledger.mjs" "$@"
