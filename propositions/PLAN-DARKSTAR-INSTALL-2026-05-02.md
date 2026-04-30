# Plan d'install DARKSTAR — proposition pour 2026-05-02

> Auteur : Claude Opus 4.7 (1M) — soir 2026-05-01, depuis Ministar Linux
> Hardware cible : DARKSTAR — 2× RTX 3090 (24 GB chacune, 48 GB VRAM total CUDA)
> Statut : à valider par Patrice. À exécuter quand DARKSTAR est allumé.
> Trigger : Patrice voulait installer LTX-2.3 sur Ministar — bloqué par bug ROCm gfx1150 (cf. `PLAN-ROCM-72-MINISTAR-2026-05-01.md`). Bascule sur DARKSTAR (CUDA natif, support officiel Lightricks).

## Contexte

**Pourquoi DARKSTAR maintenant** :
- LTX-Desktop officiel = NVIDIA Linux uniquement (AMD pas supporté en local, juste mode API cloud payant)
- LTX-2.3 22B nécessite 32 GB VRAM en BF16 / 20 GB en FP8. 2× 3090 = 48 GB total, largement suffisant.
- Ministar reste utile pour LLMs CPU/iGPU + services persistants edge — DARKSTAR devient la machine vidéo-gen / vision robot lourde.

**Ce qu'on sait déjà sur DARKSTAR (à confirmer en phase 0)** :
- Machine d'entraînement principale `world-model/` (JEPA PyTorch) — donc déjà CUDA + PyTorch installés probablement.
- Pas encore sur Tailscale au 2026-05-01 (TODO listé dans `CLAUDE.md` Ministar).
- Distro/version, drivers NVIDIA, version CUDA — **inconnus depuis ici**, à auditer en phase 0.

## Plan en 7 phases

### Phase 0 — Audit hardware/système (10 min, 0 risque)

À lancer en premier dès que DARKSTAR est up :

```bash
# OS et kernel
lsb_release -a
uname -r

# GPU NVIDIA — drivers + CUDA
nvidia-smi
nvcc --version 2>&1 || echo "CUDA toolkit pas installé (pas grave si runtime CUDA dispo via driver)"

# espace disque (besoin ~160 GB libres pour LTX + venv + outputs)
df -h /home /

# RAM (officiel : 16 GB min, 32 GB recommandé)
free -h

# Python et venv tools
python3 --version
which uv pnpm node ffmpeg git || echo "manquants — voir phase 2"

# état world-model existant (à ne pas casser)
ls -la ~/DEV/world-model/ 2>&1 | head
ls ~/DEV/world-model/.venv/bin/python 2>&1 || echo "venv world-model absent ou ailleurs"
```

**Décision** : si `nvidia-smi` montre 2× RTX 3090 et CUDA ≥ 12.x → green, on continue. Sinon on fixe les drivers NVIDIA d'abord.

### Phase 1 — Tailscale (5 min, 0 risque)

Pour qu'on puisse bosser à distance les jours suivants sans déplacement physique.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
# login Google avec patrice.huetz@gmail.com (même compte que Ministar)
# noter l'IP tailnet (sera 100.x.y.z)
tailscale ip -4
```

À journaliser dans `claude-et-patrice/journal/` (créer `darkstar-DEV.md` au passage).

### Phase 2 — Outils système (10 min, faible risque)

```bash
sudo apt update
sudo apt install -y git ffmpeg build-essential curl python3-venv

# uv (gestionnaire venv rapide, requis par LTX-2)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Node + pnpm (requis par LTX-Desktop et son fork WanGP)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pnpm

# vérifs
uv --version && pnpm --version && node --version
```

### Phase 3 — ComfyUI + venv CUDA (20 min, faible risque)

**Important** : isoler du venv `world-model` pour ne rien casser.

```bash
mkdir -p ~/DEV/ComfyUI && cd ~/DEV/ComfyUI
git clone https://github.com/comfyanonymous/ComfyUI.git .

# venv CUDA (≠ du venv CPU de Ministar, on prend torch CUDA)
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
uv pip install -r requirements.txt

# vérif CUDA actif
python -c "import torch; print('cuda', torch.cuda.is_available(), 'devices', torch.cuda.device_count())"
# attendu : cuda True devices 2

# ComfyUI Manager (pour installer des custom nodes facilement)
cd custom_nodes
git clone https://github.com/ltdrdata/ComfyUI-Manager.git
cd ..

# test démarrage rapide
python main.py --listen 127.0.0.1 --port 8188
# Ctrl+C dès que l'UI répond
```

### Phase 4 — Custom nodes vidéo + briques utiles (20 min)

```bash
cd ~/DEV/ComfyUI/custom_nodes

# LTX-2.3 (le sujet principal)
git clone https://github.com/Lightricks/ComfyUI-LTXVideo.git

# Wan (Patrice l'utilise déjà — wrapper vidéo)
git clone https://github.com/kijai/ComfyUI-WanVideoWrapper.git

# Outils utilitaires courants
git clone https://github.com/cubiq/ComfyUI_essentials.git
git clone https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git
git clone https://github.com/rgthree/rgthree-comfy.git
git clone https://github.com/city96/ComfyUI-GGUF.git  # pour modèles quantizés futurs

# install requirements de chaque custom_node
cd ~/DEV/ComfyUI && source .venv/bin/activate
for d in custom_nodes/*/; do
  if [ -f "$d/requirements.txt" ]; then
    echo "=== $d ==="
    uv pip install -r "$d/requirements.txt"
  fi
done
```

### Phase 5 — LTX-Desktop officiel (10 min, utile en parallèle de ComfyUI)

L'éditeur desktop officiel Lightricks. Plus simple que ComfyUI pour itérer rapidement, ComfyUI reste plus flexible pour les pipelines custom.

```bash
# récupérer la dernière release Linux .deb
mkdir -p ~/Downloads/ltx && cd ~/Downloads/ltx
# URL exacte à confirmer sur https://github.com/Lightricks/LTX-Desktop/releases (dernière en avril 2026)
gh release download --repo Lightricks/LTX-Desktop --pattern "*amd64.deb" --dir .
sudo apt install -y ./LTX-Desktop-amd64.deb

# au premier lancement, l'app DL les poids (~42 GB BF16 ou ~20 GB FP8)
# vérifier où ça atterrit (probable ~/.cache/ltx-desktop/ ou ~/Library équivalent)
```

### Phase 6 — Poids LTX-2.3 (40-60 min selon bande passante, ~50 GB disque)

Si on veut utiliser LTX-2.3 dans **ComfyUI** (l'app desktop télécharge ses propres poids séparément, pas idéal pour le partage) :

```bash
cd ~/DEV/ComfyUI/models/checkpoints
# auth HF (token gratuit)
huggingface-cli login

# distilled (recommandé pour démarrer — plus rapide, ~8 steps)
huggingface-cli download Lightricks/LTX-2.3 ltx-2.3-22b-distilled-1.1.safetensors --local-dir .

# upscalers
cd ~/DEV/ComfyUI/models/latent_upscale_models
huggingface-cli download Lightricks/LTX-2.3 ltx-2.3-spatial-upscaler-x2-1.1.safetensors --local-dir .
huggingface-cli download Lightricks/LTX-2.3 ltx-2.3-temporal-upscaler-x2-1.0.safetensors --local-dir .

# text encoder Gemma-3 12B (Q4)
mkdir -p ~/DEV/ComfyUI/models/text_encoders/gemma-3-12b-it-qat-q4_0-unquantized
cd ~/DEV/ComfyUI/models/text_encoders/gemma-3-12b-it-qat-q4_0-unquantized
huggingface-cli download google/gemma-3-12b-it-qat-q4_0-unquantized --local-dir .
```

**Test rapide** : ouvrir ComfyUI, charger un workflow exemple `ComfyUI-LTXVideo/example_workflows/`, générer un clip 1080p 5s. Sur 1× 3090 en FP8 : ~3-5 min/clip. Sur 2× 3090 model-parallel : peut-être 1.5-2 min.

### Phase 7 — Briques robot (à arbitrer avec Patrice sur place)

À sélectionner selon les priorités du jour. Suggestions classées par utilité robot :

**Vision (perception)** :
- **CLIP / SigLIP** : embedding image-texte (déjà via custom nodes ComfyUI ou pip direct)
- **SAM 2 (Segment Anything)** : segmentation objets/scènes — `pip install ultralytics` ou repo Meta
- **Depth Anything v2** : profondeur monoculaire pour navigation
- **YOLOv11** : détection temps réel

**Manipulation / policy** :
- **OpenVLA** : Vision-Language-Action model (Stanford, open-weights). 7B params, tient sur 1 RTX 3090.
- **Octo** : policy generaliste robot (Berkeley)

**Simulation** :
- **MuJoCo MJX** : sim physique GPU-accelerated (le plus mainstream pour RL robot)
- **Genesis** : sim récente, multi-physique, GPU-natif

**Voix (déjà sur Ministar — à dupliquer DARKSTAR si robot utilise GPU)** :
- Piper TTS (CPU fine, dupliquer si on veut audio génératif intégré)
- faster-whisper (peut bénéficier du GPU CUDA → 5-10× speedup vs CPU Ministar)

**Reco du soir** : démarrer phase 7 simple — installer **faster-whisper en CUDA** (utile direct, gain x10 vs Ministar) + **Depth Anything v2** + **SAM 2**. Le reste (OpenVLA, simu) viendra quand le pipeline robot aura un cas d'usage concret.

## Garde-fous

- **Ne pas casser le venv `world-model/`** : utiliser `~/DEV/ComfyUI/.venv/` séparé. Si conflit drivers CUDA / PyTorch, créer un venv spécifique pour ComfyUI dans une version torch différente sans toucher world-model.
- **Espace disque** : monitor `df -h` avant chaque DL HF — LTX poids + Gemma-3 = ~55 GB, OpenVLA ~14 GB, autres modèles cumulés ~30+ GB. Viser 200 GB libres avant de commencer.
- **Tailscale en premier** (phase 1) → si DARKSTAR plante après quelque chose, on peut diagnostiquer à distance plutôt que devoir s'y rendre physiquement.
- **Journal** : créer `claude-et-patrice/journal/darkstar-DEV.md` dès phase 1 (suffixe `-DEV` pour rester cohérent avec convention journal Ministar).
- **Modèles ComfyUI partagés** : si tu finis par avoir 2 ComfyUI (Ministar CPU + DARKSTAR CUDA), envisage de monter `models/` via NFS ou un dossier réseau pour pas DL deux fois. À considérer plus tard, pas pour demain.

## Lien avec le robot

Cette session pose les fondations vidéo-gen + vision sur DARKSTAR :
- **ComfyUI CUDA** = pipeline génératif (assets, training data synthétique, simulation visuelle)
- **LTX-2.3** = vidéo génération haute qualité (storyboarding behaviors robot, démos)
- **SAM 2 + Depth + faster-whisper CUDA** = perception temps réel (le robot "voit" et "entend")

Combiné à Ministar (LLMs Ollama, voix Piper edge, services 24/7) et au futur ROCm/NPU XDNA quand débloqué, on a la couche **dual-machine** : DARKSTAR pour la lourde, Ministar pour le quotidien edge.

Le robot lui-même tournera plus tard sur du SoC embedded (Jetson, Orin, ou équivalent AMD si XDNA mature) — DARKSTAR reste la station d'entraînement et de génération offline.
