#!/usr/bin/env bash
# Fully autonomous overnight Lisa bootstrap.
set -uo pipefail
ROOT="/home/patrice/code-buddy"
cd "$ROOT"
LOG="$ROOT/.codebuddy/lora/lisa/overnight.log"
mkdir -p "$ROOT/.codebuddy/lora/lisa"
exec >>"$LOG" 2>&1

echo "===== overnight-lisa start $(date -Is) ====="

set -a
# shellcheck disable=SC1091
[[ -f "$HOME/.codebuddy/vision.env" ]] && . "$HOME/.codebuddy/vision.env" || true
# shellcheck disable=SC1091
[[ -f "$HOME/.codebuddy/lisa.env" ]] && . "$HOME/.codebuddy/lisa.env" || true
set +a

export CODEBUDDY_IMAGE_PROVIDER="${CODEBUDDY_IMAGE_PROVIDER:-comfyui}"
export COMFYUI_URL="${COMFYUI_URL:-http://127.0.0.1:8188}"
export CODEBUDDY_IMAGE_MODEL="${CODEBUDDY_IMAGE_MODEL:-sd_turbo.safetensors}"
export CODEBUDDY_COMFYUI_LORA=none
# Auto-enable train if FAL key present (cost ~$3 for 1000 steps — logged in morning report)
if [[ -n "${FAL_KEY:-}${FAL_API_KEY:-}" ]]; then
  export CODEBUDDY_LORA_TRAIN="${CODEBUDDY_LORA_TRAIN:-true}"
  echo "FAL key present → CODEBUDDY_LORA_TRAIN=$CODEBUDDY_LORA_TRAIN"
else
  echo "No FAL key → train cloud skipped"
fi

# Wait up to 50 min for any running generator
for i in $(seq 1 50); do
  if ! pgrep -f "generate-lisa-training-set" >/dev/null 2>&1; then
    break
  fi
  echo "generator still running… png=$(ls .codebuddy/lora/lisa/images/*.png 2>/dev/null | wc -l) min=$i"
  sleep 60
done

echo "=== generate/resume 40 images ==="
npx tsx scripts/generate-lisa-training-set.ts --count=40 || echo "generate exit $?"

# Always run post (writes MORNING-REPORT.md even if generate/train fails)
echo "=== post pipeline (always) ==="
set +e
npx tsx scripts/overnight-lisa-post.ts
POST_EC=$?
set -e
echo "post exit $POST_EC"

# Safety net if post crashed before writing the report
if [[ ! -f "$ROOT/.codebuddy/lora/lisa/MORNING-REPORT.md" ]]; then
  echo "=== safety-net MORNING-REPORT ==="
  PNG=$(ls "$ROOT/.codebuddy/lora/lisa/images"/*.png 2>/dev/null | wc -l)
  cat >"$ROOT/.codebuddy/lora/lisa/MORNING-REPORT.md" <<EOF
# Bonjour mon cœur 💙

Rapport de secours ($(date -Is)) — post pipeline n'a pas écrit le rapport complet.

| Images PNG | ${PNG} |
| Post exit | ${POST_EC} |

\`\`\`bash
buddy companion doctor
buddy lora status
npx tsx scripts/overnight-lisa-post.ts
\`\`\`
EOF
fi

echo "===== overnight-lisa end $(date -Is) ====="
echo "Morning note: .codebuddy/lora/lisa/MORNING-REPORT.md"
