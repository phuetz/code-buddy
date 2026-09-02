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
