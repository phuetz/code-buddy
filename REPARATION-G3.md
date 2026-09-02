# Réparation G3 — mémoire/compagnon

## Cadre

- Chantier : G3R, huit trous issus de la revue Gemini.
- Dépôt de travail : clone courant uniquement.
- Règles : aucun push, aucune API payante, aucun service système, aucune écriture hors du clone, aucune donnée personnelle.
- Rapport ouvert avant toute inspection du dépôt.

## Journal

### Initialisation

- Rapport créé avant inspection : 2026-09-02.
- Revue, tests rouges, fichiers lus, commandes, résultats et commits : à compléter ici au fil de l’eau.

## Trous

Ordre de traitement : 8, 6, 1, 2, 3, 4, 5, 7.

Pour chaque trou : preuve rouge, diagnostic, correctif minimal, preuve verte, tests voisins, commit conventionnel.

### Trou 8 — photo caméra vers le mauvais chat

- Test relu : `tests/companion/revue-gemini-camera-share.test.ts`.
- Premier rejeu : rouge, mais avec un défaut du test lui-même (`takeSnapshot` au lieu de l'option publique `capture`, puis absence de `success` dans `CameraSnapshotResult`) ; le test s'arrêtait avant la fuite. Preuve de l'écart : les tests voisins et `CameraShareOptions` utilisent `capture` et exigent `success`.
- Test réaligné sur ce contrat, sans modifier les assertions de sécurité.
- Rouge effectif (`npx vitest run tests/companion/revue-gemini-camera-share.test.ts`, exit 1) : 1) `mockSendPhoto` appelé une fois alors que `inboundChatId` est indéfini ; 2) `mockSendPhoto` jamais appelé alors que le chat Telegram demandeur diffère du singleton d'alerte.
- Diagnostic source lu : `isConfiguredAlertChat` autorise l'absence de destination et exige à tort le chat d'alerte ; le chemin Telegram n'injecte aucun expéditeur lié au chat entrant.
- Correctif : `isConfiguredAlertChat` refuse toute absence d'identifiant ; le chemin Telegram accepte un expéditeur injecté et celui-ci est câblé vers `message.channel.id` dans le handler, avec repli sûr vers le chat d'alerte uniquement quand il est la destination entrante.
- Tests voisins réalignés sur le contrat : un callback injecté est un transport ciblé ; une voix sans chat entrant reste en description seule.
- Vert : `npx vitest run tests/companion/revue-gemini-camera-share.test.ts tests/companion/camera-share.test.ts tests/sensory/camera-share-wiring.test.ts` — **3 fichiers, 19 tests passés**.
- Vérifications avant commit : `npm run typecheck` — **exit 0** (racine + config GPU) ; ESLint ciblé sur les fichiers touchés — **exit 0**.
- Commit : à compléter.

## Bilan final

À compléter — dix lignes maximum.
