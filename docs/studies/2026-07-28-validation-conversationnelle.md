# Validation par conversation — amendement à la chaîne de publication

**Demande de Patrice, 2026-07-28** : « un système où je peux discuter avec toi
des vidéos et valider la publication ».

Remplace l'interface à cocher prévue initialement dans
`scripts/influencer/review-batch.py`.

## Le principe

La revue du lot se fait **en conversation**, pas dans une page web :

1. Le lot arrive à l'état `à_valider`.
2. **Claude présente le lot** — pour chaque vidéo : titre, sujet, sources
   utilisées, miniature, durée, plateformes visées.
3. **Claude signale ce qui l'inquiète**, explicitement et en premier : sujet
   sensible, source fragile, affirmation invérifiable, titre trop racoleur,
   attribution manquante, proximité avec un sujet exclu.
4. **Patrice répond** : approuve, rejette, demande une modification, ou pose
   une question. La discussion peut porter sur une seule vidéo.
5. Claude écrit les décisions dans la file (`publish-queue.py`).

## Pourquoi la validation humaine reste

**Ce n'est pas une question de compétence de Claude, mais de responsabilité.**
- C'est le nom de Patrice sur les chaînes. Les conséquences (relation CCAS,
  cumul ARE, image professionnelle) le touchent lui, personnellement.
- Claude ne voit pas comment une vidéo *atterrit* réellement, ni ce qui s'est
  passé cette semaine hors de la conversation.
- Une publication est **irréversible** : reprise, mise en cache, rediffusée.
  La supprimer ne l'annule pas.
- Le risque catastrophique reste la **fermeture de compte** (YouTube/TikTok
  ferment sans préavis ni recours) — on perdrait chaînes, audience, historique.

## Ce que Claude doit faire dans cette revue

- **Dire ses réserves AVANT de résumer le contenu** — ne pas noyer un doute
  dans un compte rendu enthousiaste.
- **Distinguer** ce qui est vérifié de ce qui est supposé, et le dire.
- **Ne jamais approuver à la place de Patrice**, même sur insistance : écrire
  une décision dans la file exige une réponse explicite de sa part.
- Contrôle bloquant maintenu : `editorial_policy.py` refuse à l'entrée de la
  file (France Travail, chômage, CCAS — Patrice est en cumul ARE et
  prestataire de la CCAS).

## Ce qui reste automatique

Tout le reste : détection du sujet, collecte des preuves, script,
enregistrement, montage, sous-titres, miniature, métadonnées, déclaration IA,
programmation, publication effective aux horaires prévus.
Objectif tenu : **deux minutes de Patrice par semaine**, en conversation.
