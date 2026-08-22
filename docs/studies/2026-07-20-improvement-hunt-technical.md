# Chasse aux améliorations techniques (2026-07-20, soir)

Recherche GitHub/HF/Civitai ciblée sur le delta vs notre pipeline. 12 items
priorisés ; ordre d'attaque : 2+10 → 3 → 5+6 → 7 → 1 → 4 → 8 → 9.

| # | Amélioration | Gain | Effort | Quand |
|---|---|---|---|---|
| 2 | **SageAttention 2.2 Windows** (wheels woct0rdho : `triton-windows<3.7` pour torch 2.8/cu128 + wheel sm86 post5) | ×1,3-1,8 attention | Faible | Immédiat |
| 10 | **torch.compile** wrapper Kijai (bugs cache Windows corrigés) | +20-30 % | Faible (après #2) | Immédiat |
| 3 | **Masked loss visage ai-toolkit** (`mask_path` supporté nativement — vérifié dans le code) : masques auto via nos MediaPipe/ArcFace | Identité ↑ à rank égal, moins de fond appris | Faible | **AVANT le training v3** |
| 5 | **UltraReal Fine-Tune** (checkpoint FLUX) + Realism Amplifier (Civitai 978314/1200242) | Peau non-plastique dès la keyframe | Faible | Après v3, re-gater ArcFace |
| 6 | LoRAs Wan low-noise : Detailz-Wan, FaceNaturalizer, Polyhedron skin/hands, **High Fashion glossy** (2373281) | Micro-texture peau/mains en vidéo | Faible | Après v3, sous gate ArcFace |
| 7 | **PainterLongVideo** (dual-reference : last-frame + frame initiale dans reference_latents, + motion_amplitude ; conçu pour lightx2v) | Anti-dérive léger | Faible-moyen | Prochain pilote |
| 1 | **SVI — Stable Video Infinity** (LoRA error-recycling ICLR26, branche svi_wan22, MIT ; workflow Civitai 13k dl) | Vidéos 40 s+ sans dérive cumulative | Moyen | Après #7 si besoin |
| 4 | **LoRA identité Wan** (musubi dual-model : `--timestep_boundary 0.9`, low 0-900/high 900-1000, shift 5) | Identité tenue PENDANT le mouvement | Moyen | Après LoRA v3 keyframe |
| 8 | **VideoScore2** (VLM-judge 8B, 5 dimensions, Spearman 77 vs humain) | Gate sémantique (morphing/mains) | Moyen | Phase gates v2 |
| 9 | **Prompt extend Qwen local** (mécanisme officiel Wan) avec template fashion | Richesse mouvement constante | Faible | Batch renderer |
| 11 | TeaCache/MagCache/EasyCache (déjà dans le wrapper) | ×1,5-2 **seulement en mode hero 20+ steps** — rien à 4 steps | Faible | Mode hero |
| 12 | LightX2V serving engine (14B en 8 Go, batch) | Débit ferme de rendu | Fort | Si volume |

**Écartés** : caches sur le chemin 4-steps (rien à sauter) ; Instagirl (style Wan
T2V ≠ nos keyframes) ; face-swap post-render (gamerait le gate ArcFace) ;
FlashVSR ; pipelines GitHub intégrés (rien de sérieux — notre architecture est
déjà au-delà ; les références du domaine sont des workflows Civitai).

**Limite mesureur découverte en production** : les vues de DOS n'ont pas de
visage → le gate ArcFace les rejette toutes en « identity-drift » à tort. La
curation doit exempter le framing `back` de la similarité faciale (revue
humaine à la place) — correctif à apporter au curateur.

**Piste Patrice (vidéo AiAndPixels)** : LoRA de changement de pose à personnage
constant sur **FLUX.2 Klein** — candidat « second éditeur d'identité » pour la
spec v3 (décorrélation des biais). À évaluer : licence Klein, VRAM, qualité.
