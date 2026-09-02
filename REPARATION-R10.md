# Réparation R10 — jumeaux compagnon et canaux

## État initial

- Dépôt : `/home/patrice/DEV/cb-repar-jumeaux-b-2026-09-02`
- Branche attendue : `fix/repar-jumeaux-b-2026-09-02`
- HEAD initial : `35a3f6f17`
- Vérification lue intégralement : `VERIF-A-LIRE.md`
- Fichiers non suivis présents avant le chantier : `VERIF-A-LIRE.md`, `node_modules/` ; ils sont hors périmètre et seront préservés.
- Coordination Fable 5 lue ; le fichier `docs/FABLE5-CODEX-COORDINATION.md` n'est pas modifié (consigne de mission).

## Jumeaux à fermer (ordre d'impact quotidien Lisa)

1. **Rappels** — `loadPendingAcks()` / `loadSnoozes()` avalent une corruption comme un magasin vide (jumeau de `loadReminders` D2) ; `dueSnoozes()` retire le report avant livraison (jumeau de D6).
2. **Proactif** — persistance relation/follow-up permissive ; `speakCanonicalVoiceInitiative()` enregistre la trace vocale avant l'artefact (jumeau D1/D8).
3. **Passerelle** — `getChannel()` ne prouve pas `connected` ; schémas JSON valides mais incohérents acceptés pour profil/inbox.
4. **Appairage** — allowlist persistée non rechargée par le chemin live ; validation élémentaire + fallback IPC `loadPairing()` ; handlers silencieux sur expéditeur bloqué.
5. **File d'envoi** — `background-tasks.ts` ignore `{ success, sent, failed }` ; notification de transcription Telegram avant autorisation.

## Méthode

Pour chaque point : un test par jumeau qui rougit sans le correctif, correctif minimal, test vert, typecheck + eslint ciblé, un commit `fix(<scope>): …` en français, `git add` nominatif.

### 1. Rappels — jumeaux D2/D6

**Jumeaux :** `loadPendingAcks()` / `loadSnoozes()` avalaient JSON invalide / fichier vide / non-liste comme un magasin vide ; `dueSnoozes()` retirait et persistait le report avant `say`/`notify`.

**Correctif :** même motif que `loadReminders` (ENOENT = vide, le reste lève) + écriture tmp+rename ; `dueSnoozes()` ne fait que lire ; `consumeSnooze()` n'écrit qu'après une annonce réussie.

**Rouge (avant correctif) :**

```text
node node_modules/vitest/vitest.mjs run tests/companion/reminder-ack-persistence.test.ts
FAIL  … does not treat a corrupt pending-ack store as empty (jumeau D2)
AssertionError: promise resolved "undefined" instead of rejecting

node node_modules/vitest/vitest.mjs run tests/companion/reminders-snooze.test.ts
FAIL  … does not treat a corrupt snooze store as empty (jumeau D2)
FAIL  … does not consume due snoozes until they are delivered (jumeau D6)
FAIL  … puts the snooze back when the re-announce fails (jumeau D6)
Tests  3 failed | 8 passed (11)
```

**Vert (après correctif) :**

```text
node node_modules/vitest/vitest.mjs run tests/companion/reminder-ack-persistence.test.ts tests/companion/reminders-snooze.test.ts tests/companion/reminders.test.ts tests/companion/reminder-runner.test.ts
Test Files  4 passed (4)
Tests  37 passed (37)
```

`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` : exit 0  
`node node_modules/eslint/bin/eslint.js src/companion/reminders.ts src/companion/reminder-runner.ts tests/companion/reminder-ack-persistence.test.ts tests/companion/reminders-snooze.test.ts` : exit 0

### 2. Proactif — jumeaux D1/D8

**Jumeaux :** `loadRelationshipState()` / `loadEventFollowUps()` avalaient JSON invalide comme un état vide ; `speakCanonicalVoiceInitiative()` journalisait le tour assistant avant le résultat du speaker.

**Correctif :** ENOENT = défaut, le reste lève ; sauvegardes atomiques ; la trace vocale n'est écrite qu'après `speak !== false`.

**Rouge :**

```text
FAIL  … does not treat a corrupt follow-up store as empty (jumeau D1)
FAIL  … does not treat a corrupt relationship store as empty defaults (jumeau D1)
FAIL  … does not journal a local initiative when the speaker reports failure (jumeau D8)
Tests  3 failed | 23 passed (26)
```

**Vert :**

```text
node node_modules/vitest/vitest.mjs run tests/companion/relationship-state.test.ts tests/companion/event-followups.test.ts tests/conversation/voice-continuity.test.ts tests/companion/proactive-engine.test.ts tests/companion/presence-loop.test.ts
Test Files  5 passed (5)
Tests  64 passed (64)
```

`tsc --noEmit -p tsconfig.json` : exit 0  
`eslint` ciblé : exit 0

### 3. Passerelle — jumeaux D3/D4/D5/D7

**Jumeaux :** `getChannel()` suffisait à marquer un adapter `ready`/`completed` même déconnecté ; un JSON valide mais incohérent (`[]`, `{}`, `channels: "bad"`, `items: [{}]`) était accepté.

**Correctif :** le lifecycle et le start admin exigent `status.connected` ; `connect()` en échec désenregistre le canal ; profil/inbox valident l'objet racine, le tableau et chaque entrée.

**Rouge :** 5 tests (lifecycle registered-but-disconnected, start completed, profil, inbox, unregister after connect failure).

**Vert :**

```text
node node_modules/vitest/vitest.mjs run tests/companion-gateway.test.ts tests/server/channel-intake.test.ts
Test Files  2 passed (2)
Tests  28 passed (28)
```

`tsc --noEmit -p tsconfig.json` : exit 0  
`eslint` ciblé : exit 0
