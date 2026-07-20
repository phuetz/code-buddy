# Étude — Environnements réalistes signature (2026-07-20)

**Demande Patrice** : faire évoluer Lisa dans des environnements réalistes
niveau vietsy66. Recherche web sur sources primaires (HF/GitHub/licences).

## Architecture retenue : « Les 6 lieux de Lisa »

**Une plaque maître canonique par lieu (image, pas LoRA) → insertion de Lisa
par édition multi-image → relight correctif → i2v depuis la keyframe-en-décor.**
Cette approche dépasse le standard du genre : la littérature du créneau montre
que les chaînes AI-lookbook obtiennent leurs lieux par templates de prompts
rigides (lieux *reconnaissables*, jamais *identiques*) — une vraie bibliothèque
de plaques donne des lieux identiques au pixel.

### Étage 1 — Bibliothèque de plaques (une fois par lieu)
FLUX/Krea local : lieu plein cadre SANS personnage, prompts photographiques
stricts (focale 35 mm rue / 50-85 mm mode, heure, matériaux — « brick
storefronts, parked cars, wet asphalt » force la géométrie), 3-5 angles par
lieu, upscale/detail, QA géométrique **Depth Anything V2 Small** (Apache — les
Base/Large sont CC-BY-NC), curation humaine → `locations/<lieu>/plate-*.png`
+ sidecar (prompt, focale, heure, direction lumière). Pour le lieu le plus
filmé (appartement de Lisa) : option Blender → depth → ControlNet pour le
multi-angle strict.

### Étage 2 — Keyframe-en-décor
Keyframe Lisa (Krea2 + LoRA) + plaque → **Qwen-Image-Edit-2509** multi-image
(« place the woman from image 1 into the scene from image 2, keep pose/scale,
match lighting ») — 20B MMDiT, **Apache 2.0** (le seul grand éditeur
multi-image vraiment commercial), person+scene documenté, ComfyUI natif
(`TextEncodeQwenImageEditPlus`), fp8 OK 3090. Il accorde déjà l'essentiel de la
lumière ; passe corrective si besoin : **IC-Light v1 `fbc`** (Apache, conditionné
sujet+fond → relight + ombres de contact ; base SD1.5 ⇒ re-détail visage par
inpaint FLUX+LoRA après) + node kijai + **BiRefNet** pour le détourage (le BRIA
RMBG du repo officiel est non-commercial). Gates identité existants appliqués
après composition.

### Étage 3 — i2v
Wan 2.2 i2v depuis la keyframe composite : **pour 5 s la keyframe suffit** (le
drift documenté concerne boucles/extensions — issue kijai #1541 ; pas de
boucles). Plans longs/caméra répétable entre vidéos : Wan2.2-VACE-Fun-A14B
(Apache, 64 Go, offload OK) en réserve.

## Décisions licences (chaîne monétisée)

- ✅ Qwen-Image-Edit-2509 (Apache), IC-Light v1 (Apache), Depth Anything V2
  **Small** (Apache), BiRefNet.
- ❌ IC-Light v2 (NC, poids non publiés), Nano Banana Pro (cloud + watermark
  SynthID), SwitchLight (abonnement), Kontext dev comme cheval de bataille
  (modèle NC — Qwen fait pareil en Apache), LoRA de lieu comme mécanisme
  principal (géométrie non garantie — complément seulement).
- Sources de fonds : 1) photos propres, 2) génération locale, 3) Pexels/
  Unsplash (commercial OK sans garantie). Le décor GÉNÉRÉ s'intègre mieux
  (même distribution d'image → relight plus facile).

## À installer sur darkstar

| Fichier | Taille | Licence |
|---|---|---|
| qwen_image_edit_2509 fp8 (Comfy-Org repackaged) | ~20 Go | Apache |
| qwen_2.5_vl_7b fp8 (text encoder Qwen-Image) | ~9 Go | Apache |
| (VAE qwen_image déjà présent) | — | — |
| iclight_sd15_fbc.safetensors + node kijai/ComfyUI-IC-Light | ~1,7 Go | Apache |
| BiRefNet (node + poids auto) | ~1 Go | libre |
| depth_anything_v2_small (QA plaques) | ~50 Mo | Apache |
| + base SD1.5 photoréaliste pour IC-Light (au moment de l'intégration) | ~2 Go | — |

*Sources : HF Qwen/Qwen-Image-Edit-2509, blog/docs ComfyUI, GitHub
lllyasviel/IC-Light (+discussion #98 licence v2), kijai/ComfyUI-IC-Light,
alibaba-pai Wan2.2-VACE-Fun, DepthAnything V2, licences Pexels/Unsplash.*
