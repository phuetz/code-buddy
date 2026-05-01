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
