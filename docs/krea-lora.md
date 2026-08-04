# Krea 2 LoRA — Code Buddy

Pipeline **dataset → train (cloud fal ou local) → install ComfyUI**, aligné sur le workflow des
tutoriels *Krea 2 LoRA Training* (setup local type « 1-clic » + train cloud économique). Sert à
créer un **personnage ou style stable** (ex. avatar **Lisa**) utilisable dans ComfyUI et les
recettes image de Code Buddy.

| | |
|---|---|
| **CLI** | `buddy lora` |
| **Code** | `src/lora/`, `src/commands/lora.ts` |
| **Opt-in cloud** | `CODEBUDDY_LORA_TRAIN=true` + `FAL_KEY` |
| **Tests** | `tests/lora/` |

## Pourquoi

Les compagnons vocaux (Lisa) ont une identité parlée forte, mais pas toujours un **visage
reproductible**. Un LoRA Krea 2 sur 40–50 images donne une identité visuelle cohérente pour :

- portraits / cartes Cowork ;
- scènes générées (storyboard, film, media library) ;
- continuité multi-plans (même « Lisa » d’une image à l’autre).

## Prérequis

| Chemin | Besoin |
|--------|--------|
| **Cloud** (souvent le moins cher, sans VRAM) | `FAL_KEY` (ou `FAL_API_KEY`) + `CODEBUDDY_LORA_TRAIN=true` |
| **Local** | GPU + [AI-Toolkit](https://github.com/ostris/ai-toolkit) / musubi-tuner / installateur 1-clic du tutoriel |
| **Install ComfyUI** | `COMFYUI_ROOT`, ou `~/ComfyUI`, `~/DEV/ComfyUI`, `~/.codebuddy/comfyui` |

**Prix fal (indicatif)** : ~**$0.003 / step** (minimum 100 steps facturés) → environ **$3** pour
1000 steps. Vérifier le tarif courant sur
[fal-ai/krea-2-trainer](https://fal.ai/models/fal-ai/krea-2-trainer).

## Démarrage rapide — Lisa

```bash
# 1. Projet + dossier images
buddy lora lisa
# → .codebuddy/lora/lisa/images/

# 2. Déposer 40–50 portraits (PNG/JPG/WebP), angles et lumières variés

# 3. Valider (+ écrire les .txt manquants avec le trigger)
buddy lora validate lisa --fill-captions
buddy lora validate lisa --quality   # size + exact-duplicate gate

# 4a. Train cloud
export FAL_KEY=…
export CODEBUDDY_LORA_TRAIN=true
buddy lora train cloud lisa --steps 1000

# 4b. Ou plan local (config + script, sans télécharger multi-Go)
buddy lora train local lisa
# puis : export AI_TOOLKIT_DIR=… && bash .codebuddy/lora/lisa/train-local.sh

# 5. Installer dans ComfyUI models/loras
buddy lora install .codebuddy/lora/lisa/output/<fichier>.safetensors --name lisa

buddy lora list
```

**Trigger par défaut Lisa** : `ohwx lisa`.
Dans ComfyUI : base **Krea 2** + LoRA `lisa.safetensors`, prompts contenant le trigger.

### Bible avatar multi-style (inspirée de la vidéo 1-clic)

Source : [Krea 2 LoRA Training — 1-Click Local & Cloud](https://www.youtube.com/watch?v=GQusMZgc1RE)
Code : `src/lora/lisa-avatar-bible.ts`.

**Oui, plusieurs styles d’avatars** — comme la grille de la thumbnail :

| Concept | Détail |
|---------|--------|
| **1 visage (LoRA)** | Identité verrouillée + trigger `ohwx lisa` |
| **N styles** | `studio`, `wet-selfie`, `street-rain`, `neon-skate`, `soft-editorial`, + moods |
| **N profils** | `lisa` = brune de la vidéo · `lisa-classic` = châtain doux (legacy) |

```bash
buddy lora avatars
buddy lora selfie --style studio
buddy lora selfie --style wet-selfie
buddy lora selfie --style street-rain
buddy lora selfie --style neon-skate
buddy lora selfie --style soft-editorial
buddy lora dataset lisa --avatar lisa --count 40 --no-resume
```

Env : `CODEBUDDY_LISA_AVATAR=lisa` (défaut) ou `lisa-classic`.

## Monostack train / inférence (important)

| Phase | Checkpoint idéal | Interim acceptable |
|-------|------------------|--------------------|
| **Dataset synthétique** | Même base que le train (Krea 2) | `sd_turbo` (rapide sur iGPU ; **drift** si tu trains sur Krea) |
| **Train cloud fal** | **Krea 2** (`fal-ai/krea-2-trainer`) | — |
| **Inférence selfie / Comfy** | **Même base que le train** + `lisa.safetensors` | base turbo sans LoRA = visage non verrouillé |

Env pour aligner l’inférence Comfy sans retoucher le dataset générateur :

| Variable | Rôle |
|----------|------|
| `CODEBUDDY_LORA_INFER_CHECKPOINT` | Checkpoint Comfy prioritaire pour selfies / image_gen (ex. `krea2.safetensors`) |
| `CODEBUDDY_IMAGE_MODEL` | Fallback générique (souvent `sd_turbo.safetensors` pour le dataset overnight) |
| `COMFYUI_CHECKPOINT` | Alias historique |
| `CODEBUDDY_COMFYUI_LORA` | `auto` / `lisa` / `none` — charge `LoraLoader` si un fichier LoRA est installé |

**Recommandation** : une fois le LoRA Krea entraîné, fixer :

```bash
export CODEBUDDY_LORA_INFER_CHECKPOINT=krea2.safetensors   # nom exact sous models/checkpoints
export CODEBUDDY_COMFYUI_LORA=auto
```

Si tu as généré le dataset en `sd_turbo` et que tu trains en Krea, accepte un peu de drift **ou** régénère 40 images sur la base Krea avant un second train.

Overnight : `scripts/overnight-lisa.sh` → toujours écrit `.codebuddy/lora/lisa/MORNING-REPORT.md`.

### Darkstar (2×3090) — train + Comfy offline

Voir **[`docs/darkstar-lora.md`](darkstar-lora.md)** : SSH `patri@100.73.222.64`, Comfy `http://100.73.222.64:8188`, train local `train-lisa-lora-comfy.py` (sans FAL).

### Recette Comfy versionnée

Workflow portrait Lisa (Checkpoint + LoraLoader optionnel) :

[`src/lora/workflows/lisa-portrait.json`](../src/lora/workflows/lisa-portrait.json)

Aligné sur `buildComfyWorkflow()` dans `media-generation-tool.ts`. Placeholders `{{CHECKPOINT}}`, `{{LORA_NAME}}`, `{{PROMPT}}`, `{{NEGATIVE}}`.

## CLI complète

```bash
buddy lora init <name> [--trigger "ohwx person"] [--character lisa] [--root DIR]
buddy lora validate <name|path> [--fill-captions] [--quality]
buddy lora dataset [lisa] [--count 40] [--trigger "ohwx lisa"]  # génère images d'entraînement (ComfyUI)
buddy lora pack <name|path> [--out file.zip]
buddy lora train cloud <name|path> [--steps 1000] [--trigger …] [--resolution 768|1024] \
  [--lr 0.0005] [--auto-caption Off|Object/Character|Style|Custom] [--out DIR]
buddy lora train local <name|path> [--steps 1500] [--trigger …] [--resolution 768|1024]
buddy lora install <file.safetensors> [--name id] [--comfy-root DIR]
buddy lora list
buddy lora status        # readiness: image backend, LoRA file, Telegram, FAL
buddy lora lisa          # raccourci init projet Lisa
buddy lora selfie [--mood …] [--scene …] [--no-telegram]
```

### Comportement train cloud

1. Valide le dataset (`images/` + trigger si pas de captions).
2. Empaquette un `dataset.zip` (images + `.txt` optionnels) via JSZip.
3. Upload sur `https://fal.media/files/upload`.
4. Soumet `https://queue.fal.run/fal-ai/krea-2-trainer` (`images_data_url`, `trigger_phrase`,
   `steps`, `learning_rate`, `resolution`, `auto_captioning`).
5. Poll le statut jusqu’à `COMPLETED`.
6. Télécharge le `.safetensors` (+ config) dans `.codebuddy/lora/<name>/output/`.

Sans `CODEBUDDY_LORA_TRAIN=true`, la commande **refuse** (upload + coût monétaire).

### Comportement train local

Écrit dans le projet :

- `ai-toolkit-krea2.json` — config type AI-Toolkit (base `krea/Krea-2-Raw`, low_vram, steps…) ;
- `train-local.sh` — cherche `AI_TOOLKIT_DIR`, `~/ai-toolkit`, `~/DEV/ai-toolkit` ;
- `LOCAL-TRAIN.md` — consignes 16 Go VRAM, cloud alternatif, install finale.

**Ne télécharge pas** les poids multi-Go ni le framework trainer.

## Structure projet

```text
.codebuddy/lora/<name>/
  project.json              # meta + trigger
  README.md
  images/                   # png/jpg/webp + optionnel same-stem .txt
  dataset.zip               # après pack / train cloud
  output/                   # poids téléchargés
  ai-toolkit-krea2.json     # après train local
  train-local.sh
  LOCAL-TRAIN.md
```

### Conseils dataset (character)

| Param | Recommandation |
|-------|----------------|
| Nombre d’images | 40–50 (minimum pratique ~15, max confortable ~80) |
| Captions | Optionnel ; sans `.txt`, le **trigger** est requis (`auto_captioning=Off`) |
| Steps | 1000–1500 pour une ressemblance typique |
| Résolution | `768` (plus rapide) ou `1024` (détail) |
| Contenu | Même sujet, angles/lumières variés ; éviter gros textes en overlay |

## Variables d’environnement

| Variable | Rôle | Défaut |
|----------|------|--------|
| `CODEBUDDY_LORA_TRAIN` | Autorise `buddy lora train cloud` (upload + facturation fal) | unset / off |
| `FAL_KEY` / `FAL_API_KEY` | Clé API fal.ai | unset |
| `COMFYUI_ROOT` | Racine ComfyUI pour `buddy lora install` | auto (`~/ComfyUI`, …) |
| `CODEBUDDY_IMAGE_PROVIDER` | Génération image runtime (ex. `comfyui`) | selon config |
| `COMFYUI_URL` | Endpoint ComfyUI pour `image_generate` | `http://127.0.0.1:8188` |
| `AI_TOOLKIT_DIR` | Chemin AI-Toolkit pour `train-local.sh` | unset |

## Sécurité

- Train **cloud** strictement **opt-in** (`CODEBUDDY_LORA_TRAIN=true`).
- Upload dataset **uniquement** vers fal avec ta clé (pas de proxy tiers Code Buddy).
- Pas d’installation silencieuse de toolchains multi-Go en local.
- Les images de personnage sont des données personnelles : ne pas committer
  `.codebuddy/lora/**/images/` ni les `.safetensors` dans le dépôt git du projet.

## Après l’install — ComfyUI & Code Buddy

```bash
# Génération via ComfyUI (workflow qui charge Krea 2 + LoRA models/loras/lisa.safetensors)
export CODEBUDDY_IMAGE_PROVIDER=comfyui
export COMFYUI_URL=http://127.0.0.1:8188
```

Sidecar écrit à l’install : `models/loras/<name>.codebuddy.json` (source, date, hints d’usage).

## Selfie Lisa → Telegram

Lisa peut **créer une photo d’elle** (prompt avec trigger LoRA) et l’**envoyer sur Telegram** (`sendPhoto`).

```bash
# CLI
buddy lora selfie --mood tender
buddy lora selfie --mood playful --scene "balcon au coucher du soleil"
buddy lora selfie --no-telegram

# Voix (hybrid reply, si CODEBUDDY_LISA_SELFIE n’est pas false)
# « Lisa, envoie-moi une photo de toi »
# « Fais un selfie et envoie-le sur Telegram »
```

| Variable | Rôle |
|----------|------|
| `CODEBUDDY_IMAGE_PROVIDER` | Génération (`comfyui` recommandé avec le LoRA installé) |
| `CODEBUDDY_SENSORY_ALERT_TOKEN` / `_CHAT` | Bot + chat Telegram (même couple que les alertes) |
| `CODEBUDDY_LISA_LORA_TRIGGER` | Override trigger sans `project.json` |
| `CODEBUDDY_LISA_SELFIE` | `false` = désactive interception vocale + Telegram inbound | on |
| `CODEBUDDY_COMFYUI_LORA` | Nom du LoRA ComfyUI (`lisa` ou `lisa.safetensors`) | auto `lisa.safetensors` si projet hint |
| `CODEBUDDY_COMFYUI_LORA_STRENGTH` | Force modèle+CLIP (0–1.5) | `0.85` |
| `CODEBUDDY_LISA_SELFIE_COOLDOWN_MS` | Délai min entre deux selfies | `45000` |

Surfaces : **voix** (hybrid-reply) · **Telegram inbound** · **CLI** · **outil agent `lisa_selfie`**.

Archives : `.codebuddy/lora/lisa/selfies/`.
Code : `src/companion/lisa-selfie.ts` · Comfy LoRA : `buildComfyWorkflow` + `LoraLoader`.

Moods : `tender` · `playful` · `bold` · `sparkly` · `calm` · `mika` · `portrait`.

## Modules source

| Fichier | Rôle |
|---------|------|
| `src/lora/dataset.ts` | init / validate / captions |
| `src/lora/pack-dataset.ts` | zip JSZip |
| `src/lora/fal-krea-trainer.ts` | upload + queue + poll + download |
| `src/lora/local-plan.ts` | config + script + LOCAL-TRAIN.md |
| `src/lora/install-comfy.ts` | copie vers `models/loras` |
| `src/companion/lisa-selfie.ts` | générer portrait + Telegram |
| `src/commands/lora.ts` | CLI Commander |

## Voir aussi

- [ComfyUI cas d’usage](./comfyui-use-cases.md) — place du LoRA personnage dans la pile créative
- [Laboratoire ComfyUI](./comfyui-lab.md) — inventaire local Cowork
- [Guide compagnon](./companion-guide.md) — Lisa voix + lien avatar LoRA
- [Configuration](./configuration.md) — variables d’environnement
- [API fal krea-2-trainer](https://fal.ai/models/fal-ai/krea-2-trainer)
