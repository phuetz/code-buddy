# Balayage chaîne Pixaroma (2026-07-20, soir)

Inventaire complet (ancienne série 74 ép. + nouveau cours 26 ép.) via RSS/API.
Workflows JSON gratuits : workflows.pixaroma.com + Discord #pixaroma-workflows.
Nodes MIT : gitlab.com/pixaroma/comfyui-pixaroma.

## Les 5 trouvailles actionnables

1. **LoRAs d'édition Qwen-2509 (Ep 70)** — complément/alternative à IC-Light :
   **White-to-Scene** (insertion sujet → décor réel = exactement notre étage
   « Lisa dans la plaque »), **Relight**, **Light Restoration**, **Fusion**,
   **Camera Angle**, **Uncrop**. Workflows fournis. Et l'on peut **entraîner
   notre propre LoRA d'édition « insertion Lisa »** sur paires avant/après
   (fal qwen-image-edit-plus-trainer OU ai-toolkit local), gaté ArcFace.
2. **Keyframes générées par Wan 2.2 low-noise lui-même (Ep 58)** : GGUF
   low-noise T2V + Lightning 4-steps + DSLR LoRA (Civitai 1832621) + NAG.
   Intérêt : keyframes dans la MÊME distribution que le modèle i2v → moins de
   saut de texture au démarrage des segments. **A/B à faire vs keyframes Krea2.**
3. **LongCat pour le long-format (Ep 69)** : extension scène-par-scène SANS
   coupure start/end frame (notre problème de dérive) — et LongCat est DÉJÀ
   installé sur darkstar (poids ComfyUI par Kijai, block-swap anti-OOM,
   portrait OK). Troisième option anti-dérive après PainterLongVideo et SVI.
4. **Piège conversion LoRAs fal→ComfyUI (Ep 53/26)** : les LoRAs des trainers
   fal ne chargent pas tels quels (patch lym00/comfyui_nunchaku_lora_patch,
   fix « UNet final layer ») — à connaître avant tout comparatif cloud vs
   ai-toolkit.
5. **Nodes Pixaroma utiles aux gates** : **XY Plot** (grilles seed-verrouillées
   force-LoRA × sampler → alimente nos comparaisons ArcFace proprement),
   **Inpaint Crop/Stitch** (passe de détail visage sur keyframes verticales
   sans tout régénérer), **Pause Image** (porte humaine interactive),
   **3D Builder** (références pose/depth). + Tiled Diffusion anti-banding
   (Ep 46), SageAttention v2 easy-install (Ep 55), Nunchaku INT8 pour Ampere
   (Ep 25 — le FP4 est exclu sur 3090).

Épisodes clés : 55, 58, 67, 69, 70, 53, 46 (ancienne série) ; 06, 09, 24, 25,
26 (nouveau cours). Rien sur le multi-GPU (tutos mono-GPU).

*Source : playlists officielles Pixaroma, descriptions d'épisodes,
workflows.pixaroma.com, GitLab pixaroma (MIT).*

## Addendum 21/07 — verdicts de tests mesurés (vidéos partagées par Patrice)

- **Krea2 « COMBO detail boost » (Aitrepreneur) : REJETÉ par mesure.** A/B sur
  keyframe rue (seed identique, gate ArcFace + Laplacien) : standard 0,591/235 ;
  combo denoise 0,30 → 0,536/202 (les deux dégradés) ; denoise 0,18 →
  0,502/243 (netteté +3 %, identité −15 % = disqualifiant pour un dataset
  d'identité). Le node Krea2T-Enhancer (MIT) reste installé pour essais
  ponctuels hors dataset. IdeoKrea LoRA : écartée (sans licence).
- Nodes environnements opérationnels après restart : IC-Light
  (LoadAndApplyICLightUnet), BiRefNet, Krea2T-Enhancer.
- Vidéo ASF « LoRA dataset from ONE photo (Qwen) » : méthode en cours
  d'extraction — candidat second éditeur d'identité (spec v3).
- Vidéo ASF « dataset from ONE photo » : verdict **redondant** — habillage
  Patreon de la recette publique Qwen-Edit (notre plan second éditeur).
  À retenir : passer à Qwen-Image-Edit **2511** si GGUF dispo ; LoRA
  Qwen-Lightning 4-steps pour le batch ; 50 prompts de variations gratuits
  (weirdwonderfulai.art) ; captioning structuré Qwen2.5-VL avec trigger.
