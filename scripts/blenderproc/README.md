# Boucle A — « simuler pour percevoir » (BlenderProc → vision-train)

Rendre des scènes 3D domain-randomisées **avec vérité-terrain exacte** (COCO, bbox
projetées depuis la géométrie connue), puis scorer la perception réelle du robot
(YOLO) dessus pour surfacer ses points faibles. Passage de « générer une image
qui *ressemble* à » vers « simuler un monde puis l'observer ».

## Pièces

| Fichier | Rôle | Testé |
|---|---|---|
| `fetch_assets.mjs` | Télécharge des modèles CC0 Poly Haven par mot-clé → `<assets>/<coco_class>/*.blend` | live (API réelle) |
| `scene.py` | Script BlenderProc : scène aléatoire + physique + rendu + COCO. GPU CUDA→HIP→CPU | syntaxe (à valider live) |
| `src/tools/vision/blender-render.ts` | Wrapper headless (argv pur + spawn injecté, fail-open) | 7/7 |
| `src/vision-train/coco-to-labels.ts` + `buddy vision-train --coco` | COCO → labels → scoring YOLO | 7/7 |

## Runbook

### Sur la machine GPU (DARKSTAR, 2×3090) — le rendu

```bash
# 1. BlenderProc (télécharge son propre Blender ~1 Go la 1re fois)
pip install blenderproc

# 2. Assets CC0 (furniture/props ; PAS de personnes — banques CC0 sans humains riggés)
node scripts/blenderproc/fetch_assets.mjs ./vision-assets 2

# 3. Rendu headless : N scènes → images/ + coco_annotations.json (GPU auto, repli CPU)
blenderproc run scripts/blenderproc/scene.py -- \
  --assets ./vision-assets --out ./boucle-a-out --count 20 --seed 1 --width 640 --height 480
```

> `scene.py` tente CUDA puis HIP puis retombe sur CPU. Sur les 3090 : GPU. Sur
> l'AMD (MINISTAR) : CPU (plus lent, mais marche).

### Sur MINISTAR — le scoring de la perception réelle

```bash
# Rapatrier ./boucle-a-out depuis DARKSTAR (tailscale/scp), puis :
CODEBUDDY_VISION_TRAIN=true buddy vision-train \
  --images ./boucle-a-out/images --coco ./boucle-a-out/coco_annotations.json
# → rapport .codebuddy/vision-train/ avec les weak-spots (précision/rappel par label)
# Ajouter --ckg (+ CODEBUDDY_COLLECTIVE_MEMORY=true) pour que le robot RETIENNE ses faiblesses.
```

Le wrapper TS `renderScenes()` peut aussi piloter l'étape 3 par programme (spawn
injecté), pour intégrer la boucle dans un tour d'agent plus tard.

## Limites connues / à faire

- **Personnes** : les banques CC0 (Poly Haven/GSO) n'ont pas de meshes humains
  riggés → le test de présence (`person`) nécessite une source dédiée (MakeHuman,
  SMPL sous licence recherche, ou des assets Objaverse filtrés). Aujourd'hui la
  Boucle A couvre chair/couch/table/plant/tv/…
- **scorer.ts** ne fait que du **comptage** par label (pas d'IoU bbox) — la
  vérité-terrain géométrique exacte est là, mais pas encore exploitée en matching
  IoU (extension future, non bloquante).
- `scene.py` est **à valider en live sur DARKSTAR** (l'API BlenderProc varie un
  peu selon versions) — le reste de la chaîne est testé unitairement.
