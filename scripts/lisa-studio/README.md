# Lisa Studio — clip keyframe-ancré en une commande

`generer-clip.ts` produit un clip vertical de Lisa avec une chaîne fail-closed :

1. génération de `N` keyframes Krea 2 avec le LoRA `lisa-krea2.safetensors` ;
2. comparaison de chaque visage à une référence avec ArcFace `buffalo_l` ;
3. refus avant animation si le meilleur score est sous le seuil ;
4. animation MiniMax H3 à partir de la keyframe gagnante, passée dans l'entrée
   native `first_frame` ;
5. score ArcFace des frames de début, milieu et fin, puis rapport et sidecar
   Cowork.

## Commande

Depuis la racine du dépôt :

```bash
CODEBUDDY_IMAGE_PROVIDER=comfyui \
CODEBUDDY_COMFYUI_LORA=lisa-krea2.safetensors \
npx tsx scripts/lisa-studio/generer-clip.ts \
  --reference /chemin/vers/lisa-reference.png \
  --scene "Lisa dans un café parisien, lumière matinale, regard caméra" \
  --animation "Lisa sourit puis incline légèrement la tête"
```

Valeurs par défaut : `N=4`, seuil ArcFace `0.5`, durée demandée `5 s`, Krea 2
sur `http://gpuNode:8188` et MiniMax H3 sur `http://gpuNode:8190`. La
contrainte `plan fixe verrouillé, visage net et centré` est ajoutée au prompt
d'animation si elle n'y figure pas déjà.

Le processus retourne un code non nul si la référence est invalide, si ComfyUI
échoue, si ArcFace ne renvoie pas un résultat cohérent ou si le gate est refusé.
Un refus indique le meilleur score et le seuil, par exemple :

```text
Gate ArcFace refusé : meilleur score 0.472381 < seuil 0.500000. Aucune animation lancée.
```

## Essai à 0 coût

`--essai` remplace les deux générations et les deux passes ArcFace par des
fixtures locales. Il vérifie le parsing, les seeds, la sélection, les chemins,
le rapport et les sidecars sans appel HTTP, sans GPU et sans sous-processus
Python :

```bash
npx tsx scripts/lisa-studio/generer-clip.ts \
  --reference /chemin/vers/lisa-reference.png \
  --essai
```

La référence doit tout de même être un fichier régulier existant : le mode
d'essai teste volontairement le préflight réel.

## Prérequis gpuNode

Deux instances distinctes sont attendues :

- `gpuNode:8188` — Krea 2 avec
  `krea2_turbo_fp8_scaled.safetensors`,
  `qwen3vl_4b_fp8_scaled.safetensors`,
  `qwen_image_vae.safetensors` et
  `models/loras/lisa-krea2.safetensors` ;
- `gpuNode:8190` — MiniMax H3 avec le nœud
  `MiniMaxH3ImageToVideo`,
  `minimax_h3_fl2va_pruned_int8_convrot.safetensors`,
  `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` et
  `minimax_h3_video_vae_fp16.safetensors`.

Les probes suivants ne lancent aucun rendu :

```bash
curl --fail http://gpuNode:8188/system_stats
curl --fail http://gpuNode:8190/object_info/MiniMaxH3ImageToVideo
```

Le graphe H3 est fixé à `768×1344`, 24 fps, 8 pas, sampler `euler`, scheduler
`beta` et CFG `1`. Les durées sont arrondies vers le haut sur la grille H3
`17k+5` ; la demande par défaut de 5 secondes produit 124 frames, soit environ
5,17 secondes réelles.

## Prérequis ArcFace

Par défaut, le script appelle :

```text
~/.venvs/tri-outils-qc/bin/python
```

Ce venv doit fournir `insightface`, `onnxruntime`, `numpy` et
`opencv-python`. Exemple de création :

```bash
python3 -m venv ~/.venvs/tri-outils-qc
~/.venvs/tri-outils-qc/bin/pip install insightface onnxruntime numpy opencv-python
```

Au premier usage, InsightFace doit déjà pouvoir charger le pack `buffalo_l`
depuis `~/.insightface`. Le scoring choisit le plus grand visage détecté et
calcule le cosinus des embeddings normalisés. Une frame finale sans visage est
une erreur de QC, pas un score inventé.

## Options

| Option              | Effet                                                  |
| ------------------- | ------------------------------------------------------ |
| `--reference`, `-r` | Image de référence obligatoire.                        |
| `--scene`           | Prompt de la keyframe Krea 2.                          |
| `--animation`       | Prompt de mouvement H3.                                |
| `--n`               | Nombre de candidats, de 1 à 12 ; défaut 4.             |
| `--seuil`           | Seuil ArcFace de 0 à 1 ; défaut 0.5.                   |
| `--duree`           | Durée demandée de 5 à 15 secondes.                     |
| `--seed`            | Seed de base ; les candidats utilisent `seed + index`. |
| `--racine`          | Racine qui recevra `.codebuddy/media-generation/`.     |
| `--image-url`       | Endpoint ComfyUI Krea 2.                               |
| `--video-url`       | Endpoint ComfyUI H3.                                   |
| `--python`          | Exécutable Python QC.                                  |
| `--essai`           | Chaîne locale sans réseau ni Python.                   |

Variables d'environnement reconnues :

| Variable                                  | Usage                                         |
| ----------------------------------------- | --------------------------------------------- |
| `CODEBUDDY_COMFYUI_LORA`                  | LoRA image ; défaut `lisa-krea2.safetensors`. |
| `CODEBUDDY_COMFYUI_LORA_STRENGTH`         | Force du LoRA ; défaut `0.85`.                |
| `CODEBUDDY_LISA_IMAGE_URL`                | Endpoint image prioritaire.                   |
| `CODEBUDDY_LISA_VIDEO_URL`                | Endpoint vidéo prioritaire.                   |
| `CODEBUDDY_IMAGE_BASE_URL`, `COMFYUI_URL` | Fallback endpoint image.                      |
| `CODEBUDDY_VIDEO_BASE_URL`                | Fallback endpoint vidéo.                      |
| `CODEBUDDY_LISA_QC_PYTHON`                | Python ArcFace.                               |
| `CODEBUDDY_COMFYUI_TIMEOUT_MS`            | Timeout d'une keyframe.                       |
| `CODEBUDDY_H3_TIMEOUT_MS`                 | Timeout du rendu H3.                          |
| `CODEBUDDY_COMFYUI_POLL_MS`               | Intervalle de polling ComfyUI.                |

Les noms de modèles avancés sont également remplaçables par les variables
`CODEBUDDY_IMAGE_MODEL`, `CODEBUDDY_COMFYUI_KREA2_TEXT_ENCODER`,
`CODEBUDDY_COMFYUI_KREA2_VAE`, `CODEBUDDY_H3_UNET`,
`CODEBUDDY_H3_TEXT_ENCODER` et `CODEBUDDY_H3_VIDEO_VAE`.

## Sorties

Le clip final est écrit sous :

```text
.codebuddy/media-generation/videos/lisa-clip-<id>-seed-<seed>.mp4
```

Deux JSON sont placés juste à côté :

- `<clip>.mp4.meta.json` : sidecar compatible avec la médiathèque Cowork
  (`kind`, `prompt`, `provider`, `model`, durée, first frame et lien rapport) ;
- `<clip>.mp4.report.json` : référence, chemins des candidats, keyframe retenue,
  seeds, scores ArcFace, paramètres H3 et durées de chaque étape.

Les keyframes et leurs sidecars de QC restent dans
`.codebuddy/media-generation/images/` afin de rendre une décision de gate
auditable, y compris après un refus.

## Tests ciblés

```bash
npm test -- tests/tools/lisa-studio.test.ts
npx tsc -p scripts/lisa-studio/tsconfig.json
```

Les tests injectent `fetch`, l'exécuteur Python et l'horloge ; ils ne contactent
ni gpuNode ni InsightFace.
