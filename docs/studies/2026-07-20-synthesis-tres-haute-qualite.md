# Synthèse — Comment atteindre la très haute qualité (2026-07-20)

Consolidation des 7 études du 2026-07-20 (audit pipeline, état de l'art
génération, grammaire AI-lookbook, dataset LoRA v3, spec ComfyUI, trailers de
livres, abonnements). Ce document est la référence stratégique ; le plan
d'exécution détaillé vit dans `~/.claude/plans/cozy-spinning-finch.md` et les
études individuelles dans `docs/studies/2026-07-20-*.md`.

## Les 6 vérités structurantes

1. **La qualité se mesure ou n'existe pas.** Les 5 gates bloquants du cahier
   des charges n'ont aujourd'hui aucune mesure automatique. La brique la plus
   prioritaire de tout le programme est le mesureur de gates visuels (ArcFace,
   DWPose, flicker, netteté) — il sert la qualité ET la défense YouTube
   anti-« mass-produced ».
2. **Le fondement identité est à refaire avant la production.** Le dataset
   LoRA actuel encode un biais documenté du générateur (géométrie faciale
   régressée). Dataset v3 : 30-36 images ≥1024×1536, ≥2 éditeurs d'identité,
   gate ArcFace contre la référence originale, + LoRA Wan 2.2 complémentaire.
   Le LoRA actuel = réglages de pipeline uniquement.
3. **La répartition des moteurs est tranchée.** Lisa = 100 % local darkstar
   (LoRA identité impossible sur Veo ; 0 crédit ; chaîne 720×1280 → SeedVR2 →
   RIFE, ~25-35 min/clip sur 2×3090). Trailers = Veo 3.1 Flow (audio natif,
   rendu ciné ; Fast 10 cr pour prototyper, Quality 100 cr pour les plans
   validés) + Wan local pour les plans à contrôle fin.
4. **La chaîne Lisa est un business de funnel, pas de RPM.** Personnage nommé,
   DA signature (4-6 décors, lumière constante, chorégraphies originales),
   Shorts 10-15 s bouclables, cadence ≤1/jour AVEC variation systématique
   (défense YPP), divulgation synthétique cochée dès le 1er upload, funnel
   Instagram/Fanvue-ou-Patreon dès le début. Le tier `sensual` couvert est la
   frontière — jamais au-delà.
5. **Le trailer est une créa publicitaire, pas un canal.** Master sans texte
   incrusté + overlays par langue (FR natif, EN testé sous-titré puis re-voicé
   si traction), plans IA atmosphériques sans visages en gros plan, mesure
   Amazon Attribution par placement, diffusion LinkedIn+YouTube+newsletter+pub
   Meta. Amazon lui-même est fermé à la vidéo.
6. **Le budget est sain.** AI Ultra (vérifier le nouveau tarif FR 99,99/219,99 €)
   + ElevenLabs Creator (~19 €, voix trailers — Piper disqualifié pour le
   commercial) + Epidemic Sound Creator (~10 €, musique monétisable). Tout le
   reste (Midjourney, Kling, Runway, Suno, Higgsfield) : superflu.

## Ajustements au plan d'exécution approuvé

- **Phase 1+** (gates) : inchangée — confirmée comme priorité n°1 par toutes
  les études. Ajouter la mesure de « qualité de boucle » (similarité première/
  dernière frame) aux métriques Shorts.
- **Phase 2** (moteur natif Lisa) : insérer **Phase 2a — dataset v3 + LoRA v3**
  (spec dans l'étude dédiée) avant les pilotes de production ; le pipeline se
  règle avec le LoRA actuel en parallèle. Ajouter au moteur : sound design
  discret (pas/tissu sous la musique), qualité de boucle, keyframes de jonction
  régénérées FLUX + FLF2V, ColorMatch systématique.
- **Phase 3** (trailers) : la voix passe par ElevenLabs (décision d'abonnement
  Patrice) ; le producteur ajoute la checklist diffusion/mesure (Attribution,
  UTM, page de lancement) en sidecar opérateur.
- **Phase 4** (industrialisation) : cadence révisée à ≤1/jour avec variation
  obligatoire (et non 3-7/sem « max ») ; ajouter la stratégie funnel
  (Instagram + Fanvue/Patreon) et les formats sériels numérotés + Shorts de
  milestone au backlog éditorial.

## État d'avancement au moment de la synthèse

- Phase 0 : téléchargements darkstar en cours (~30 Go : Fun-Control, SeedVR2,
  DepthAnythingV2, 5 custom nodes). Restera : deps Python + smoke tests.
- Vague sol « durcissement qualité » en cours (import Flow, bitrate master,
  loudnorm/LUT).
- Amont code livré et poussé : catalogue de poses, plan V4, journal de reprise,
  producteur de trailers (plan→handoff→assemble).
- Décisions Patrice en attente (non bloquantes) : tarif AI Ultra, abonnements
  ElevenLabs/Epidemic, choix du livre pilote.
