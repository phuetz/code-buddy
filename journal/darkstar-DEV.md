# Journal — DARKSTAR (PC 3090, Windows)

> Hostname : `DARKSTAR`
> Hardware : Intel Core **i7-9700** (8c/8t, 2018, AVX2 only, **PCIe 3.0**),
> **64 GB DDR4** (~50 GB/s), **2× RTX 3090** (24 GB chacune, 48 GB VRAM total
> CUDA, à vérifier NVLink).
> OS : **Windows** (édition à confirmer en première session)
> Rôle : machine principale **vidéo-gen + briques robot** (LTX-2.3, ComfyUI
> CUDA, SAM 2, Depth Anything v2, faster-whisper CUDA, world-model JEPA).

## 2026-05-01 — Bootstrap pour Claude DARKSTAR

> Cette entrée est écrite **depuis Ministar Linux** (Claude Opus 4.7 1M) et
> sert de point de départ pour le Claude qui démarrera sur DARKSTAR. Lecture
> obligatoire : `BRIEFING_NOUVEAU_CLAUDE.md` + cette entrée + le plan
> `propositions/PLAN-DARKSTAR-INSTALL-2026-05-02.md` (écrit en bash, à
> **porter Windows** — voir adaptations ci-dessous).

### État réseau

- **Tailscale installé** sur DARKSTAR ✅ (par Patrice avant cette session)
- **IP tailnet** : `100.73.222.64`
- Joignable depuis Ministar Linux : `ping 100.73.222.64` répond (latence
  7-68ms via DERP — pas encore qualifié direct)
- **SSH (port 22)** : ❌ fermé. OpenSSH Server pas activé.
- **RDP (port 3389)** : ❌ fermé. Remote Desktop pas activé.

### Tailnet actuel

| Node | IP | OS | Compte | Statut |
|---|---|---|---|---|
| `ministar-linux` | 100.98.18.76 | Linux (Ubuntu 24.04) | patrice.huetz | actif |
| `ministar` (= G7 PT Windows) | 100.90.108.4 | Windows | patrice.huetz | actif direct |
| `darkstar` | 100.73.222.64 | Windows | patrice.huetz | en ligne |
| `oppo-find-x5-pro` | 100.83.91.39 | Android | patrice.huetz | offline |
| `pc-asus-seb` | 100.73.117.67 | Windows | sebastien.yge (collaborateur) | offline |

### Actions prioritaires (à faire au démarrage de la 1ère session DARKSTAR)

**1. Activer un canal d'accès distant** (choisir A, B ou C — reco = C).

C — **Tailscale SSH** (le plus simple, pas de gestion clés/mdp) :
```powershell
# PowerShell admin
tailscale up --ssh
```

A — **OpenSSH Server natif Windows** :
```powershell
# PowerShell admin
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType 'Automatic'
New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server (sshd)' `
  -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
```

B — **RDP** (utile pour l'UI ComfyUI/LTX-Desktop, requiert édition Pro) :
Settings → System → Remote Desktop → On.

**2. Audit hardware** (équivalent phase 0 du plan, en PowerShell) :
```powershell
nvidia-smi
nvidia-smi nvlink --status   # CRITIQUE : présence d'un pont NVLink ?
nvcc --version 2>$null
Get-WmiObject Win32_PhysicalMemory | Select Capacity, Speed, Manufacturer
Get-Volume                    # espace disque libre
python --version 2>$null
git --version 2>$null
```

**3. Décider OS d'exécution stack ML** :
- **Windows natif** (recommandé) : ComfyUI portable Windows + PyTorch CUDA
  Windows + uv. Aucune couche WSL = perfs CUDA directes.
- **Windows + WSL2** : préserve Windows host, stack ML en Ubuntu 24.04 sous
  WSL2 avec NVIDIA WSL driver. Cohérent avec Ministar Linux mais I/O ~10-20%
  plus lent.

### Adaptations du plan original `PLAN-DARKSTAR-INSTALL-2026-05-02.md`

Le plan a été écrit en bash Linux. Pour Windows natif, transposer :

| Phase | Linux (plan original) | Windows natif équivalent |
|---|---|---|
| 0 — Audit | `lsb_release -a`, `nvidia-smi`, `df -h` | PowerShell `nvidia-smi`, `Get-Volume`, `Get-CimInstance Win32_OperatingSystem` |
| 1 — Tailscale | `curl install.sh \| sh` | ✅ déjà fait (client Windows) |
| 2 — Outils | `apt install ffmpeg uv pnpm node` | `winget install` ou `choco install` (`ffmpeg`, `uv` via PowerShell, `nodejs-lts`, `pnpm`) |
| 3 — ComfyUI | `git clone + uv venv + torch CUDA` | **`ComfyUI_windows_portable_nvidia.7z`** (release officielle, pré-bundlée) |
| 4 — Custom nodes | `git clone` dans `custom_nodes/` | Idem, identique |
| 5 — LTX-Desktop | `.deb amd64` | **Skipper** (Gemini : "pollution Electron"), ComfyUI suffit |
| 6 — Poids LTX-2.3 | `huggingface-cli download` | Idem, `pip install huggingface-hub` |
| 7 — Briques robot | varies | varies (Windows pip identique) |

### Contraintes hardware à respecter

1. **Pas de NVLink** = stratégie probable : **2 instances ComfyUI séparées**
   sur ports différents avec `CUDA_VISIBLE_DEVICES=0` et `=1` — une pour
   LTX-2.3 (FP8 ~20 GB tient sur 1× 3090), l'autre pour vision/SAM 2/Depth
   Anything. Vérifier `nvidia-smi nvlink --status` au démarrage.
2. **PCIe 3.0** (i7-9700) = 16 GB/s/GPU max. Model parallel BF16 cross-GPU
   sera lent. **Rester sur FP8 ou distilled** pour LTX-2.3 (tient sur 1 GPU).
3. **AVX2 only** (pas AVX-512) = certains kernels CPU fallback plus lents.
   Marginal pour ML pur GPU.
4. **NVENC** (encodage vidéo H.264/H.265 hardware sur 3090) = utiliser pour
   ffmpeg final, **pas** x264 sur le i7-9700 qui ramerait sur du 4K.
5. **PyTorch DataLoader `num_workers=4-6`** max (8 cores du i7), pas 12+.
6. **Flash-attention 2** : `pip install flash-attn --no-build-isolation`
   après PyTorch CUDA. Critique pour Transformer 22B (×2 perf attendu).
7. **xformers** : recommandé en complément.

### Trous identifiés par Gemini (dans `propositions/REVIEW-NUIT-DARKSTAR-2026-05-01.md`)

À intégrer avant phases 3+ :
- Conflits requirements.txt entre custom_nodes (faire install groupée)
- `extra_model_paths.yaml` pour modèles partagés (préparer disque dédié)
- ROS2 (Humble/Jazzy) à installer maintenant pour figer la stack robot
- Reco minimaliste phase 7 : SAM 2 + Depth Anything v2 + faster-whisper CUDA

### Lien Ministar Linux

- **IP tailnet** : `100.98.18.76` — depuis DARKSTAR, `ssh patrice@100.98.18.76`
  marche (sous réserve d'avoir un client SSH).
- **Stack AI Ministar** :
  - Ollama 0.22.1 + backend Vulkan validé sur 890M (qwen3.6 35B-a3b en VRAM
    unifiée 64 GB partition iGPU). Plafond eval rate = DDR5 90 GB/s
    (memory-bound APU). Prompt eval ×2.4 OK.
  - Open WebUI :8080, Qdrant :6333, SearXNG :8888, LiteLLM :4000.
  - Voix Piper FR (Siwis F + Tom M) + faster-whisper int8 CPU validés.
- **Convention multi-IA** : si volume → Codex/Gemini en parallèle (cf.
  `BRIEFING_NOUVEAU_CLAUDE.md`).

### Conventions journal

- Ce fichier est `darkstar-DEV.md`. Si tu lances Claude dans un autre
  working directory (par ex. `world-model/`), crée plutôt `darkstar-world-model.md`
  selon la convention `<hostname>-<basename-cwd>.md`.
- `git pull --rebase` avant ta première écriture.
- Append-only, chaque entrée datée.
- Ajouter ton fichier dans `journal/README.md` mapping si nouveau.

### Pour me joindre depuis DARKSTAR

Si Tailscale SSH activé sur DARKSTAR, je peux te (Claude DARKSTAR) joindre
depuis Ministar Linux via :
```bash
ssh patrice@100.73.222.64        # ou patrice@darkstar via MagicDNS
```

Et inversement, depuis DARKSTAR (PowerShell) :
```powershell
ssh patrice@100.98.18.76         # Ministar Linux
```

Permet de cross-check (ex. : DARKSTAR pull modèles depuis HF, Ministar
prépare workflows JSON et les push à `http://darkstar:8188/prompt`).

### À faire au plus tôt (récap)

1. ✅ Tailscale up
2. ⏳ Activer Tailscale SSH (`tailscale up --ssh`) ou OpenSSH Server
3. ⏳ Audit hardware (nvidia-smi nvlink --status critique)
4. ⏳ Décider Windows natif vs WSL2 pour la stack ML
5. ⏳ Réécrire `PLAN-DARKSTAR-INSTALL-2026-05-02.md` en version Windows
   (laisser le bash original comme référence)
6. ⏳ Phases 2-7 du plan adapté
7. ⏳ Premier bench LTX-2.3 distilled FP8

— Claude Opus 4.7 (1M context), depuis Ministar Linux

---

## 2026-05-03 ~00h30 — Auto-start spoke `ollama-darkstar` LIVE + patch défensif wrapper

Session DARKSTAR depuis `D:\DEV` (cwd, hostname DARKSTAR). Suite à la
proposition `propositions/FLEET-WINDOWS-AUTOSTART-2026-05-02.md`, mise
en place de l'auto-start adapté à l'état réel de la machine.

### Adaptations vs proposition

| Item | Proposition initiale | Appliqué DARKSTAR |
|---|---|---|
| `OLLAMA_HOST` scope | Machine (UAC) | **User** (sans admin) |
| Trigger task | `AtStartup` + `SYSTEM` | **`AtLogon` user** (pattern MINISTAR validé hier 14h15) |
| Ollama exe dans la task | `Restart-Service Ollama` (n'existe pas) puis `ollama app.exe` | **`ollama.exe serve`** (root cause du 1er échec : `ollama app.exe` UI systray ne lance pas le serveur) |
| Wrapper path | `D:\DEV\world-model\scripts\…` (V0 register-only, pas de :3002) | **`D:\DEV\grok-cli\scripts\ollama_a2a_spoke.py`** (FastAPI :3002, commit `367adb6` cross-platform) |
| Python | `(Get-Command python.exe).Source` | **`C:\Users\patri\venv\Scripts\python.exe`** (deps fastapi/uvicorn/httpx déjà présentes) |
| Firewall :3002 | Bloque sans admin | best-effort, skip si non-admin |

Script déposé : `claude-et-patrice/tools/setup_a2a_autostart_darkstar.ps1`
(synced sur le Bureau OneDrive de Patrice).

### Pré-requis livrés en cours de session

- Repo `D:\DEV\world-model` cloné (utile pour le training V3, pas pour le wrapper).
- Repo `D:\DEV\grok-cli` pulled (mini-patch local DARKSTAR `hostname` stash@{0}, supplanté par fix officiel `367adb6` upstream).
- Mini-patch local préservé en stash au cas où.

### Validation

- `OllamaServer` (scheduled task, AtLogon) → registered, `ollama.exe serve` LISTENING `0.0.0.0:11434`, 2× RTX 3090 reconnus (48 GiB VRAM total, driver 13.1, CUDA 8.6).
- `OllamaA2ASpoke` (scheduled task, AtLogon) → registered, FastAPI uvicorn LISTENING `:3002`, 4 skills exposées (qwen3.6:35b-a3b-q4_K_M, gemma4:26b, qwen3:4b, nomic-embed).
- `ollama-darkstar` registered au hub (`100.98.18.76:3000/api/a2a/agents` → remoteAgents inclut DARKSTAR).
- Direct wrapper test depuis DARKSTAR : `POST /api/a2a/tasks/send qwen3:4b` → completed en 17s.

### Bug hub résiduel + patch défensif wrapper

Smoke E2E `hub → ollama-darkstar` retourne `Internal Server Error` en 4s.
Reproduction locale en envoyant le body que le hub *pre-Phase-B* envoie
(le bug est : `text` est un dict imbriqué au lieu d'une string —
exactement le **Risque 2** de l'audit matinal, fixé côté hub par commit
`8a9f5f4` que Claude/Ministar Linux n'a toujours pas pulled au moment
de cette session).

**Patch défensif livré localement** (à committer sur `phuetz/grok-cli`) :
helper `_extract_text(value)` dans le wrapper qui dépile récursivement
un éventuel objet A2A nested. Validation locale : avec body buggé,
le wrapper renvoie maintenant `completed` ("How are you") au lieu de
`500`. **Conséquence** : DARKSTAR est désormais résilient même quand
le hub n'a pas pulled — le mesh tient avec un seul côté à jour.

### État GPU final session

- 2× RTX 3090, 256/289 MiB used, 0% util (Ollama décharge après idle).
- qwen3.6:35b-a3b-q4_K_M déjà chargeable (était utilisé hier par MINISTAR via hub).
- Pull qwen2.5-coder:14b lancé (1ère tentative TLS handshake timeout, retry en cours en background).

### Ce qui reste pour fleet complet

1. **Claude/Ministar Linux** : `git pull origin main` du `code-buddy` + `sudo systemctl restart codebuddy-a2a.service` pour activer le router fix Phase B `8a9f5f4`. Patrice n'a rien à faire — c'est dans la queue de Claude/Ministar Linux.
2. **DARKSTAR** : test résilience reboot (au prochain redémarrage Windows, vérifier que les 2 tasks démarrent au logon et que le spoke réapparaît au hub sans intervention).
3. **Push grok-cli** : commit le patch `_extract_text` (PR à part).

— Claude Opus 4.7 (1M context), DARKSTAR / DEV, 3 mai 2026 ~00h30 UTC
