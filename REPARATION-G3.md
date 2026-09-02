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

### Trou 2 — rappel one-shot qui refire

- Test relu : `tests/companion/revue-gemini-reminders-oneshot.test.ts`.
- Rouge initial (`npx vitest run tests/companion/revue-gemini-reminders-oneshot.test.ts`, exit 1) : 2 tests rouges — le one-shot réajusté redevient dû ; l’attente `parseVoiceReminder(... à 15h ...)` exigeait une date.
- Arbitrage documenté : la seconde attente était incohérente avec le contrat de `parseVoiceReminder` et son test voisin, qui réservent le one-shot aux dates explicites. Le test a été corrigé en non-régression (`date` absente, `isOneShot=false`), sans code produit.
- Correctif : `isDue` considère tout one-shot avec `lastFiredAt` comme consommé, quelle que soit l’heure éventuellement réajustée.
- Vert voisin : `npx vitest run tests/companion/revue-gemini-reminders-oneshot.test.ts tests/companion/reminders.test.ts tests/companion/reminders-oneshot.test.ts tests/companion/reminders-agenda.test.ts tests/companion/reminders-confirm-dedup.test.ts` — **5 fichiers, 50 tests passés**.
- Vérifications : `npm run typecheck` — **exit 0** ; ESLint ciblé avec `--quiet` — **exit 0**.
- Commit : à compléter.

### Trou 1 — fidélité du souvenir après relecture

- Test relu : `tests/memory/revue-gemini-roundtrip.test.ts`.
- Rouge (`npx vitest run tests/memory/revue-gemini-roundtrip.test.ts`, exit 1) : indentation supprimée (`  let` relu `let`) et ligne de contenu `  Tags: ...` consommée comme métadonnée.
- Correctif : les continuations nouvellement écrites utilisent le marqueur non ambigu `  |`; le parseur enlève seulement le préfixe de transport et garde un repli compatible pour l’ancien format, y compris les anciens tags.
- Vert voisin : `npx vitest run tests/memory/revue-gemini-roundtrip.test.ts tests/memory/memory-multiline-roundtrip.test.ts tests/memory/persistent-memory.test.ts` — **3 fichiers, 20 tests passés**.
- Vérifications : `npm run typecheck` — **exit 0** ; ESLint ciblé avec `--quiet` — **exit 0**.
- Commit : à compléter.

### Trou 6 — course entre processus sur le fichier mémoire

- Test relu : `tests/memory/revue-gemini-concurrency.test.ts`.
- Rouge (`npx vitest run tests/memory/revue-gemini-concurrency.test.ts`, exit 1) : le second snapshot écrase le premier ; `valueA` vaut `null` au lieu de `Token de session critique`.
- Correctif : `saveMemories` recharge le fichier sous `withSessionLock`, fusionne seulement les ajouts/modifications locales depuis le dernier snapshot, protège les suppressions contre un écrasement concurrent, puis écrit via fichier temporaire + renommage atomique. Le snapshot persisté est mis à jour uniquement après renommage réussi.
- Vert ciblé : `npx vitest run tests/memory/revue-gemini-concurrency.test.ts tests/memory/persistent-memory.test.ts tests/memory/memory-manager.test.ts` — **2 fichiers trouvés, 17 tests passés** ; `tests/memory/memory-manager.test.ts` n’existe pas dans ce clone et a été ignoré par Vitest.
- Vérifications : `npm run typecheck` — **exit 0** ; ESLint ciblé — **exit 0**, avec 2 avertissements `no-explicit-any` déjà présents dans le test rouge.
- Commit : à compléter.

## Bilan final

À compléter — dix lignes maximum.
