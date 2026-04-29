# Journal — PC Ubuntu (`Ministar` Linux, futur runtime robot)

> Hostname `Ministar` (homonyme du G7 PT Windows mais machine distincte).
> Hardware : Minisforum, Ryzen AI 9 HX 470 (24c) + iGPU Radeon 890M, 128 GB
> physiques partitionnés **64 RAM / 64 VRAM iGPU** (BIOS), NPU XDNA actif
> (`accel0`), 2× 2 TB SSD. Ubuntu 24.04, kernel 6.17.

## 2026-04-29 — Pose de la stack AI locale

Première session d'install d'une stack AI complète sur le PC Ubuntu, en vue
du runtime robot. Patrice : *"je voudrais installer une stack ai complète
pour travailler"*.

### État avant

Déjà présent : Ollama 0.21 (`gemma4:26b` chargé), Docker 29 (avec MonArtisan
en prod sur :3000 + postgres :5434), Python 3.13 miniforge + uv 0.11, Node 24,
Rust 1.95, ROCm 5.7 (trop vieux pour Radeon 890M), conda. Repos clonés :
ComfyUI (sans venv), AnythingLLM (juste docker-compose). Open WebUI
container `open-webui` créé le 27 avril, `network_mode: host`, port 8080,
healthy, branché Ollama 127.0.0.1:11434.

### Stack posée aujourd'hui (`/home/patrice/DEV/ai-stack/`)

`docker-compose.yml` regroupant les services persistants (open-webui *non*
inclus, géré hors compose pour ne pas écraser l'install du 27 avril) :

| Service | Port | Rôle |
|---|---|---|
| **qdrant** | 6333 / 6334 | vector DB pour RAG, healthy |
| **searxng** | 8888 | métamoteur self-hosted (FR par défaut), validé sur `/search?q=test&format=json` |

À brancher dans Open WebUI via Settings :
- RAG > Vector DB : Qdrant, URL `http://127.0.0.1:6333`
- Web Search : SearXNG, URL `http://127.0.0.1:8888/search?q=<query>&format=json`

### Stack voix (`ai-stack/voice/`) — brique runtime robot

- **Piper TTS** binaire 2023.11.14-2 + voix FR `fr_FR-siwis-medium` (61 MB)
  → `./piper/piper/piper --model voices/fr_FR-siwis-medium.onnx`
- **faster-whisper** dans venv uv 3.12 (`.venv/`)
- **Boucle TTS→STT validée** : Piper synthétise *"Bonjour Patrice, la stack
  voix fonctionne. Je peux parler français."*, faster-whisper base int8 CPU
  retranscrit `lang=fr prob=1.00` en ~4.5 s audio.

### ComfyUI

- venv uv Python 3.12 dans `/home/patrice/DEV/ComfyUI/.venv/`
- PyTorch **CPU** installé (le download ROCm 6.4 a timeout — relancer après
  install ROCm système)
- Smoke test : `python main.py --cpu --listen 127.0.0.1 --port 8188` démarre
  proprement, ComfyUI-Manager fetch le registry sans erreur. Pas laissé
  tournant — à démarrer à la demande.

### Reporté (sudo nécessaire ou téléchargements lourds à valider)

- **ROCm 6.4+ stack AMD officielle** — pour exploiter les 64 GB VRAM iGPU
  890M en inférence. ROCm 5.7 d'Ubuntu trop ancien pour RDNA 3.5. Bascule
  PyTorch ROCm + Ollama GPU une fois fait.
- **AMD Lemonade SDK** — runtime NPU XDNA + iGPU. Officiellement Linux
  supporté mais cible principale Windows. À explorer après ROCm 6.4.
- **Override Ollama** `OLLAMA_HOST=0.0.0.0` — pas appliqué (sudo password
  manquant). Pas critique : Open WebUI tourne en `network_mode: host` donc
  accède à 127.0.0.1:11434 directement.

### Modèle Ollama dispo

- `gemma4:26b` (16 GB) — le seul actuellement. Avec 64 GB VRAM iGPU
  (post-ROCm 6.4), faisable de descendre des 70B Q4.

### Ports occupés sur Ministar Linux après cette session

- 3000 → MonArtisan web (Docker)
- 5434 → MonArtisan postgres (Docker)
- 6333 / 6334 → Qdrant
- 8080 → Open WebUI
- 8888 → SearXNG
- 11434 → Ollama (127.0.0.1 only)

### Note continuité

Ce PC est en train de prendre forme comme **runtime robot futur** du
briefing — voir `etat_projets.md` "Hardware Lab" ligne sur le PC Ubuntu.
Mémoire `project_lab_hardware.md` mise à jour avec les vraies specs
(64+64, hostname `Ministar` homonyme, NPU XDNA actif).

— Claude Opus 4.7 (1M)
