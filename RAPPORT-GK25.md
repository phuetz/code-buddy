# RAPPORT-GK25 — La perception du robot en vrai : `buddy vision-train` (mode dossier) et `camera_analyze` avec les modèles locaux réellement installés

Date : 2026-09-03 (Europe/Paris)
Agent : Grok 4.6
Clone : `/home/patrice/DEV/cb-repar-jumeaux-4-2026-09-02`
Branche : `fix/gk25-vision-train-reel-2026-09-03`
HEAD au démarrage : `4bfbc4ac7`
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** du code vision-train, vision-reaction, object-detect, camera-analyze, ComfyUI.

## Mission

Éprouver en vrai la perception du robot :

1. `CODEBUDDY_VISION_TRAIN=true buddy vision-train --images <dossier> --labels <fichier>` : scores par label, faiblesses classées, `--ckg` publie dans un CKG de test.
2. `object_detect` sur `bus.jpg` / `zidane.jpg` via l'agent headless : compte réel.
3. `camera_analyze` sur un cliché NOIR (luma < 12) et sur un cliché de pièce : la porte d'obscurité SENSE1 doit refuser le noir ; moondream décrit la pièce sans inventer.
4. Fournisseur ComfyUI (`COMFYUI_URL`) contre un faux serveur HTTP local qui imite `/prompt` → `/history` → `/view`.
5. `buddy vision-train` mode `generate` avec ce faux ComfyUI.

Loi : « se servir de ses applis EN VRAI ». Chaque défaut (score annoncé sans détection réelle, erreur avalée, doc fausse, sortie polluée) : test rouge → correctif → vert, un commit.

## Garde-fous

- Rester dans ce clone. Aucune écriture ailleurs, ni dans `/tmp` partagé.
- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante. Ollama local : `moondream` (vision), `qwen3:4b-instruct` (texte).
- Aucun service systemd. ComfyUI réel 8188 intact (faux serveur `127.0.0.1:42125`). Pont 8129 réel intact. Caméra réelle jamais ouverte.
- HOME = `_qa/gk25/home` dans le clone. `CODEBUDDY_YOLO_PYTHON=/home/patrice/vision_tests/venv/bin/python`, modèle `/home/patrice/vision_tests/yolov8n.pt`.
- Rien téléchargé > 50 Mo. `DISPLAY` unset. `package-lock.json` restauré après `npm install`.

## Journal

| Heure (Europe/Paris) | Action |
|---|---|
| 12:35 | Rapport créé avant inspection. Coordination réservée. HEAD `4bfbc4ac7`. |
| 12:36–12:45 | Lecture CLAUDE.md, `src/vision-train/`, `vision-reaction.ts`, object-detect, camera_analyze, ComfyUI, tests existants. |
| 12:39 | Ressources : ultralytics 8.4.80 dans `~/vision_tests/venv` ; `yolov8n.pt` 6,3 Mo ; `bus.jpg`/`zidane.jpg` dans le paquet ultralytics (absents du dossier `~/vision_tests/` lui-même). Ollama : `moondream` + `qwen3:4b-instruct`. Clone sans `node_modules` (1848 paquets installés). |
| 12:47 | Tests ciblés 53/53 verts après correctifs. |
| 12:48 | `vision-train` dossier 10 images : accuracy 30 %, 5 faiblesses, CKG 5 nœuds. |
| 12:48 | YOLO réel bus.jpg `person:3 bus:1` (249 ms) ; zidane.jpg `person:2` (59 ms). |
| 12:51 | `camera_analyze` noir : refusé `meanLuma=0 < 12`. Pièce : timeout 180 s (GPU saturé par qwen 27b + gemma MoE). |
| 12:54 | Faux ComfyUI `:42125` : image 78 o PNG. `vision-train --count 3 --provider comfyui` : 3 scènes, desk scorée (plus d'abort YOLO). 8188 réel intact. |
| 13:01 | Agent headless `qwen3:4b-instruct` depuis un cwd minuscule : deux `object_detect` réels, bus `{bus:1, person:3}`, zidane `{person:2}`, `$0`. |
| 13:04 | `camera_analyze` pièce (moondream chargé) : description d'une pièce + fenêtre, luma 169,6. Invente un blouson. |
| 13:06 | `tsc` 0, GPU identity 0, ESLint ciblé 0, 7 fichiers / 53 tests verts. |

## Fichiers lus

- `CLAUDE.md` (§ vision-train, `CODEBUDDY_YOLO_PYTHON`, `object_detect`, vision-reaction, `camera_analyze`, ComfyUI)
- `src/vision-train/{engine,scorer,curriculum,ckg-publish,report,coco-to-labels,assets}.ts`
- `src/commands/vision-train.ts`
- `src/tools/vision/object-detection.ts`, `src/tools/registry/vision-tools.ts`
- `src/sensory/vision-reaction.ts`, `src/companion/camera.ts`
- `src/tools/media-generation-tool.ts` (`generateComfyUIImage`)
- `tests/tools/{object-detect,camera-analyze,comfyui-image-real}.test.ts`, `tests/vision-train/*`, `tests/sensory/vision-reaction.test.ts`
- `docs/tools-reference.md`, `docs/screen-capture-and-ai.md`

## Ressources locales (lecture seule)

| Ressource | Constat |
|---|---|
| `~/vision_tests/yolov8n.pt` | 6,3 Mo, utilisé |
| `~/vision_tests/venv/bin/python` | ultralytics **8.4.80** |
| `bus.jpg` / `zidane.jpg` | **pas** dans `~/vision_tests/` ; copies depuis `ultralytics/assets/` (135 Ko / 50 Ko) |
| `buddy-vision/` dans ce clone | pas de venv (présent dans `~/code-buddy/buddy-vision/.venv`, non touché) |
| Ollama | `moondream:latest` 1,7 Go ; `qwen3:4b-instruct` 2,5 Go |
| ComfyUI 8188 | en écoute, jamais appelé |
| Pont 8129 | en écoute, jamais ouvert |

## Écarts

### E1 — `camera_analyze` ouvrait toujours la webcam, default gemma texte-seul, pas de porte d'obscurité — FERMÉ

Le schéma n'avait pas `image_path`. Un cliché fichier était impossible sans ffmpeg `/dev/video0`. Le défaut VLM était `gemma4:12b` (texte-seul, invente). La porte luma < 12 de SENSE1 n'existait que sur l'événement `vision/motion` (`vision-reaction.ts`), pas sur l'outil.

- Rouge : `refuses a near-black still without calling the vision model` ; `defaults the vision model to moondream` ; `analyzes image_path without capturing`.
- Correctif : `meanLumaOfImage` (PNG in-process, sharp en repli JPEG) ; refus `meanLuma < 12` ; `image_path` ; défaut `moondream` / `CODEBUDDY_VISION_MODEL`.
- Vert : 53 tests ciblés. Live noir : `Dark frame refused (meanLuma=0 < 12)`, aucun appel VLM. Live pièce : moondream, luma 169,591.
- Commit : `4b469aa7e`

### E2 — `vision-train` generate abortait YOLO sur la classe `desk` — FERMÉ

Le curriculum étiquette `desk`. COCO/YOLOv8n n'a que `dining table`. Le snippet Python levait `Unknown YOLO class: desk` ; les scènes peuplées étaient des `failures` exclues du benchmark — un score annoncé sans perception réelle sur le cœur du curriculum.

- Rouge : `never asks YOLO for a class name absent from COCO for the default curriculum`.
- Correctif : `yoloClassesFromExpected` / `remapCountsToExpected` ; skip des classes inconnues restantes.
- Vert : test + live `--count 3 --provider comfyui` : 3 scènes scorées, `desk` en FN (0 détecté sur PNG 8×8), **0 abort**.
- Commit : `06231ff20`

### E3 — doc `camera_analyze` → `gemma4:12b` — FERMÉ

`docs/tools-reference.md` et `docs/screen-capture-and-ai.md` affirmaient le défaut gemma. Alignés sur moondream + `image_path` + luma < 12. Même commit que E1.

### E4 — agent headless depuis la racine du clone : exit 0, zéro outil, zéro texte — OUVERT (contournement)

`qwen3:4b-instruct` + `CLAUDE.md` (201 056 caractères) → prompt tronqué à 8192 / budget 2048 tokens, puis ~3 min et `AGENT_EXIT:0` sans `object_detect`. Relancé depuis `_qa/gk25/work/agent-cwd` (marqueur `.git` local, pas de CLAUDE.md) : deux appels réels, comptes identiques au YOLO direct. Hors correctif de ce chantier (chargeur de contexte).

## Tableau scénario → attendu → obtenu → correctif

| Scénario | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|
| (1) vision-train dossier 10 images + `--ckg` | scores par label, faiblesses classées, CKG de test | 10 scènes, accuracy **30 %**, mean count error **0,9**. Recall person 83 % (5/6), bus 100 %. Faiblesses : chair/dog/tie/apple/bottle 0 %. CKG **5 nœuds** dans `_qa/gk25/home/.codebuddy/collective/ckg-ledger.jsonl` | — (déjà conforme une fois YOLO réel) | — |
| (2) object_detect bus.jpg / zidane.jpg agent headless | compte réel | Direct : bus `{bus:1, person:3}` 249 ms ; zidane `{person:2}` 59 ms. Agent : **mêmes comptes**, 2 tool_calls, `$0`, 6348/105 tokens | cwd minuscule pour éviter E4 | — |
| (3a) camera_analyze cliché noir luma < 12 | porte SENSE1 refuse | `success:false` `meanLuma=0 < 12`, fetch VLM **non appelé** | E1 | `4b469aa7e` |
| (3b) camera_analyze cliché de pièce | moondream décrit sans inventer | luma 169,591. Texte : pièce, fenêtre à gauche, pas de personne. **Invente un blouson bleu** sur le siège (dessin synthétique, pas une photo) | E1 (chemin fichier + moondream). Hallucination partielle notée | `4b469aa7e` |
| (4) ComfyUI faux `/prompt`→`/history`→`/view` | image générée | PNG 78 o, `provider:comfyui`, `sd_turbo.safetensors`. 8188 réel toujours en écoute, jamais interrogé | déjà couvert par `tests/tools/comfyui-image-real.test.ts` | — |
| (5) vision-train generate + faux ComfyUI | curriculum → generate → YOLO | 3 scènes, source `generated (comfyui)`, accuracy 0 % (PNG 8×8 sans objet), **desk scorée** pas abortée | E2 | `06231ff20` |

## Preuves de commandes

```
vision-train folder: 10 scenes · accuracy 30% · Published 5 node(s) to the CKG
YOLO bus.jpg: countsByLabel { bus: 1, person: 3 } inferenceMs 249
YOLO zidane.jpg: countsByLabel { person: 2 } inferenceMs 76–59
agent: "bus.jpg countsByLabel: {\"bus\": 1, \"person\": 3}
        zidane.jpg countsByLabel: {\"person\": 2}"  cost $0
camera_analyze black.png: Dark frame refused (meanLuma=0 < 12)
camera_analyze room.png: meanLuma=169.591 model=moondream
generateImage fake ComfyUI :42125 → 78-byte PNG, 8188 untouched
vision-train --count 3 --provider comfyui: 3 scenes, desk FN, 0 failures
npx tsc --noEmit -p tsconfig.json → 0
npx tsc --noEmit -p tsconfig.gpuNode-identity.json → 0
eslint ciblé --max-warnings=0 → 0
vitest 7 files / 53 passed
```

## Reste ouvert

- Hallucination moondream (blouson) sur un dessin de pièce, pas une photo réelle — la caméra était interdite.
- Agent 4b + `CLAUDE.md` du clone : headless silencieux (E4). Contournement cwd isolé.
- GPU occupé (qwen 27b 262k ctx + gemma MoE) : premier appel moondream en timeout 180 s, honnête, pas un faux succès.
- LAN / photo pièce réelle : hors mission.
