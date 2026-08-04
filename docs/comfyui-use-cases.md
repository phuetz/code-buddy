# ComfyUI comme moteur créatif de Code Buddy

Audit local : 12 juillet 2026. Les états « prêt » ci-dessous reposent sur les fichiers non vides et les nœuds réellement présents dans `/home/patrice/DEV/ComfyUI`, pas seulement sur l'existence d'un modèle dans un catalogue.

## Vision produit

ComfyUI doit devenir le moteur de recettes média de Code Buddy, pas un second écran à apprendre. Un manuscrit ou une mission fournit les ingrédients ; une recette versionnée déclare ses modèles, ses nœuds, ses entrées, sa licence et ses sorties ; Flow orchestre les variantes et conserve la provenance.

```text
manuscrit → canon personnages/lieux/objets
          → bible visuelle multi-référence
          → storyboard approuvé
          → animatique locale
          → plans vidéo + voix + musique
          → montage Film + sous-titres + contrôle qualité
```

Le contrat cible suit la boucle publiée par Comfy pour son MCP local — `server_info → run_workflow → fetch_outputs` — sans dépendre de ce MCP tant qu'il reste en test privé.

## Cas d'usage prioritaires

| Priorité | Cas d'usage Code Buddy | Recette ComfyUI | État local |
|---|---|---|---|
| P0 | Retouche ciblée dans Design View | SD Turbo rapide ou SD 1.5 + masque alpha + `VAEEncodeForInpaint` | **Prêt et validé** ; sortie réelle en 13–18 s sur CPU |
| P0 | Couvertures, concepts et storyboard brouillon | FLUX.1 Schnell Q4, SD Turbo ou SD 1.5 | **Prêt sur CPU** ; accélération GPU à revalider après redémarrage |
| P0 | Animatique d'un storyboard | Wan 2.1 T2V 1.3B Q4/BF16 + UMT5 + VAE + sortie MP4 | Recette enregistrée et préflightée ; bloquée honnêtement par l'absence de VRAM dans le repli CPU |
| P1 | Personnage cohérent entre plusieurs scènes | FLUX.2 Klein 4B distilled/base, multi-référence et édition | Blueprint présent ; modèles manquants |
| P1 | Plans vidéo locaux de bande-annonce | Wan 2.2 TI2V 5B | Blueprint présent ; modèle et VAE 2.2 manquants |
| P1 | Musique originale, ambiance et variations | ACE-Step 1.5 Turbo | Blueprint présent ; modèles manquants |
| P1 | Retouche finale de visage, objet ou texte | Qwen Image Edit | Blueprint présent ; stack lourde absente |
| P2 | Couverture exportable en calques | Qwen Image Layered → calques RGBA Design View | Blueprint présent ; modèles absents |
| P2 | Pose et cadrage reproductibles | ControlNet + pose/profondeur/contours | Nœuds partiels ; preprocessors/modèles absents |
| P2 | Personnage parlant avec Pocket TTS | Wan S2V ou LatentSync | Modèles absents |
| P2 | Avatar visuel léger du compagnon | LivePortrait + visèmes/MediaPipe | À installer et mesurer sur AMD |
| P2 | **Personnage compagnon stable (Lisa)** | **Krea 2 + LoRA character** via `buddy lora` (dataset → fal cloud ou plan local → `models/loras`) | **Pipeline CLI livré** — voir [krea-lora.md](./krea-lora.md) |
| P2 | Restauration et upscale des anciennes images/vidéos | upscale conservateur, débruitage et interpolation | Templates présents ; modèles absents |
| P3 | Accessoires, décors et pièces du robot en 3D | Hunyuan3D → GLB | Blueprint présent ; modèle absent |
| P3 | Données synthétiques pour les sens du robot | variations contrôlées par pose, lumière et décor | Dépend des recettes ControlNet/3D |

## LoRA personnage (Krea 2)

Pour un visage / style **stable** (ex. Lisa) plutôt qu’un one-shot de prompt :

```bash
buddy lora lisa
buddy lora validate lisa --fill-captions
CODEBUDDY_LORA_TRAIN=true FAL_KEY=… buddy lora train cloud lisa --steps 1000
buddy lora install .codebuddy/lora/lisa/output/*.safetensors --name lisa
```

- Doc : [krea-lora.md](./krea-lora.md)
- Cloud : fal `fal-ai/krea-2-trainer` (opt-in `CODEBUDDY_LORA_TRAIN`)
- Local : `buddy lora train local` écrit la config AI-Toolkit + `train-local.sh`
- Install : copie dans `COMFYUI_ROOT/models/loras` (ou chemins standards)

Workflow ComfyUI : checkpoint / UNet **Krea 2** + nœud LoRA pointant sur `lisa.safetensors`,
prompts avec le trigger (`ohwx lisa` par défaut).

## Modèles à installer dans cet ordre

1. **FLUX.2 Klein 4B distilled** : aperçu interactif, image et édition multi-référence dans un même modèle. Comfy annonce quatre étapes, environ 8,4 Go de VRAM sur sa machine de référence et un usage conçu pour la faible latence. Il faut le modèle FP8, `qwen_3_4b.safetensors` et `flux2-vae.safetensors`.
2. **Wan 2.2 TI2V 5B** : brouillons T2V/I2V de meilleure qualité que Wan 1.3B, annoncé compatible avec 8 Go de VRAM grâce à l'offload. L'encodeur UMT5 est déjà présent localement.
3. **ACE-Step 1.5 Turbo** : thèmes musicaux, ambiances, audio-to-audio et retouches pour les bandes-annonces.
4. **Qwen Image Edit** : finition exigeante et cohérence multi-image, seulement après mesure réelle de la mémoire unifiée.
5. **Wan S2V / LivePortrait / Hunyuan3D** : personnage parlant, avatar et assets 3D après stabilisation du socle.

Les poids FLUX.2 Dev et Wan 2.2 14B actuellement à `0` octet ne comptent pas comme installés. Le FLUX.2 Dev GGUF local est incomplet sans ses encodeurs et son VAE compatibles.

## Architecture de recette

Une recette ne doit pas être un nouvel embranchement codé en dur. Elle déclare au minimum :

```text
id + version + titre
modalités d'entrée/sortie
licence + usage commercial
workflow API immuable
nœuds et modèles requis {chemin, tailleMin, sha256?}
bindings {prompt, négatif, seed, dimensions, images, masque, audio}
outputs {image, vidéo, audio, GLB}
profil ressources + timeout + fallback explicite
```

Le runtime implémenté dans `src/media/comfyui-recipe-engine.ts` :

- charger seulement des recettes issues de registres approuvés ;
- refuser liens symboliques, sorties de racine, placeholders résiduels et modèles vides ;
- valider le graphe contre `/object_info` avant une exécution coûteuse ;
- suivre le job avec timeout, annulation et progression ;
- confiner chaque sortie et enregistrer recette, version, seed, modèles, licences et références dans son sidecar ;
- ne redémarrer ComfyUI que si Code Buddy prouve qu'il possède le processus ;
- conserver un repli cloud ou CPU explicite, jamais silencieux.

Deux recettes privées ont été enregistrées avec des permissions `0600` dans
`~/.codebuddy/comfy-recipes` : une image SD Turbo rapide et une prévisualisation Wan 2.1. Le
registre ne reçoit jamais un workflow arbitraire au moment de l'exécution : il résout seulement un
couple `id/version` déjà validé. La première recette a produit un PNG réel en **11,3 s sur CPU** ; le
préflight de la seconde a refusé le lancement faute de VRAM, au lieu de mettre un long job vidéo en
file sans chance de succès.

L'outil agentique `comfy_recipe` expose trois actions : `list`, `preflight` et `run`. La première
surface d'exécution accepte seulement les recettes texte-vers-média : aucun JSON de workflow,
téléchargement, URL distante, image, masque, audio ou chemin arbitraire ne peut être fourni par le
modèle. L'intention commerciale est obligatoire et `run` redemande toujours une confirmation
fraîche. Les artefacts sont confinés à
`<workspace>/.codebuddy/media-generation/recipes`.

## État du runtime de cette machine

- ComfyUI 0.22.0 et ses API sont accessibles en loopback.
- Le chemin CPU est sain ; SD Turbo a exécuté l'inpainting réel en 13 à 18 s et le nouveau moteur
  de recettes a produit une image texte-vers-image en 11,3 s.
- Un superviseur de santé distingue `healthy`, `degraded`, `poisoned` et `unreachable` à partir de
  `/queue`, `/system_stats`, `/object_info`, des modèles vides et des erreurs ROCm expurgées. Il ne
  redémarre jamais ComfyUI de lui-même ; une permission de redémarrage exige une preuve de propriété
  non sérialisable du processus.
- L'ancienne nightly PyTorch 2.12/ROCm 7.2 déclenchait un défaut `AMDGPU GCVM` dès la première copie vers la Radeon 890M. Le venv est maintenant réaligné sur les roues AMD supportées (PyTorch 2.9.1, torchvision 0.24, torchaudio 2.9 et Triton 3.5.1), mais le GPU déjà fauté doit encore être purgé par un redémarrage système avant la validation finale ; Code Buddy ne réinitialise pas brutalement le GPU qui porte la session graphique.
- Le service de repli CPU écoute seulement `127.0.0.1:8188`.

## Sources primaires

- [Contrat Comfy Local MCP](https://docs.comfy.org/agent-tools/local)
- [Routes du serveur ComfyUI](https://docs.comfy.org/development/comfyui-server/comms_routes)
- [FLUX.2 Klein 4B](https://docs.comfy.org/tutorials/flux/flux-2-klein)
- [Wan 2.2](https://docs.comfy.org/tutorials/video/wan/wan2_2)
- [ACE-Step](https://docs.comfy.org/tutorials/audio/ace-step/ace-step-v1)
- [Qwen Image Edit](https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit)
- [LTX 2.3](https://blog.comfy.org/p/ltx-23-day-0-supporte-in-comfyui)
