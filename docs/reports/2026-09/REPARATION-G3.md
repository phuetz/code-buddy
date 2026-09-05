# Réparation G3 — mémoire/compagnon

## Cadre

- Chantier : G3R, huit trous issus de la revue Gemini.
- Dépôt de travail : clone courant uniquement.
- Règles : aucun push, aucune API payante, aucun service système, aucune écriture hors du clone, aucune donnée personnelle.
- Rapport ouvert avant toute inspection du dépôt.

## Journal

### Initialisation

- Rapport créé avant inspection : 2026-09-02.
- Revue lue en entier : `REVUE-G3-GEMINI.md` ; les huit tests rouges et leurs sources ont été lus avant chaque correctif.
- Fichiers de production relus : `src/companion/camera-share.ts`, `src/commands/handlers/channel-handlers.ts`, `src/companion/reminders.ts`, `src/memory/persistent-memory.ts`, `src/memory/memory-forgetting.ts`, `src/memory/facts-memory.ts`, `src/companion/relationship-state.ts`, ainsi que `src/persistence/session-lock.ts`.
- Commandes et résultats sont consignés sous chaque trou ; aucun push, service système, API payante ou écriture hors clone n'a été utilisé.

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
- Commit : `bdf1e8ad5 fix(companion): scope camera photos to requesting chat`.

### Trou 3 — acquittement lié au mauvais rappel

- Test relu : `tests/companion/revue-gemini-reminders-ack.test.ts`.
- Rouge (`npx vitest run tests/companion/revue-gemini-reminders-ack.test.ts`, exit 1) : les deux acquittements explicites (`médicaments`, `billet de train`) retournaient le rappel plus récent (`dentiste`, `pause café`).
- Correctif : `matchAck` normalise le transcript et les libellés, cherche une séquence de mots correspondant à un rappel en attente, puis conserve le dernier rappel comme repli pour les formules génériques.
- Vert voisin : `npx vitest run tests/companion/revue-gemini-reminders-ack.test.ts tests/companion/reminders.test.ts tests/companion/reminder-runner.test.ts` — **3 fichiers, 24 tests passés**.
- Vérifications : `npm run typecheck` — **exit 0** ; ESLint ciblé avec `--quiet` — **exit 0**.
- Commit : `7957e0438 fix(companion): match reminder acknowledgements by label`.

### Trou 2 — rappel one-shot qui refire

- Test relu : `tests/companion/revue-gemini-reminders-oneshot.test.ts`.
- Rouge initial (`npx vitest run tests/companion/revue-gemini-reminders-oneshot.test.ts`, exit 1) : 2 tests rouges — le one-shot réajusté redevient dû ; l’attente `parseVoiceReminder(... à 15h ...)` exigeait une date.
- Arbitrage documenté : la seconde attente était incohérente avec le contrat de `parseVoiceReminder` et son test voisin, qui réservent le one-shot aux dates explicites. Le test a été corrigé en non-régression (`date` absente, `isOneShot=false`), sans code produit.
- Correctif : `isDue` considère tout one-shot avec `lastFiredAt` comme consommé, quelle que soit l’heure éventuellement réajustée.
- Vert voisin : `npx vitest run tests/companion/revue-gemini-reminders-oneshot.test.ts tests/companion/reminders.test.ts tests/companion/reminders-oneshot.test.ts tests/companion/reminders-agenda.test.ts tests/companion/reminders-confirm-dedup.test.ts` — **5 fichiers, 50 tests passés**.
- Vérifications : `npm run typecheck` — **exit 0** ; ESLint ciblé avec `--quiet` — **exit 0**.
- Commit : `17be3c9d7 fix(companion): consume fired one-shot reminders`.

### Trou 1 — fidélité du souvenir après relecture

- Test relu : `tests/memory/revue-gemini-roundtrip.test.ts`.
- Rouge (`npx vitest run tests/memory/revue-gemini-roundtrip.test.ts`, exit 1) : indentation supprimée (`  let` relu `let`) et ligne de contenu `  Tags: ...` consommée comme métadonnée.
- Correctif : les continuations nouvellement écrites utilisent le marqueur non ambigu `  |`; le parseur enlève seulement le préfixe de transport et garde un repli compatible pour l’ancien format, y compris les anciens tags.
- Vert voisin : `npx vitest run tests/memory/revue-gemini-roundtrip.test.ts tests/memory/memory-multiline-roundtrip.test.ts tests/memory/persistent-memory.test.ts` — **3 fichiers, 20 tests passés**.
- Vérifications : `npm run typecheck` — **exit 0** ; ESLint ciblé avec `--quiet` — **exit 0**.
- Commit : `e56bb8aab fix(memory): preserve multiline memory formatting`.

### Trou 6 — course entre processus sur le fichier mémoire

- Test relu : `tests/memory/revue-gemini-concurrency.test.ts`.
- Rouge (`npx vitest run tests/memory/revue-gemini-concurrency.test.ts`, exit 1) : le second snapshot écrase le premier ; `valueA` vaut `null` au lieu de `Token de session critique`.
- Correctif : `saveMemories` recharge le fichier sous `withSessionLock`, fusionne seulement les ajouts/modifications locales depuis le dernier snapshot, protège les suppressions contre un écrasement concurrent, puis écrit via fichier temporaire + renommage atomique. Le snapshot persisté est mis à jour uniquement après renommage réussi.
- Vert ciblé : `npx vitest run tests/memory/revue-gemini-concurrency.test.ts tests/memory/persistent-memory.test.ts tests/memory/memory-manager.test.ts` — **2 fichiers trouvés, 17 tests passés** ; `tests/memory/memory-manager.test.ts` n’existe pas dans ce clone et a été ignoré par Vitest.
- Vérifications : `npm run typecheck` — **exit 0** ; ESLint ciblé — **exit 0**, avec 2 avertissements `no-explicit-any` déjà présents dans le test rouge.
- Commit : `331a8483e fix(memory): merge concurrent persistent memory saves`.

### Trou 4 — oubli d'une préférence protégée

- Test relu : `tests/memory/revue-gemini-forgetting-pinned.test.ts`.
- Rouge (`npx vitest run tests/memory/revue-gemini-forgetting-pinned.test.ts`, exit 1) : 2 tests rouges — une catégorie `Preferences` n'était pas reconnue comme protégée et `forgetOlderThan(30)` supprimait une préférence portant le tag `pinned`.
- Diagnostic source lu : `decideForgets` comparait catégorie et tags sans normalisation ; `forgetOlderThan` supprimait toute entrée dépassant le cutoff sans appliquer les mêmes protections. La réconciliation reconstruisait aussi les tags depuis `fact.source`, sans conserver les tags de l'entrée précédente.
- Correctif : `isProtectedMemory` normalise catégories et tags avant comparaison ; `forgetOlderThan` réutilise cette protection. Les chemins de réconciliation (`remember` et `autoCapture`) fusionnent les tags de la mémoire précédente avec la source courante, au lieu de perdre `pinned`; l'écriture directe normalise aussi les catégories reçues à l'exécution.
- Vert et tests voisins : `npx vitest run tests/memory/revue-gemini-forgetting-pinned.test.ts tests/memory/memory-forgetting.test.ts tests/memory/persistent-memory.test.ts tests/memory/archive-restore.test.ts` — **4 fichiers, 38 tests passés**.
- Vérifications : `npm run typecheck` — **exit 0** (racine + config GPU) ; ESLint ciblé avec `--quiet` — **exit 0** ; `git diff --check` — **exit 0**.
- Commit : `c6586df08 fix(memory): protect pinned memories from forgetting`.

### Trou 5 — état relationnel sans borne

- Test relu : `tests/companion/revue-gemini-relationship-state.test.ts`.
- Rouge (`npx vitest run tests/companion/revue-gemini-relationship-state.test.ts`, exit 1) : **1 fichier, 2 tests rouges** — après 200 retrouvailles `personality.sessions` vaut 200 (attendu ≤ 100) ; `saveRelationshipState` relit `mood=500` (attendu ≤ 100), avant même les assertions sur `sessions=999999` et `traits.warmth=999`.
- Diagnostic source lu : `recordReunion` incrémente sans plafond ; `saveRelationshipState` sérialise l'état brut, alors que `personalityOf` ne borne que la vue calculée et `loadRelationshipState` ne normalise pas les champs riches.
- Correctif : ajout de `MAX_RELATIONSHIP_SESSIONS=100`, appliqué par `recordReunion` et `personalityOf`; `saveRelationshipState` et `loadRelationshipState` bornent les métriques `mood`, `traits` et `sessions` avant/après sérialisation, sans ajouter de champs riches aux anciens états.
- Vert et tests voisins : `npx vitest run tests/companion/revue-gemini-relationship-state.test.ts tests/companion/relationship-state.test.ts tests/companion/relationship-mood.test.ts tests/companion/presence-loop.test.ts tests/companion/inner-life.test.ts` — **5 fichiers, 55 tests passés**.
- Vérifications : `npm run typecheck` — **exit 0** (racine + config GPU) ; ESLint ciblé avec `--quiet` — **exit 0** ; `git diff --check` — **exit 0**.
- Commit : `746c4d7d5 fix(companion): bound relationship state metrics`.

### Trou 7 — fait auto-capturé faux

- Test relu : `tests/memory/revue-gemini-autocapture.test.ts`.
- Rouge (`npx vitest run tests/memory/revue-gemini-autocapture.test.ts`, exit 1) : **1 fichier, 2 tests rouges** — `I never said that` est enregistré en préférence ; une affirmation issue uniquement de la réponse (`Ruby on Rails`) est enregistrée en projet.
- Diagnostic source lu : le repli regex cherchait les faits de projet dans `message || response` et acceptait toute phrase commençant par `always` ou `never`, y compris une dénégation conversationnelle ; le chemin Facts envoyait lui aussi `message` et `response` à l'extraction.
- Correctif : le fallback regex et l'extraction Facts ne lisent désormais que `message` pour les faits projet/décisions ; ils ne figent donc jamais une affirmation produite uniquement par la réponse. La règle `always/never` exige un sujet utilisateur (`I/we`) et un verbe d'usage explicite (`use`, `write`, `format`, etc.), ce qui exclut les dénégations comme `I never said that`.
- Vert et tests voisins : `npx vitest run tests/memory/revue-gemini-autocapture.test.ts tests/memory/auto-capture-extraction-failure.test.ts tests/memory/auto-capture-long-key.test.ts tests/memory/persistent-memory.test.ts tests/memory/remember-result-integrity.test.ts` — **5 fichiers, 24 tests passés**.
- Vérifications : `npm run typecheck` — **exit 0** (racine + config GPU) ; ESLint ciblé avec `--quiet` — **exit 0** ; `git diff --check` — **exit 0**.
- Commit : `9f15a226f fix(memory): reject speculative auto-capture`.

## Bilan final

- Fait : trous 8, 6, 1, 2, 3, 4, 5 et 7 corrigés ; huit commits conventionnels, aucun push.
- Rouge/vert : les huit tests de revue sont verts après correction ; le faux test de date du trou 2 a été réaligné sur la documentation et le test voisin.
- Périmètre voisin : `npx vitest run tests/memory tests/companion tests/sensory` — **154 fichiers, 1396 passés, 1 skip**.
- Qualité : `npm run typecheck` — **exit 0** ; `npm run lint` — **exit 0**, 2474 avertissements ; lint ciblé des fichiers touchés — **exit 0** ; `git diff --check` — **exit 0**.
- Ouvert : aucun échec connu ; les répertoires `node_modules` non suivis préexistants ont été laissés intacts.
