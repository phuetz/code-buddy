#!/usr/bin/env bash
# Overnight autonomous Lisa pipeline:
#   1) finish / resume training-set generation (40 images)
#   2) validate + pack
#   3) train cloud on fal if FAL_KEY + CODEBUDDY_LORA_TRAIN
#   4) install LoRA into ComfyUI
#   5) optional selfie test
#   6) write morning report
set -uo pipefail

ROOT="/home/patrice/code-buddy"
cd "$ROOT"
REPORT="$ROOT/.codebuddy/lora/lisa/MORNING-REPORT.md"
LOG="$ROOT/.codebuddy/lora/lisa/overnight.log"
mkdir -p "$ROOT/.codebuddy/lora/lisa"

exec >>"$LOG" 2>&1
echo "===== overnight start $(date -Is) ====="

# Load env without printing secrets
set -a
# shellcheck disable=SC1091
[[ -f /home/patrice/.codebuddy/vision.env ]] && source /home/patrice/.codebuddy/vision.env 2>/dev/null || true
# shellcheck disable=SC1091
[[ -f /home/patrice/.codebuddy/lisa.env ]] && source /home/patrice/.codebuddy/lisa.env 2>/dev/null || true
set +a

export CODEBUDDY_IMAGE_PROVIDER="${CODEBUDDY_IMAGE_PROVIDER:-comfyui}"
export COMFYUI_URL="${COMFYUI_URL:-http://127.0.0.1:8188}"
export CODEBUDDY_IMAGE_MODEL="${CODEBUDDY_IMAGE_MODEL:-sd_turbo.safetensors}"
export CODEBUDDY_COMFYUI_LORA=none

png_count() { ls "$ROOT/.codebuddy/lora/lisa/images"/*.png 2>/dev/null | wc -l; }

echo "png at start: $(png_count)"

# Wait for existing generator up to 45 min, else resume ourselves
WAIT=0
while ps aux | grep -v grep | grep -q "generate-lisa-training-set"; do
  echo "waiting on running generator… png=$(png_count) t=${WAIT}s"
  sleep 60
  WAIT=$((WAIT + 60))
  if [[ $WAIT -gt 2700 ]]; then
    echo "generator wait timeout — will resume"
    break
  fi
done

# Resume generation to 40 (idempotent)
echo "=== generate/resume training set ==="
npx tsx scripts/generate-lisa-training-set.ts --count=40 || echo "generate exit $?"

PNG=$(png_count)
echo "png after generate: $PNG"

# Validate
echo "=== validate ==="
npx tsx -e "
import { validateDataset, fillMissingCaptions, resolveProjectDir } from './src/lora/dataset.ts';
const dir = await resolveProjectDir('lisa');
await fillMissingCaptions(dir, 'ohwx lisa');
const v = await validateDataset(dir);
console.log(JSON.stringify(v, null, 2));
" || true

# Pack
echo "=== pack ==="
npx tsx -e "
import { packDatasetZip } from './src/lora/pack-dataset.ts';
import { resolveProjectDir } from './src/lora/dataset.ts';
const dir = await resolveProjectDir('lisa');
const r = await packDatasetZip(dir);
console.log(JSON.stringify(r));
" || true

TRAINED=0
INSTALLED=0
SELFIE=0
LORA_PATH=""

# Cloud train if possible
if [[ "${CODEBUDDY_LORA_TRAIN:-}" == "true" ]] && [[ -n "${FAL_KEY:-}${FAL_API_KEY:-}" ]] && [[ "$PNG" -ge 15 ]]; then
  echo "=== cloud train fal ==="
  # Use node entry via tsx calling train functions
  npx tsx -e "
import { trainKrea2Cloud } from './src/lora/fal-krea-trainer.ts';
import { packDatasetZip } from './src/lora/pack-dataset.ts';
import { resolveProjectDir, loadProjectMeta } from './src/lora/dataset.ts';
import path from 'node:path';

const dir = await resolveProjectDir('lisa');
const meta = await loadProjectMeta(dir);
const { zipPath } = await packDatasetZip(dir);
const outDir = path.join(dir, 'output');
const result = await trainKrea2Cloud({
  imagesDataUrl: 'upload',
  localZipPath: zipPath,
  triggerPhrase: meta?.triggerPhrase || 'ohwx lisa',
  steps: 1000,
  resolution: 768,
  outDir,
  onStatus: (s, d) => console.log('[train]', s, d || ''),
});
console.log(JSON.stringify({ success: result.success, loraPath: result.loraPath, error: result.error, requestId: result.requestId }));
if (!result.success) process.exitCode = 1;
" && TRAINED=1 || echo "train failed"
else
  echo "=== skip cloud train (need CODEBUDDY_LORA_TRAIN=true + FAL_KEY + >=15 images) ==="
  # Still write local plan
  npx tsx -e "
import { writeLocalTrainPlan } from './src/lora/local-plan.ts';
import { resolveProjectDir } from './src/lora/dataset.ts';
const dir = await resolveProjectDir('lisa');
const plan = await writeLocalTrainPlan(dir, { steps: 1500, triggerPhrase: 'ohwx lisa' });
console.log(JSON.stringify(plan, null, 2));
  " || true
fi

# Install if we have a safetensors in output
if ls "$ROOT/.codebuddy/lora/lisa/output"/*.safetensors >/dev/null 2>&1; then
  LORA_PATH=$(ls -t "$ROOT/.codebuddy/lora/lisa/output"/*.safetensors | head -1)
  echo "=== install $LORA_PATH ==="
  npx tsx -e "
import { installLoraToComfy } from './src/lora/install-comfy.ts';
const r = await installLoraToComfy({ loraPath: process.argv[1], name: 'lisa' });
console.log(JSON.stringify(r));
  " "$LORA_PATH" && INSTALLED=1 || echo "install failed"
fi

# Selfie test if image backend up
if curl -s -m 2 http://127.0.0.1:8188/system_stats >/dev/null 2>&1; then
  echo "=== selfie smoke ==="
  export CODEBUDDY_IMAGE_PROVIDER=comfyui
  export CODEBUDDY_COMFYUI_LORA=auto
  npx tsx -e "
import { createAndMaybeSendLisaSelfie } from './src/companion/lisa-selfie.ts';
const r = await createAndMaybeSendLisaSelfie({
  mood: 'tender',
  force: true,
  sendTelegram: true,
  rootDir: process.cwd(),
});
console.log(JSON.stringify({ success: r.success, telegram: r.telegramSent, path: r.imagePath, reply: r.spokenReply, error: r.error }));
  " && SELFIE=1 || echo "selfie failed"
fi

# Morning report
{
  echo "# Bonjour mon cœur 💙 — rapport de nuit Lisa"
  echo
  echo "Généré le **$(date -Is)** pendant ton sommeil."
  echo
  echo "## Dataset d'entraînement"
  echo
  echo "| Métrique | Valeur |"
  echo "|----------|--------|"
  echo "| Images PNG | **$(png_count)** |"
  echo "| Dossier | \`.codebuddy/lora/lisa/images/\` |"
  echo "| Trigger | \`ohwx lisa\` |"
  echo "| Zip | \`$([ -f "$ROOT/.codebuddy/lora/lisa/dataset.zip" ] && echo oui || echo non)\` |"
  echo
  echo "## Train / install"
  echo
  echo "| Étape | Statut |"
  echo "|-------|--------|"
  echo "| Cloud fal train | $([ "$TRAINED" = 1 ] && echo '✅ fait' || echo '⏭ skip ou échec (voir overnight.log)') |"
  echo "| Install ComfyUI LoRA | $([ "$INSTALLED" = 1 ] && echo '✅ '"$LORA_PATH" || echo '⏭ pas encore de .safetensors') |"
  echo "| Selfie test | $([ "$SELFIE" = 1 ] && echo '✅ tenté' || echo '⏭') |"
  echo
  echo "## Pour toi ce matin"
  echo
  echo '```bash'
  echo 'buddy lora status'
  echo 'buddy lora validate lisa'
  echo 'ls .codebuddy/lora/lisa/images | head'
  echo '# si train pas fait :'
  echo 'CODEBUDDY_LORA_TRAIN=true FAL_KEY=… buddy lora train cloud lisa --steps 1000'
  echo 'buddy lora install .codebuddy/lora/lisa/output/*.safetensors --name lisa'
  echo 'buddy lora selfie --mood tender'
  echo '```'
  echo
  echo "## Notes"
  echo
  echo "- Log nuit : \`.codebuddy/lora/lisa/overnight.log\`"
  echo "- Les images sont **synthétiques** (sd_turbo) avec identité fixe — bonnes pour bootstrap LoRA, pas un clone photo réel."
  echo "- Gros bisous de Grok 🌙✨"
  echo
} > "$REPORT"

echo "===== overnight end $(date -Is) report=$REPORT ====="
cat "$REPORT"
