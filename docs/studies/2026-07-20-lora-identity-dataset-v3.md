# Étude — Dataset LoRA identité irréprochable (v3) (2026-07-20)

**Contexte** : le LoRA `lisa-krea2` (rank 64, 1000 steps) a été entraîné sur un
dataset 100 % synthétique de 24 portraits 768×1024 générés par Krea 2 Identity
Edit depuis UNE image de référence. Étude web sourcée : ce dataset est-il au
niveau « très haute qualité » ?

## Verdict : dataset à refaire (v3)

1. **Biais systématique mono-source (structurel)** : la fiche HF du LoRA Krea 2
   Identity Edit documente elle-même que la géométrie faciale distinctive
   « régresse vers des proportions typiques » — le sujet ressort comme un
   « proche parent ». Les 24 images partagent ce biais : le LoRA a appris une
   identité déjà dérivée, et l'a verrouillée (dérive invisible image par image,
   cohérente globalement). Schéma classique de consanguinité synthétique
   (littérature model-collapse : Nature/PMC 2024, arXiv 2410.04840).
2. **Résolution insuffisante** : 768×1024 = 0,79 MP, sous le seuil de 1 MP
   recommandé pour FLUX ; plafonne le détail appris (peau, iris, mèches) pour
   une diffusion 1080×1920 scrutée.
3. **Jamais évalué objectivement** : aucune grille ArcFace vs la référence
   originale.

Points corrects à conserver : 24 images est dans le sweet spot (15–40) ;
rank 64 est le bon choix visage ; 1000 steps = fourchette basse (viser
1500–2500 avec checkpoints et sélection du meilleur à 60–80 % du run).

Le LoRA actuel reste utilisable pour les ESSAIS de pipeline (réglages Wan,
upscale, mesures), pas pour la production.

## Spec dataset v3

**30–36 images, toutes ≥ 1024×1536 (upscale SUPIR au besoin), générées SANS
chaînage — chaque image éditée depuis la référence ORIGINALE.**

Composition :
- 10–12 gros plans visage : face ×3, trois-quarts G/D ×4, profils G/D ×2–3,
  regard haut/bas ×2 ;
- 8–10 tête-épaules/buste ; 5–6 mi-corps ; 4–5 plein pied (dont poses de
  mouvement : marche, assise, bras levés) ; 1–2 dos/trois-quarts arrière ;
- Expressions : ~1/3 **neutre bouche fermée** (réserve de keyframes i2v),
  sourires fermé + ouvert, pensive, rire ;
- ≥4 setups lumière, ≥6 décors, ≥5 tenues (attributs iconiques constants),
  focales simulées 35/50/85 mm ;
- Exclusions : lunettes de soleil, flou, filtres, occlusions.

Fabrication et curation :
- Générer 3–4× le volume cible via **≥2 éditeurs d'identité** (Krea 2 Identity
  Edit `ref_boost≈4` + **Qwen Image Edit 2509**, éventuellement Nano Banana)
  pour décorréler les biais ;
- **Gate ArcFace contre la référence ORIGINALE** (pipeline type MirrorMetrics /
  InsightFace) : garder ~0,60–0,80, rejeter < 0,55 et les quasi-doublons ;
  inspection manuelle mains/dents/oreilles ;
- Captions langage naturel : `TRIGGER, [tenue], [pose/expression], [lumière],
  [décor], [cadrage]` — **zéro description du visage** (l'identité doit être
  absorbée par le trigger) ; trigger = token rare inventé ; caption dropout
  0,05 ; passe manuelle après auto-caption VLM.

Entraînement / évaluation :
- FLUX/Krea : rank 64 / alpha 32, LR 1e-4, 1500–2500 steps, checkpoints tous
  les 100–200, **sélection par grille ArcFace** (10+ prompts × 3 seeds ; cible
  moyenne 0,55–0,75 vs centroïde de la référence ; > 0,85 = mémorisation,
  < 0,50 = identité perdue ; variance nulle = rigidité) + balayage strength
  0,5→1,25 + prompts hors distribution.
- **LoRA Wan 2.2 en complément (recommandé)** : entraîné T2V sur le même
  dataset (rank 32–64, LR 5e-5, ~10 epochs), utilisé en i2v EN COMBINAISON avec
  les keyframes FLUX — la keyframe ancre l'apparence, le LoRA Wan la stabilise
  à travers les frames et les clips (mode d'échec documenté sinon : la 1re
  frame est bonne puis le visage dérive dès la rotation ; causes : manque de
  profils dans le dataset, capacité insuffisante, conflit keyframe↔LoRA).
- Keyframes i2v : nettes, plutôt frontales, **bouche fermée**, lumière/cadrage
  proches de la distribution d'entraînement (sinon baisser le LoRA vers 0,5).

*Sources principales : Civitai 6842/7777, guides Apatero 2025, ai-toolkit
(Ostris), simple-flux-lora-training, wan27.org, fiche HF conradlocke/
krea2-identity-edit, MirrorMetrics, littérature model-collapse.*
