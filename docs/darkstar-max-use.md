# Darkstar — profiter des 2× RTX 3090 (gratuit)

Machine gratuite du LAN/Tailscale : `patri@100.73.222.64`
**GPU0** (~24 Go) : Voicebox (~8 Go) + train LoRA / jobs lourds
**GPU1** (~24 Go) : ComfyUI inference (`:8188`) — dataset, selfies, flux, vidéo

## Pipeline Lisa “max use”

```bash
# Comfy doit être up (session SSH longue sur GPU1)
curl -s -o /dev/null -w '%{http_code}\n' http://100.73.222.64:8188/

# Full auto: dataset brune → sync → train GPU0 → selfies multi-style
bash scripts/darkstar/max-use-pipeline.sh
```

Étapes manuelles :

```bash
export COMFYUI_URL=http://100.73.222.64:8188
export CODEBUDDY_IMAGE_PROVIDER=comfyui
export CODEBUDDY_IMAGE_MODEL=sd_turbo.safetensors
export CODEBUDDY_COMFYUI_LORA=none

# 1) Dataset multi-style (brune vidéo Krea)
npx tsx scripts/darkstar/run-brunette-dataset.ts 40

# 2) Train sur GPU0
scp .codebuddy/lora/lisa/images/* patri@100.73.222.64:D:/DEV/lisa-lora/images/
ssh patri@100.73.222.64 'cmd /c "set CUDA_VISIBLE_DEVICES=0&& cd /d D:\DEV\ComfyUI&& venv\Scripts\python.exe D:\DEV\lisa-lora\train-lisa-lora-comfy.py --checkpoint models\checkpoints\sd_turbo.safetensors --images D:\DEV\lisa-lora\images --out models\loras\lisa.safetensors --steps 1000 --trigger ohwx_lisa --rank 16"'

# 3) Selfies tous styles (LoRA on)
export CODEBUDDY_COMFYUI_LORA=auto
npx tsx scripts/darkstar/run-style-selfies.ts
```

## Cas d’usage 3090 (au-delà de Lisa)

| Use case | GPU | Comment |
|----------|-----|---------|
| **Dataset / selfies Lisa** | 1 | Comfy `sd_turbo` + LoRA |
| **Train LoRA offline** | 0 | `train-lisa-lora-comfy.py` |
| **Flux.1-dev FP8** | 1 | Checkpoint déjà sur Darkstar — portraits HQ / style |
| **SVD XT video** | 1 | `svd_xt.safetensors` — image→vidéo courte |
| **Wan 2.2 I2V LoRAs** | 1 | 2× LoRA déjà installés (`wan2.2_i2v_*`) |
| **Voicebox TTS** | 0 | déjà sur `:17493` |
| **Ollama 35B** | 0/1 | déjà `:11434` — conseil / captions |
| **Krea2Trainer 1-clic** | 0 | [CaptainGrock/Krea2Trainer](https://github.com/CaptainGrock/Krea2Trainer) — train Krea pro |
| **Film / video_stitch** | 1 | scènes `buddy film` avec gen GPU |
| **Batch marketing stills** | 1 | boucle `image_generate` multi-prompt |
| **Caption Florence-2** | 0 | comme dans la vidéo YouTube (auto-tag dataset) |

## Règle d’or

Tant que les 3090 sont à **0 % util** et free VRAM > 15 Go, **lancer un job** :

1. Régénérer dataset
2. Re-train LoRA
3. Grille multi-style selfies
4. Expérimenter Flux / SVD / Wan
5. Installer Krea2Trainer pour monostack pro

Ne pas laisser tourner idle si on a du travail créatif / train en attente.
