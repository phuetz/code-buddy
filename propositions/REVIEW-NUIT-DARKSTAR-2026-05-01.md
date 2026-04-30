# Review nocturne du plan DARKSTAR — synthèse 2026-05-01 (nuit)

> Auteur : Claude Opus 4.7 (1M) — nuit 2026-05-01 → 2026-05-02
> Patrice dort, Ministar reste allumé. Travail délégué à Gemini + Codex.
> Statut : à lire au réveil avant de lancer DARKSTAR.

## TL;DR (à lire en premier)

Le plan `PLAN-DARKSTAR-INSTALL-2026-05-02.md` est solide sur la structure mais Gemini a identifié **5 trous critiques** que je n'avais pas couverts. Codex a généré un script idempotent pour les phases 0-2 (audit + Tailscale + outils système), syntax-validé OK. Brief stack robot 2026 reçu mais **plusieurs commandes d'install hallucinées** par Gemini — chaque `pip install` doit être vérifié avant exec.

**Verdict** : démarrer demain par le script (phases 0-2), puis revoir le plan en intégrant les 5 corrections ci-dessous avant phases 3+.

## 🚨 Top 3 actions critiques au réveil

1. **Vérifier la présence d'un pont NVLink** sur les 2× RTX 3090 (`nvidia-smi nvlink --status`). Sans NVLink, le model-parallel BF16 sur 22B params via PCIe sera lent. Stratégie de fallback : **2 instances ComfyUI sur ports séparés** (`8188` et `8189`) avec `CUDA_VISIBLE_DEVICES=0` / `=1`, une pour LTX-2.3 (FP8 ~20 GB tient sur une 3090), l'autre pour vision/SAM 2/Depth Anything.

2. **Installer FlashAttention-2 dès la phase 3** (`uv pip install flash-attn --no-build-isolation` après PyTorch CUDA). Sans ça, perfs vidéo divisées par 2 sur Transformer 22B. Oublié dans le plan initial.

3. **Auditer drivers NVIDIA + version CUDA AVANT de toucher au venv `world-model/`**. Si world-model utilise PyTorch 2.1 et qu'on installe 2.6+ pour LTX, mismatch driver libcuda possible. Phase 0 du script Codex couvre ça (audit lit `nvidia-smi`, `nvcc --version`, version Python world-model).

## Trous identifiés par Gemini (revue critique)

### Manquants dans le plan original
- **FlashAttention-2 + xformers** : non mentionnés. Critiques pour Transformer 22B sur 3090.
- **CUDA Toolkit complet (`nvcc`)** : nécessaire pour compiler `flash-attn` et certains custom nodes. Pas juste les libs runtime PyTorch.
- **ROS2 (Humble ou Jazzy)** : zéro mention dans le plan. Pour le robot 10 ans, à installer maintenant pour figer la stack middleware.
- **Conflits requirements.txt** : la boucle `for d in custom_nodes/*/` du plan phase 4 va probablement casser sur des conflits `protobuf`/`onnxruntime`/`numpy`. Faire une install groupée via `uv pip install -r requirements-merged.txt` avec resolveur global.
- **Shared models path** : utiliser `extra_model_paths.yaml` pour pointer vers `/mnt/data/models` partagé, pas DL dans `models/checkpoints` direct (évite duplication si on monte un disque dédié plus tard).

### Choix doctés à reconsidérer
- **LTX-Desktop (phase 5)** : Gemini la qualifie de "pollution Electron". À voir — l'app officielle est plus simple pour itérer rapidement, mais ComfyUI couvre tout fonctionnellement. Reco : **skipper LTX-Desktop**, rester sur ComfyUI pur.
- **Python 3.12** : à vérifier compatibilité `flash-attn` + ROS2 mai 2026. Si ROS2 Humble préfère 3.10, garder un venv séparé pour la partie robot. Python 3.11 est le compromis "safe" en doute.
- **Node 22** : Gemini propose Node 24 LTS. À confirmer en phase 0.
- **GGUF pour LTX-2.3** : `ComfyUI-GGUF` est déjà dans le plan custom_nodes — bonne idée d'utiliser GGUF Q4_K_M ou Q8 plutôt que BF16, gain ~40% vitesse. À tester après le premier run BF16/FP8 pour comparer.

## Brief stack robot 2026 (Gemini, à vérifier avant exec)

⚠️ **Caveat important** : Gemini hallucine fréquemment des noms de packages pip. Vérifier chaque commande sur HuggingFace / GitHub officiel avant install. Surtout suspects : `pi0-robotics`, `mss-phi4`, `nvidia-cosmos`, `pip install genesis-world` (le vrai package est `pip install genesis-world` mais à confirmer).

### Verdicts Gemini classés par utilité robot (mai 2026)

**À installer en priorité phase 7** :
- **SAM 2.1 Large** (~600M, 12 GB VRAM) — segmentation persistante, manipulation
- **Depth Anything v2 ViT-L** (~335M, 6 GB VRAM) — profondeur monoculaire, navigation
- **YOLO11-X** (~50M, 2 GB VRAM) — détection basse latence (humains, obstacles)
- **V-JEPA-2** (~1B, 8 GB VRAM) — aligné avec ton repo `world-model/` actuel
- **Pi0** (Physical Intelligence, 7B, 16-20 GB VRAM) — VLA dominant en mai 2026 selon Gemini, à VÉRIFIER (Pi0 sortie réelle ?)
- **Genesis** (4-12 GB VRAM) — simulateur GPU différentiable, alternative MJX/Isaac
- **Qwen2.5-Omni 7B** (~15 GB VRAM) — multimodal end-to-end (audio+vision+texte), peut remplacer Piper+Whisper si l'expérience est concluante

**À suivre / pas urgent** :
- OpenVLA-v2 (alternative à Pi0, moins fluide selon Gemini)
- NVIDIA Cosmos-1.0 (13B, 28 GB) — world model vidéo réaliste, gourmand
- Isaac Lab (Omniverse) — lourd mais référence industrielle pour fidélité visuelle
- Moshi (Kyutai) — full-duplex speech, intéressant pour interaction temps réel robot

**À zapper selon Gemini** :
- Octo (rigide vs Transformer-action 2026)
- MuJoCo MJX (Genesis serait supérieur — à challenger, MuJoCo reste une référence)
- Phi-4-Multimodal (moins bon que Qwen-Omni sur tâches de manipulation)
- Gaia-X (orienté conduite autonome, pas robot compagnon)

### Reco minimaliste pour demain (phase 7)
Si on veut juste déballer 2-3 briques sans passer la journée : **SAM 2 + Depth Anything v2 + faster-whisper CUDA** (le faster-whisper-CUDA c'est juste une réinstall de ce qu'on a sur Ministar mais avec backend CUDA → gain ~10× sur transcription). Le reste (VLA, simu, world-model) viendra avec un cas d'usage robot concret, pas dans le vide.

## Script généré pour phases 0-2

**Fichier** : `propositions/install_darkstar_phase_0_to_2.sh` (généré par Codex, syntax-validé `bash -n` OK).

**Ce qu'il fait** :
- Vérifie Ubuntu 22.04 / 24.04 (autres versions = abort)
- **Phase 0 audit** : OS, kernel, disque, RAM, CPU, GPU (`nvidia-smi`, `nvcc`, `lspci`), Python, venv détectés, recherche `world-model/` / venvs existants. Sortie dans `/tmp/darkstar-audit-<timestamp>.log`.
- **Phase 1 Tailscale** : check si déjà installé sinon `curl install.sh` officiel. Confirmation `[y/N]` interactive avant sudo. **N'exécute PAS `tailscale up`** — Patrice doit le faire manuellement avec login Google.
- **Phase 2 outils** : git, ffmpeg, build-essential (apt avec confirmation), uv (script Astral), Node 22 (NodeSource setup_22.x → à reconsidérer Node 24, voir trou Gemini), pnpm (npm global).

**Garde-fous intégrés** :
- `set -Eeuo pipefail` + `trap ERR`
- Idempotent : `command -v` / `pkg_installed` check avant chaque install
- Confirmation TTY interactive avant chaque bloc sudo (`read -p [y/N]`) — donc **lancer en terminal direct, pas via SSH non-interactive**.
- Erreur explicite si stdin pas TTY pour les blocs sudo.
- Audit log dédié horodaté → traçable par session.

**Usage demain** :
```bash
cd /home/patrice/DEV/claude-et-patrice
git pull --rebase  # récupérer les artefacts de cette nuit (si push fait)
bash propositions/install_darkstar_phase_0_to_2.sh
```

**À modifier avant exec** (selon trous Gemini) :
- Si Patrice valide Node 24 plutôt que 22 → changer `setup_22.x` → `setup_24.x` dans phase_2.
- Ajouter en phase 2 : `uv pip install flash-attn --no-build-isolation` (à faire après PyTorch CUDA, donc en phase 3 plutôt — pas modifier phase 0-2).

## Artefacts produits cette nuit

```
/tmp/night-work/
├── prompt_review_darkstar.txt              # prompt Gemini revue plan
├── prompt_brief_robot.txt                  # prompt Gemini brief robot
├── review-plan-darkstar-gemini.md          # raw Gemini revue (33 lignes)
├── review-plan-darkstar-gemini.err         # logs warning systemd-private
├── brief-stack-robot-2026-gemini.md        # raw Gemini brief (46 lignes)
├── brief-stack-robot-2026-gemini.err       # logs
├── install_darkstar_phase_0_to_2.sh.draft  # raw Codex script
└── codex-install-script.err                # raw Codex stderr (276 lignes)
```

Outputs persistés dans `claude-et-patrice/propositions/` :
- `REVIEW-NUIT-DARKSTAR-2026-05-01.md` (ce fichier)
- `install_darkstar_phase_0_to_2.sh` (script Codex relu, exécutable)

## Limites et notes pour Patrice

- **Push GitHub bloqué** : pas de credential HTTPS / SSH GitHub configuré sur Ministar. Le commit `50e9a13` (plan DARKSTAR initial) + le commit de cette nuit restent locaux. Faire `git push` au matin une fois que tu as configuré le credential (PAT GitHub ou clé SSH ajoutée à GitHub).
- **Vérifications avant exec** :
  - `nvidia-smi nvlink --status` → décide stratégie GPU (model-parallel ou 2 instances)
  - Test pip / git réel pour chaque "à installer" du brief robot avant de lancer aveuglément
  - Lire le log d'audit phase 0 AVANT de lancer phases 3+, c'est ce qui dira si world-model risque d'être impacté
- **Token costs** : ~58 K tokens consommés (Gemini ×2 + Codex ×1). Approche valide pour la délégation volume → garder Claude pour l'arbitrage.

— Claude Opus 4.7 (1M)
