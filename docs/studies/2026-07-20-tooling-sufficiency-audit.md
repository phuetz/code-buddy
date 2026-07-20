# Étude — Suffisance de l'outillage bout-en-bout (2026-07-20)

Audit de l'outillage hors génération (déjà tranchée). Verdict global : le socle
de production (ffmpeg/loudnorm/ASS/LUT/media-library) est au niveau ; les vrais
trous sont le titrage, le beat-sync, la migration des trainers — et **un
bloquant externe : l'audit YouTube API**.

## 🔴 P0 — Audit YouTube API (chemin critique, délai externe)

Toute vidéo uploadée par un projet API **non audité** est **verrouillée privée
sans appel possible** (uploader en private ne contourne PAS le verrou). →
**Lancer le formulaire d'audit (yt_api_form, gratuit) immédiatement** — le cas
« publie sur ma propre chaîne avec revue humaine » est le plus simple. Ne RIEN
uploader par API avant l'audit. Bonnes nouvelles : depuis le 04/12/2025 l'upload
ne coûte plus que ~100 units avec un bucket de 100 uploads/jour, et la
déclaration synthétique est dans l'API (`status.containsSyntheticMedia=true`).

## Verdicts par domaine

| # | Domaine | Verdict | Outil (licence) | Effort | Priorité |
|---|---|---|---|---|---|
| 1a | Trainer FLUX v3 | remplacer le runtime custom | **ai-toolkit** (MIT) — YAML 24 Go, qfloat8, rank 64/alpha 64, ~4-6 h/3090 | Faible | P1 |
| 1b | LoRA identité Wan 2.2 | à ajouter | **musubi-tuner** (Apache-2.0) — 2 experts (low 0-875 = ressemblance, high 875-1000) **en parallèle sur les 2×3090**, fp8+block swap, pré-cache, plutôt Linux | Moyen | P1 |
| 2a | Upscale dataset | à ajouter — **PAS SUPIR** (licence NC + upscaler génératif qui hallucine = poison identité) | **4xFaceUpDAT** (CC BY 4.0) via ComfyUI/spandrel ; repli Real-ESRGAN ncnn (BSD) | Faible | P2 |
| 2b | Gate ArcFace | script insightface maison = standard ; copier la méthodo LOO/centroïde de MirrorMetrics (0,50-0,70 bon, >0,85 overfit, <~0,45 rejet) | ⚠️ modèles buffalo_l = **non-commercial** → licence insightface ou AdaFace (MIT) avant commercialisation | Faible | P1 |
| 2c | Auto-captioning | à ajouter | **JoyCaption Beta One** (Apache-2.0, ~17 Go, vLLM endpoint OpenAI-compat) ; Qwen2.5-VL-**7B** (Apache) pour Wan — pas le 3B (licence) | Faible | P1 |
| 3 | Titres qualité trailer | ffmpeg/ASS insuffisant (light sweep/flare/3D hors libass) | **Remotion** (gratuit solo/commercial OK) → ProRes 4444 alpha (`yuva444p10le`) → overlay ffmpeg ; composants `<TrailerTitle>` FR/EN. Écartés : Motion Canvas (mort), Resolve scripté (Studio only), Blender bpy (réserve 1-2 templates signature) | Moyen | P2 |
| 4 | Créer un look → LUT | suffisant avec atelier ponctuel | **Resolve gratuit** exporte des .cube 33pt (primaires+courbes seulement) ; packs RocketStock/IWLTBAP/K-Tone ; application `lut3d=…:interp=tetrahedral` + dosage via blend | Faible | P3 |
| 5 | Coupes sur beats | à ajouter | **beat_this** (CPJKU, MIT code+poids) sidecar Python → JSON beats/downbeats ; couper sur les DOWNBEATS, 1-2 frames avant le beat, xfade centré (T/2 dans les offsets), ré-encoder (pas -c copy). Écartés : madmom (NC+cassé), Essentia (AGPL) | Moyen | P2 |
| 6 | Miniatures | suffisant | FLUX+ImageMagick, 1280×720 <2 Mo, 3 variantes + Test&compare manuel. **Shorts : pas de thumbnail API** → frame de marque incrustée en 1re frame | Faible | P3 |
| 7b | Funnel Instagram Reels | à ajouter (~1 j) | Instagram API w/ Instagram Login (compte Creator, dev mode sans review, resumable upload local, 100 posts/24h, pas de scheduling natif → cron) | Faible-moyen | P3 |
| 7c | Analytics | à ajouter | YouTube Analytics API (rétention `audienceWatchRatio` OK ; **CTR/impressions NON exposés** → Studio manuel) | Faible | P3 |
| 8 | Gestion d'assets | suffisant | sidecars `.meta.json` + index SQLite FTS5 maison (~200 lignes) ; pas de DAM | Faible | P4 |

## Alertes transverses

1. **Audit YouTube = seul bloquant externe** — à lancer immédiatement (délai
   jours→semaines).
2. **Nappe de licences non-commerciales dans la stack IA** : poids
   FLUX-dev/Krea-dev (outputs OK, modèle en service commercial non), modèles
   insightface, SUPIR, 4x-UltraSharp, madmom. Des remplaçants libres existent
   partout (listés ci-dessus) — à traiter avant toute commercialisation.
3. **Piège Krea au training** : FLUX.1 Krea dev est drop-in compatible
   FLUX.1-dev mais aucun trainer ne le liste officiellement (rapport de samples
   en bruit côté kohya) → valider les samples dès 250 steps ; repli sûr :
   entraîner sur FLUX.1-dev, inférer sur Krea.

*Sources : docs officielles ai-toolkit/musubi-tuner/Remotion/beat_this,
openmodeldb (4xFaceUpDAT), MirrorMetrics, issue trackers Google (audit API,
thumbnails Shorts, quotas 12/2025), LICENSE.md Remotion.*
