# Templates ComfyUI API pour le rendu fashion natif

Ce dossier reçoit des exports opérateur provenant de l'instance ComfyUI de
Darkstar. Les cinq fichiers JSON ne sont volontairement pas versionnés ici :
ils dépendent des modèles et custom nodes installés sur la machine.

## Export sûr

1. Installer et redémarrer ComfyUI avec `ComfyUI-WanVideoWrapper`,
   `ComfyUI-VideoHelperSuite`, `ComfyUI-SeedVR2_VideoUpscaler`,
   `ComfyUI-Frame-Interpolation` et, pour la correction couleur,
   `ComfyUI-KJNodes`.
2. Activer **Settings → Enable Dev mode Options**.
3. Charger et exécuter le workflow visuel une fois avec une entrée de test.
4. Vérifier les paramètres ci-dessous dans l'interface.
5. Utiliser **Workflow → Export (API)**. Ne pas utiliser la sauvegarde normale
   du workflow UI et ne jamais écrire ou remanier le graphe JSON à la main.
6. Déposer l'export sous le nom exact indiqué, puis lancer le renderer. Le
   préflight refusera un export incomplet, une multiplicité incorrecte, un
   input adressable absent ou un titre de désambiguïsation incorrect.

Les connexions et les nœuds auxiliaires restent libres. Les multiplicités des
classes listées sont exactes. Tous les inputs `seed` et `noise_seed` du graphe
doivent exister avec une valeur numérique ; le renderer les écrase et refuse
ensuite toute valeur négative, notamment le `-1` livré par certains exemples.

## `keyframe-flux.json`

Workflow FLUX dev fp8 + LoRA d'identité, produisant une image verticale.

Contrat adressable :

- exactement 2 `CLIPTextEncode`, titrés via `_meta.title` **Positive Prompt**
  et **Negative Prompt**, input `text` ;
- exactement 1 `RandomNoise`, input `noise_seed` ;
- exactement 1 `EmptySD3LatentImage`, inputs `width` et `height` ;
- exactement 1 `SaveImage`, input `filename_prefix`.

Conserver le LoRA d'identité et un décodeur VAE dans le graphe. La résolution
est patchée à 1080×1920 et toutes les keyframes de jonction réutilisent le seed
d'identité de base. Une frame extraite d'une vidéo ne doit jamais remplacer
cette génération FLUX.

## `i2v-wan-lightx2v.json`

Workflow Wan 2.2 I2V high-noise puis low-noise avec lightx2v.

Contrat adressable :

- exactement 2 `WanVideoModelLoader` (branches high et low noise) ;
- exactement 2 `WanVideoSampler`, chacun avec un input `seed` ;
- exactement 1 `WanVideoImageToVideoEncode`, inputs `width`, `height` et
  `num_frames` ;
- exactement 1 `WanVideoTextEncode`, inputs `positive_prompt` et
  `negative_prompt` ;
- exactement 1 `LoadImage`, input `image` ;
- exactement 1 `VHS_VideoCombine`, input `filename_prefix`.

Réglages obligatoires dans l'export : lightx2v strength 1.0 sur les deux
branches, LoRA identité chaîné sur les deux branches (0,7–1,0), 4 steps,
CFG 1.0, Euler, split high 0→2 / low 2→fin, 81 frames, VAE tiled
272×272/stride 144. Le renderer impose 720×1280 et 81 frames.

Quand `ColorMatch` est disponible, l'intégrer avant `VHS_VideoCombine` avec la
méthode `mkl` et la référence de couleur approuvée (frame 0 du premier clip).
Ne pas substituer un filtre ffmpeg prétendant réimplémenter `ColorMatch`.

## `i2v-wan-flf2v.json`

Variante First/Last Frame native pour ré-ancrer chaque jonction entre deux
keyframes FLUX.

Le contrat est celui de `i2v-wan-lightx2v.json`, sauf qu'il exige exactement
2 `LoadImage` :

- le premier, titré via `_meta.title` **Start Image** ;
- le second, titré via `_meta.title` **End Image**.

Les deux exposent l'input `image`. Le `WanVideoImageToVideoEncode` doit recevoir
les images start/end et avoir `fun_or_fl2v_model: true`. Conserver les mêmes
réglages 4 steps, CFG 1.0, 81 frames et 720×1280. Si ce fichier est absent, le
renderer conserve le segment I2V provisoire et écrit un avertissement de
fallback ; la keyframe suivante reste néanmoins une génération FLUX neuve.

## `upscale-seedvr2.json`

Workflow officiel SeedVR2 modulaire :

- exactement 1 `VHS_LoadVideo`, input `video` ;
- exactement 1 `SeedVR2LoadDiTModel` configuré sur le modèle 3B fp8 ;
- exactement 1 `SeedVR2LoadVAEModel`, avec VAE tiled ;
- exactement 1 `SeedVR2VideoUpscaler`, inputs `seed`, `resolution` et
  `batch_size` ;
- exactement 1 `VHS_VideoCombine`, input `filename_prefix`.

Le renderer impose une résolution de petit côté 1080, un seed fixe et refuse
un `batch_size` qui ne satisfait pas `4n+1` (valeur par défaut : 5). La sortie
attendue est 1080×1920 à la cadence source.

## `interpolate-rife.json`

Workflow RIFE de `ComfyUI-Frame-Interpolation` :

- exactement 1 `VHS_LoadVideo`, input `video` ;
- exactement 1 `RIFE VFI`, input `multiplier` ;
- exactement 1 `VHS_VideoCombine`, input `filename_prefix`.

Choisir le checkpoint `rife49`, activer `ensemble` et conserver le multiplicateur
×2. L'encodage de livraison est effectué ensuite à 30 fps, H.264, CRF 17. Le
renderer valide avec ffprobe une sortie 1080×1920, 30±0,05 fps et environ 12 s.

## `insert-qwen-edit.json`

Workflow Qwen-Image-Edit-2509 multi-image qui place un personnage dans une
plaque existante. Le décor vient exclusivement de la seconde image : ne pas
ajouter le nom, la description, les matériaux ou la lumière du lieu au prompt
texte.

Construire et exécuter le graphe dans l'interface avec cette topologie :

- exactement 1 `UnetLoaderGGUF`, configuré sur
  `Qwen-Image-Edit-2509-Q4_K_M.gguf` ;
- exactement 1 `CLIPLoader`, configuré sur
  `qwen_2.5_vl_7b_fp8_scaled.safetensors` ;
- exactement 1 `VAELoader`, configuré sur `qwen_image_vae.safetensors` ;
- exactement 2 `LoadImage`, titrés via `_meta.title` **Character** et
  **Location**, chacun avec l'input `image` ;
- exactement 1 `TextEncodeQwenImageEditPlus`, avec les inputs `clip`,
  `prompt`, `image1`, `image2`, `image3` et `vae` : relier **Character** à
  `image1`, **Location** à `image2`, et laisser `image3` à sa valeur vide
  supportée par le nœud ;
- exactement 1 `ModelSamplingAuraFlow`, entre le modèle GGUF et le sampler ;
- exactement 1 `KSampler`, avec l'input `seed` ;
- exactement 1 `VAEDecode`, puis exactement 1 `SaveImage` avec l'input
  `filename_prefix`.

Le prompt opérateur de test doit rester générique : « place the woman from
image 1 into the scene from image 2, keep her identity/pose/scale, match the
scene lighting and perspective, photorealistic ». La CLI le remplace de façon
déterministe au rendu.

Sauvegarder d'abord le graphe UI sous un nom hors de ce dossier, puis l'exporter
avec le frontend réel de l'instance cible :

```bash
node scripts/darkstar/convert-qwen-edit-workflow-to-api.mjs \
  /chemin/insert-qwen-edit.ui.json \
  scripts/darkstar/workflows/insert-qwen-edit.json \
  http://127.0.0.1:8188
```

Le convertisseur attend l'enregistrement des custom nodes, charge le graphe
avec `app.loadGraphData`, appelle `app.graphToPrompt`, vérifie les class types
Qwen indispensables et crée le fichier de sortie avec `wx`. Il faut supprimer
ou déplacer un ancien export après revue pour en produire un nouveau ; ne
jamais fusionner ou corriger le JSON à la main. Au lancement, la CLI valide en
plus toutes les multiplicités, les titres, les inputs patchables et les seeds.

Pour `--relight`, exporter séparément `insert-qwen-edit-relight.json` avec la
même chaîne Qwen, suivie d'une passe corrective IC-Light fbc réellement
connectée. Cette variante doit contenir exactement 1 `RembgByBiRefNet` pour le
masque sujet et exactement 1 `LoadAndApplyICLightUnet` configuré sur
`iclight_sd15_fbc.safetensors`. La CLI refuse `--relight` si cet export manque
ou si ces nœuds ne sont pas présents ; le drapeau ne simule jamais le relight.

Exemple d'insertion sans gate :

```bash
npx tsx scripts/darkstar/insert-character-in-location.ts \
  --character /chemin/keyframe-lisa.png \
  --location cozy-loft-interior \
  --comfy http://127.0.0.1:8188 \
  --out tmp/lisa-loft \
  --seed 610000
```

`--plate /chemin/plaque.png` remplace `--location`. `--gate` exécute après
composition le mesureur ArcFace de `measure-visual-gates.py` avec la keyframe
comme référence et refuse une identité sous les seuils `native-fashion-v1`.

## Préflight sans rendu

Le chargement et la validation des contrats ont lieu avant toute soumission à
`/prompt`. Une erreur cite le fichier, la classe, la multiplicité, le titre ou
l'input fautif. Le renderer accepte `--skip-upscale` et `--skip-interpolate`
uniquement pour le diagnostic ; ces drapeaux ne définissent pas un master de
production conforme.
