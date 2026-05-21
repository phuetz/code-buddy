#!/usr/bin/env bash
# Démarrage de ComfyUI avec accélération GPU (ROCm) sur Ryzen AI 9 HX 470
# Architecture : gfx1150 (RDNA 3.5)

export HSA_OVERRIDE_GFX_VERSION=11.0.0
export TORCH_COMMAND="pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/rocm7.2"

cd /home/patrice/DEV/ComfyUI
source venv/bin/activate

echo "🚀 Démarrage de ComfyUI (GPU ROCm)..."
python3 main.py --listen 0.0.0.0 --port 8188 --lowvram --preview-method auto
