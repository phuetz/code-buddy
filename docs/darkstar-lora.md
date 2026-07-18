# Darkstar (2× RTX 3090) — ComfyUI + LoRA Lisa

Machine : **DARKSTAR** · Tailscale `100.73.222.64` · SSH `patri@100.73.222.64`
GPU0 : souvent Voicebox (~8 Go) · GPU1 : ComfyUI / jobs libres.

## Services

| Service | URL | Notes |
|---------|-----|--------|
| **ComfyUI** | `http://100.73.222.64:8188` | Démarrer avec le script ci-dessous (GPU1) |
| **Voicebox** | `http://100.73.222.64:17493` | Déjà utilisé par Ministar |
| **Ollama** | `http://100.73.222.64:11434` | |

## Démarrer ComfyUI (Ministar → SSH)

```bash
# Session longue (ne pas fermer le shell tant que Comfy doit rester up)
ssh -o ServerAliveInterval=30 patri@100.73.222.64 \
  'cmd /c "set CUDA_VISIBLE_DEVICES=1&& cd /d D:\DEV\ComfyUI&& D:\DEV\ComfyUI\venv\Scripts\python.exe main.py --listen 0.0.0.0 --port 8188 --disable-auto-launch"'
```

Vérif : `curl -s -o /dev/null -w '%{http_code}\n' http://100.73.222.64:8188/`

## Brancher Ministar sur Darkstar

```bash
export CODEBUDDY_IMAGE_PROVIDER=comfyui
export COMFYUI_URL=http://100.73.222.64:8188
export CODEBUDDY_IMAGE_MODEL=sd_turbo.safetensors
export CODEBUDDY_LORA_INFER_CHECKPOINT=sd_turbo.safetensors
export CODEBUDDY_COMFYUI_LORA=auto   # lisa.safetensors si installé

buddy lora selfie --mood tender
```

Persister dans `~/.codebuddy/lisa.env` / `vision.env` si c’est le path résident.

## Dataset + train offline (sans FAL / sans HF)

Chemins Darkstar :

| | |
|--|--|
| Images | `D:\DEV\lisa-lora\images` (sync depuis Ministar) |
| Checkpoint monostack | `D:\DEV\ComfyUI\models\checkpoints\sd_turbo.safetensors` |
| Sortie LoRA | `D:\DEV\ComfyUI\models\loras\lisa.safetensors` |
| Script | `D:\DEV\lisa-lora\train-lisa-lora-comfy.py` |

Sync dataset (depuis Ministar) :

```bash
ssh patri@100.73.222.64 'cmd /c "mkdir D:\DEV\lisa-lora\images"'
scp .codebuddy/lora/lisa/images/* patri@100.73.222.64:"D:/DEV/lisa-lora/images/"
scp scripts/darkstar/train-lisa-lora-comfy.py patri@100.73.222.64:"D:/DEV/lisa-lora/train-lisa-lora-comfy.py"
```

Train (GPU0, 1000 steps, ~quelques minutes sur 3090) :

```bash
ssh -o ServerAliveInterval=30 patri@100.73.222.64 \
  'cmd /c "set CUDA_VISIBLE_DEVICES=0&& set PYTHONIOENCODING=utf-8&& cd /d D:\DEV\ComfyUI&& D:\DEV\ComfyUI\venv\Scripts\python.exe D:\DEV\lisa-lora\train-lisa-lora-comfy.py --checkpoint D:\DEV\ComfyUI\models\checkpoints\sd_turbo.safetensors --images D:\DEV\lisa-lora\images --out D:\DEV\ComfyUI\models\loras\lisa.safetensors --steps 1000 --trigger ohwx_lisa --rank 16 --batch 1 --size 512 --save-every 250"'
```

> Shell distant = **PowerShell** : toujours wrapper la commande dans `cmd /c "..."` avec des `&&` à l’intérieur.

## Checkpoints sur Darkstar

| Fichier | État |
|---------|------|
| `sd_turbo.safetensors` | OK (monostack dataset + train) |
| `flux1-dev-fp8.safetensors` | OK (pas ce trainer) |
| `RealVisXL_V4.0_Lightning.safetensors` | **corrompu** (header incomplet) |
| `Juggernaut-XL-v9.safetensors` | stub 15 octets |

## Scripts repo

- `scripts/darkstar/train-lisa-lora-comfy.py` — train offline via loader Comfy + peft
- `scripts/darkstar/start-comfyui.ps1` — helper local Darkstar
- `scripts/darkstar/train-lisa-lora.py` — tentative diffusers (nécessite configs HF non gated)

## Notes

- Anti-dépendance / persona inchangés côté Code Buddy.
- Selfie prouvé via Darkstar Comfy (2026-07-17) sans LoRA ; re-tester avec `CODEBUDDY_COMFYUI_LORA=lisa` après train.
- Ne pas tuer la session SSH qui héberge Comfy tant qu’on en a besoin (pas de service Windows auto encore).
