#!/usr/bin/env bash
# Rejoue les surfaces locales de preuve P3. Aucun service tiers n'est contacté.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
mkdir -p _qa/p3/home _qa/p3/dream-project _qa/p3/images _qa/p3/out
export HOME="$ROOT/_qa/p3/home" USERPROFILE="$ROOT/_qa/p3/home"

case "${1:-all}" in
  nervous|all)
    if [[ -z "${CARGO_HOME:-}" || -z "${RUSTUP_HOME:-}" ]]; then
      echo 'Fournir CARGO_HOME et RUSTUP_HOME pour le rejeu Rust isolé.' >&2
      exit 2
    fi
    ;;
esac
case "${1:-all}" in
  vision-train|all)
    if [[ -z "${P3_YOLO_PYTHON:-}" || -z "${P3_YOLO_MODEL:-}" ]]; then
      echo 'Fournir P3_YOLO_PYTHON et P3_YOLO_MODEL pour le rejeu YOLO isolé.' >&2
      exit 2
    fi
    ;;
esac

prepare() { python3 scripts/preuves/p3-prepare.py; }
case "${1:-all}" in
  nervous)
    prepare
    (cd buddy-sense && CARGO_NET_OFFLINE=true cargo test --locked && CARGO_NET_OFFLINE=true cargo build --locked)
    env -i PATH="$PATH" HOME="$ROOT/_qa/p3/home" USERPROFILE="$ROOT/_qa/p3/home" CODEBUDDY_HOME="$ROOT/_qa/p3/home" \
      node --import tsx scripts/preuves/p3-sense.mjs _qa/p3/speech.wav
    ;;
  dream)
    prepare
    (cd "$ROOT" && env -i PATH="$PATH" HOME="$ROOT/_qa/p3/home" USERPROFILE="$ROOT/_qa/p3/home" CODEBUDDY_HOME="$ROOT/_qa/p3/home" P3_REPO_ROOT="$ROOT" \
      node_modules/.bin/tsx scripts/preuves/p3-dream.mjs)
    ;;
  rules)
    prepare
    set +e
    env -i PATH="$PATH" HOME="$ROOT/_qa/p3/home" USERPROFILE="$ROOT/_qa/p3/home" CODEBUDDY_HOME="$ROOT/_qa/p3/home" \
      CODEBUDDY_SENSORY_RULES_FILE="$ROOT/_qa/p3/sensory-rules.json" \
      node_modules/.bin/tsx src/index.ts rules add --from-file _qa/p3/rule-dangerous.json
    rejected=$?
    set -e
    test "$rejected" -eq 1
    env -i PATH="$PATH" HOME="$ROOT/_qa/p3/home" USERPROFILE="$ROOT/_qa/p3/home" CODEBUDDY_HOME="$ROOT/_qa/p3/home" \
      node --import tsx scripts/preuves/p3-rules.mjs
    ;;
  vision-train)
    prepare
    YOLO_PYTHON="$P3_YOLO_PYTHON"
    YOLO_MODEL="$P3_YOLO_MODEL"
    start_ms="$(date +%s%3N)"
    env -i PATH="$PATH" HOME="$ROOT/_qa/p3/home" USERPROFILE="$ROOT/_qa/p3/home" CODEBUDDY_HOME="$ROOT/_qa/p3/home" \
      CODEBUDDY_VISION_TRAIN=true CODEBUDDY_YOLO_PYTHON="$YOLO_PYTHON" CODEBUDDY_YOLO_MODEL="$YOLO_MODEL" \
      YOLO_CONFIG_DIR="$ROOT/_qa/p3/ultralytics-config" \
      node_modules/.bin/tsx src/index.ts vision-train --images _qa/p3/images --labels _qa/p3/labels.json --out _qa/p3/out
    end_ms="$(date +%s%3N)"
    echo "elapsedMs=$((end_ms - start_ms))"
    ;;
  all)
    "$0" nervous
    "$0" dream
    "$0" rules
    "$0" vision-train
    ;;
  *)
    echo "Usage: $0 [nervous|dream|rules|vision-train|all]" >&2
    exit 2
    ;;
esac
