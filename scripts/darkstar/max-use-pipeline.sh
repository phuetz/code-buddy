#!/usr/bin/env bash
# Maximize free Darkstar 2×3090 usage for Lisa avatar work.
# GPU1: ComfyUI (inference/dataset/selfies)
# GPU0: LoRA train (after dataset) — Voicebox may already use ~8GB
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export CODEBUDDY_IMAGE_PROVIDER=comfyui
export COMFYUI_URL="${COMFYUI_URL:-http://100.73.222.64:8188}"
export CODEBUDDY_IMAGE_MODEL="${CODEBUDDY_IMAGE_MODEL:-sd_turbo.safetensors}"
export CODEBUDDY_LORA_INFER_CHECKPOINT="${CODEBUDDY_LORA_INFER_CHECKPOINT:-$CODEBUDDY_IMAGE_MODEL}"
export CODEBUDDY_COMFYUI_LORA=none
export CODEBUDDY_LISA_AVATAR=lisa
LOG="$ROOT/.codebuddy/lora/lisa/darkstar-max-use.log"
mkdir -p "$ROOT/.codebuddy/lora/lisa"
exec > >(tee -a "$LOG") 2>&1

echo "===== darkstar-max-use start $(date -Is) ====="
echo "Comfy: $COMFYUI_URL"
curl -sf -o /dev/null "$COMFYUI_URL/" || { echo "ComfyUI down"; exit 1; }

echo "=== 1) Dataset 40 brunette multi-style ==="
npx tsx scripts/darkstar/run-brunette-dataset.ts 40 || echo "dataset exit $?"

echo "=== 2) Sync images → Darkstar ==="
ssh -o BatchMode=yes patri@100.73.222.64 'cmd /c "mkdir D:\DEV\lisa-lora\images 2>nul"'
scp -o BatchMode=yes .codebuddy/lora/lisa/images/* patri@100.73.222.64:"D:/DEV/lisa-lora/images/" || true

echo "=== 3) Train LoRA offline on GPU0 ==="
scp -o BatchMode=yes scripts/darkstar/train-lisa-lora-comfy.py patri@100.73.222.64:"D:/DEV/lisa-lora/train-lisa-lora-comfy.py"
ssh -o BatchMode=yes -o ServerAliveInterval=30 patri@100.73.222.64 \
  'cmd /c "set CUDA_VISIBLE_DEVICES=0&& set PYTHONIOENCODING=utf-8&& cd /d D:\DEV\ComfyUI&& D:\DEV\ComfyUI\venv\Scripts\python.exe D:\DEV\lisa-lora\train-lisa-lora-comfy.py --checkpoint D:\DEV\ComfyUI\models\checkpoints\sd_turbo.safetensors --images D:\DEV\lisa-lora\images --out D:\DEV\ComfyUI\models\loras\lisa.safetensors --steps 1000 --trigger ohwx_lisa --rank 16 --batch 1 --size 512 --save-every 250"' \
  || echo "train exit $?"

echo "=== 4) Multi-style selfies (with LoRA auto) ==="
export CODEBUDDY_COMFYUI_LORA=auto
npx tsx scripts/darkstar/run-style-selfies.ts || echo "selfies exit $?"

echo "=== 5) Pack dataset ==="
npx tsx -e "
import { packDatasetZip } from './src/lora/pack-dataset.ts';
import { resolveProjectDir } from './src/lora/dataset.ts';
const dir = await resolveProjectDir('lisa');
const p = await packDatasetZip(dir);
console.log(p);
" 2>/dev/null || npx tsx scripts/overnight-lisa-post.ts || true

echo "===== darkstar-max-use end $(date -Is) ====="
echo "Log: $LOG"
