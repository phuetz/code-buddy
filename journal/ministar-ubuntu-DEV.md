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
| **searxng** | 8888 | métamoteur self-hosted (FR par défaut), validé `/search?q=test&format=json` |
| **litellm** | 4000 | gateway OpenAI-compat, route ollama-{gemma4,qwen3,embed} (host network) |
| **ai-redis** | 6380 | cache LiteLLM (host network, 6379 occupé par MonArtisan) |

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

### LiteLLM — gateway unifié

Config dans `ai-stack/litellm/config.yaml`. `master_key=sk-ministar-local`
dans `.env` (gitignored). Test validé :

```
curl -H "Authorization: Bearer sk-ministar-local" \
     http://127.0.0.1:4000/v1/chat/completions \
     -d '{"model":"ollama-qwen3","messages":[{"role":"user","content":"..."}]}'
```

Lisa et tout client OpenAI-compat peuvent pointer ici. Ajouter clés
Anthropic/Gemini dans `.env` + décommenter dans `config.yaml` pour activer.

### Scripts d'install prêts (sudo requis, à lancer par Patrice)

- `ai-stack/install_rocm.sh` — ROCm 7.2 (doc AMD officielle) avec garde
  kernel 6.17 (peut nécessiter downgrade vers HWE 6.14 si dkms échoue)
- `ai-stack/install_lemonade.sh` — Lemonade Server v10.3.0 (28 avr) via
  PPA officielle `lemonade-team/stable`. Officiellement supporté Ubuntu
  24.04, NPU XDNA2 via FLM backend, ROCm 7.2 stable.

À lancer dans cet ordre depuis Claude Code : `! sudo ./install_rocm.sh`,
reboot, puis `! sudo ./install_lemonade.sh`.

### Modèles Ollama dispos après cette session

| Modèle | Taille | Usage |
|---|---|---|
| `gemma4:26b` | 16 GB | LLM principal généraliste |
| `qwen3:4b` | 2.6 GB | LLM rapide pour itération / agents légers |
| `nomic-embed-text` | 274 MB | embeddings RAG (Qdrant + Open WebUI) |

Avec 64 GB VRAM iGPU (post-ROCm 7.2), faisable de descendre du 70B Q4.

### Helpers

- `ai-stack/start-stack.sh` — vérifie/démarre Ollama, Open WebUI, et le compose
  (Qdrant, SearXNG, LiteLLM, Redis). Idempotent. Affiche health checks et URLs.
  `./start-stack.sh --with-comfy` lance aussi ComfyUI en background sur :8188.

### Ports occupés sur Ministar Linux après cette session

- 3000 → MonArtisan web (Docker)
- 4000 → LiteLLM
- 5434 → MonArtisan postgres (Docker)
- 6333 / 6334 → Qdrant
- 6379 → MonArtisan Redis (Docker)
- 6380 → ai-redis (cache LiteLLM)
- 8080 → Open WebUI
- 8188 → ComfyUI (à la demande)
- 8888 → SearXNG
- 11434 → Ollama (127.0.0.1 only)
- _futur_ 8000 → Lemonade Server

### Note continuité

Ce PC est en train de prendre forme comme **runtime robot futur** du
briefing — voir `etat_projets.md` "Hardware Lab" ligne sur le PC Ubuntu.
Mémoire `project_lab_hardware.md` mise à jour avec les vraies specs
(64+64, hostname `Ministar` homonyme, NPU XDNA actif).

— Claude Opus 4.7 (1M)

## 2026-04-29 (soir) — Accès distant Tailscale

Patrice rentré chez lui. Mise en place du VPN mesh Tailscale pour pouvoir
attaquer Ministar Linux depuis le G7 PT et le futur poste mobile.

### Fait

- Helper `ai-stack/install_tailscale.sh` créé (idempotent, sudo).
- Patrice a lancé le script sous Linux (sudo + auth Google).
- Tailscale 1.96.4 actif, hostname `ministar-linux`, IP tailnet
  **`100.98.18.76`**, compte `patrice.huetz@gmail.com`.
- SSH server confirmé actif sur :22 → joignable via
  `ssh patrice@100.98.18.76` une fois les autres machines ajoutées.
- CLAUDE.md mis à jour : section "Accès distant — Tailscale" remplace
  l'ancienne "Prochaine session". TODO ROCm/Lemonade/qwen3.6 conservés.

### À faire ensuite

- Installer Tailscale sur **G7 PT Windows** (binaire depuis
  tailscale.com/download/windows, login Google même compte).
- Installer Tailscale sur **DARKSTAR**
  (`curl -fsSL https://tailscale.com/install.sh | sh` + `sudo tailscale up`).
- Une fois les 3 machines mêlées, valider `ssh ministar-linux` depuis G7 PT
  via MagicDNS.
- Reprendre les TODO : pull qwen3.6, install_rocm.sh, install_lemonade.sh.

— Claude Opus 4.7 (1M)
