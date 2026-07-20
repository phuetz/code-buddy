# Étude — Hallucinations d'objets en i2v et parades (2026-07-20)

**Déclencheur** : revue humaine du pilote long par Patrice — « très joli mais un
voilage apparaît sans raison » → gate `decor-framing` en échec, reçu `rejected`
journalisé (`.codebuddy/native-fashion/pilot-retries.jsonl`, attempt 1).

## Cause (confirmée par les sources primaires)

Les objets fantômes naissent dans la **phase high-noise** (l'expert qui décide
le layout). Notre config leur laissait le champ libre :
- **CFG 1.0 imposé par les LoRA de distillation ⇒ negative prompt totalement
  ignoré** (pas de passe inconditionnelle) ;
- seulement **2 steps distillés** sur le high-noise (layout sous-convergé) ;
- **shift 1.0** (le JSON officiel forKJ) alors que la reco officielle Lightning
  est **shift 5** — un shift bas amplifie la phase early-noise ;
- décor non décrit dans le prompt = décor « libre » ;
- chaînage par dernière frame = chaque segment repart d'une image compressée
  VAE, la dérive s'accumule.

## Actions appliquées (attempt 2 du pilote)

1. `shift 1.0 → 5.0` (les deux samplers, templates i2v + FLF2V) ;
2. `steps 4 (2+2) → 6 (2+4)` — low-noise à 4 steps (correction documentée du
   ghosting, +50 % de temps) ;
3. **prompts verrouillant le décor** : le fond est décrit explicitement et
   déclaré statique dans chaque segment.

## Prochaines parades (dans l'ordre)

- **NAG** (custom node ChenDarYen — PAS le node natif, bugué) : réactive le
  negative prompt à CFG 1 (~+20-30 %). Negative ciblé : « curtains, drapes,
  sheer fabric, objects appearing, furniture appearing, background changing ».
- **Hero hybride** (~2-3×) : high-noise SANS distill 6-10 steps CFG 3.5 +
  negative complet → low-noise distillé — traite la phase exacte où naissent
  les objets. Pour les plans signature.
- **FLF2V pour le chaînage** : keyframes de début ET fin validées, le décor est
  contraint aux deux bornes (stoppe l'accumulation de dérive).
- **Cleanup final sans LoRA** (3e sampler 2-3 steps) pour dé-plastifier.
- **QC anti-fantômes automatique** : frames échantillonnées + VLM comparant
  l'inventaire d'objets à la frame 0 — à ajouter au mesureur de gates.
- LoRA i2v : rester sur `lightx2v/Wan2.2-Distill-Loras` dernière date (pas de
  Seko V2 en i2v — V2 est T2V-only) ; jamais de LoRA 2.1 sur le high-noise.

## Au-delà de Wan 2.2 (veille)

- **Wan 2.5/2.6 : PAS open** (vérifié sur l'org GitHub réelle ; les annonces
  « Wan 2.7 open » sont du SEO non corroboré).
- **HunyuanVideo 1.5** (8.3B, ~14 Go avec offload → 3090 OK, distillé 8-12
  steps, SR 1080p) : réputé meilleur sur le mouvement/drapé du tissu — LE
  candidat à benchmarker sur 3 plans fashion. ⚠️ LoRA identité à ré-entraîner.
- **LTX-2/2.3** : très rapide + audio natif, photoréalisme humain en dessous —
  utile débit, pas qualité.
- Inpainting VACE pour retirer un objet : possible mais coûteux/risqué —
  **regénérer le segment est presque toujours meilleur** ; VACE réservé aux
  takes parfaites par ailleurs.

*Sources primaires : HF lightx2v (discussions #14/#32/#41, Wan2.2-Distill-
Loras), GitHub ModelTC/Wan2.2-Lightning, Kijai #1548, Civitai (dual-sampling,
workflow favorites, 3-stage), ComfyUI-NAG (ChenDarYen) + issue #12707,
blog.comfy.org (FLF2V), Tencent-Hunyuan/HunyuanVideo-1.5, Lightricks/LTX-2.*
