# BATCHFIX1 — /batch : résumé trompeur entre unités d'écriture et de vérification

**Date** : 2026-09-04
**Lane** : BATCHFIX1
**Zone réservée** : `src/commands/handlers/batch-handlers.ts` et ses tests
**Ne pas toucher** : `src/agent/delegation/`, tests VERIFIX3A/B en cours

## Constat de départ (à partir de `docs/reports/2026-09/RAPPORT-INCONNU1.md`, section /batch)

`buddy -p "/batch …"` sur deux unités (une écriture, une vérification) crée bien les
deux fichiers attendus, mais le résumé final compte l'unité de VÉRIFICATION
(qui par nature n'écrit rien) comme un « FAIL », car la garde anti-« done vide »
(GK12/TAUTFIX1 : « pas de `done` sans fichier modifié ») est appliquée sans
distinguer une unité d'écriture d'une unité de lecture/vérification.

## Plan de travail

1. Lire en entier `src/commands/handlers/batch-handlers.ts`,
   `tests/commands/gk34-batch.test.ts`, `tests/commands/batch*.test.ts`.
2. Reproduire EN VRAI sur Ollama local (`qwen3:4b-instruct`) : `/batch` headless
   avec une unité d'écriture + une unité de vérification, dans un dépôt jouet
   du clone. Coller le résumé trompeur observé.
3. Trancher le contrat : une unité sans écriture attendue et réussie doit être
   rapportée comme succès/« vérifié » ; une unité d'écriture sans fichier
   modifié doit rester un FAIL (ne pas affaiblir la garde TAUTFIX1).
4. Test qui rougit avant le correctif, correctif minimal, test vert.
5. Rejouer la reproduction réelle, coller le résumé honnête obtenu.
6. Vérifier/corriger `docs/agents.md` (section /batch).

## Reproduction réelle AVANT correctif (rapport INCONNU1, log conservé)

Log réel `~/DEV/cb-inconnu1-2026-09-04/_qa/inconnu1/headless-batch.log` (autre
lane, lecture seule) : `buddy -p "/batch use the bash tool to run 'echo one
> file-one.txt' and separately 'echo two > file-two.txt'"` sur Ollama
`qwen3:4b-instruct`. Le planificateur LLM a ajouté de lui-même trois unités
non demandées (deux « verify », un « ensure-directory »). Résumé trompeur
obtenu :

```
Completed: 2/5 (3 failed)
...
  [OK] run-echo-one (9.7s)
      Files: file-one.txt
      Updated file-one.txt
  [OK] run-echo-two (18.4s)
      Files: file-two.txt
      Updated file-two.txt
  [FAIL] verify-file-one (8.0s)
      No files changed
  [FAIL] verify-file-two (16.4s)
      No files changed
  [FAIL] ensure-directory (4.4s)
      No files changed
```

Les deux fichiers demandés sont bien créés ; les trois `[FAIL]` sont des
unités de VÉRIFICATION qui n'avaient rien à écrire — le résumé « 3 failed »
est trompeur pour un inconnu qui ne voulait que les 2 tâches demandées.

## Analyse du code (`src/commands/handlers/batch-handlers.ts`)

Deux points appliquent la garde anti-« done vide » :
- `executeBatchPlan` (boucle d'exécution, ~ligne 370) : le vrai point de
  garde de production (confirmé par `docs/reports/2026-09/REPARATION-TAUTFIX1.md`),
  qui rétrograde tout résultat `success:true` + `filesChanged:[]` en FAIL.
- `createDefaultBatchSpawnFn`'s `spawn()` (~ligne 680) : forçait déjà
  `success:false` en interne dès que `filesChanged.length === 0`, donc la
  garde d'`executeBatchPlan` ne voyait jamais passer un `success:true` à
  arbitrer sur le chemin de production réel.

`BatchUnit` n'avait aucun moyen d'indiquer qu'une unité est une simple
vérification (pas d'écriture attendue) — la garde traitait toute unité de la
même façon.

## Contrat tranché

- Nouveau champ optionnel `BatchUnit.verifyOnly?: boolean` : `true` marque
  une unité qui **ne doit pas** écrire de fichier (vérification/lecture) ;
  absent/`false` (défaut) = unité d'écriture, comportement **inchangé**.
- `verifyOnly: true` + succès + `filesChanged: []` ⇒ résultat `success: true`,
  résumé « Verified — no write expected » au lieu de « No files changed ».
- `verifyOnly` absent (ou `false`) + succès + `filesChanged: []` ⇒ **toujours**
  `success: false`, résumé « No files changed » (garde GK12/TAUTFIX1 intacte,
  vérifiée par mutation — voir Preuves).
- Une unité `verifyOnly` dont le tour échoue réellement (le spawn lève une
  erreur) reste un FAIL — le contrat ne masque que le cas « succès sans
  écriture », jamais un échec réel.
- `decomposeBatchGoal` (chemin LLM) accepte et propage `verifyOnly` depuis le
  JSON du planificateur ; le prompt lui demande explicitement de marquer
  ainsi toute unité de vérification qu'il ajoute de lui-même.
- `createDefaultBatchSpawnFn`'s `spawn()` ne tranche plus success/fail sur
  diff vide : il rapporte fidèlement l'issue du délégué (`success: true` si
  le tour n'a pas levé d'erreur) + le diff réel, et laisse `executeBatchPlan`
  seul juge du verdict — car seul `executeBatchPlan` connaît `unit.verifyOnly`.

## Test rouge → correctif → vert

Quatre tests ajoutés à `tests/commands/gk34-batch.test.ts` (describe
`GK34 /batch success contract`) :
1. `a verifyOnly unit that changes no files is reported as success (BATCHFIX1)`
2. `a verifyOnly unit that fails its own turn is still reported as FAIL (BATCHFIX1)`
3. `a plain write unit with no file changes still fails even amid verifyOnly units (BATCHFIX1, TAUTFIX1 guard intact)`
4. `decomposeBatchGoal parses verifyOnly from an LLM decomposition and defaults writers to unset`

Rouge avant correctif (extrait) :
```
 × a verifyOnly unit that changes no files is reported as success (BATCHFIX1)
   AssertionError: expected false to be true
 × a plain write unit with no file changes still fails even amid verifyOnly units (BATCHFIX1, TAUTFIX1 guard intact)
   AssertionError: expected false to be true
 × decomposeBatchGoal parses verifyOnly from an LLM decomposition and defaults writers to unset
   AssertionError: expected undefined to be true
 Test Files  1 failed (1)
      Tests  3 failed | 17 passed (20)
```

Vert après correctif : `Test Files 1 passed (1)` / `Tests 21 passed (21)`
(avec `tests/commands/batch-slash-wiring.test.ts`).

**Mutation de preuve** (garde TAUTFIX1) : `if (unit.verifyOnly)` remplacé par
`if (false && unit.verifyOnly)` → 2 tests rougissent immédiatement
(`a verifyOnly unit... reported as success` et `a plain write unit... TAUTFIX1
guard intact`) ; `git checkout --` a restauré le fichier (voir note sous
Vérifications finales : le premier essai a par erreur restauré la version
d'AVANT tout le correctif, ré-appliqué intégralement et revérifié).

## Reproduction réelle APRÈS correctif

Même dépôt jouet, même modèle `qwen3:4b-instruct` local (`ollama ps` vérifié
avant/après, un seul gros modèle chargé), commande :
`node dist/index.js --permission-mode dontAsk -p "/batch use the bash tool to
run 'echo one > file-one.txt' and separately 'echo two > file-two.txt', then
verify each file's content"`. Le planificateur a ajouté deux unités
`verify-file-one-content` / `verify-file-two-content` (marquées `verifyOnly`
côté prompt LLM). Résumé honnête obtenu :

```
Completed: 4/4 (0 failed)

  [OK] create-file-one (19.8s)
      Files: file-one.txt
      Updated file-one.txt
  [OK] create-file-two (28.6s)
      Files: file-two.txt
      Updated file-two.txt
  [OK] verify-file-one-content (11.9s)
      Verified — no write expected
  [OK] verify-file-two-content (25.1s)
      Verified — no write expected
```

## Documentation

`docs/agents.md`, section « Batch Decomposition », point 3 : reformulé pour
décrire les deux cas (unité d'écriture vs `verifyOnly`) au lieu de l'énoncé
absolu « a spawn that changes no files is a failure ». Le test
`tests/commands/gk34-batch.test.ts > GK34 /batch docs` (contrat de non-régression
sur cette section) reste vert.

## Vérifications finales

- `npx vitest run tests/commands/gk34-batch.test.ts tests/commands/batch-slash-wiring.test.ts`
  → 2 fichiers, 21/21 verts.
- `npx vitest run tests/commands tests/security` → **174 fichiers / 2119 tests, tous verts**
  (compté avant et après le correctif — même total).
- `npx vitest run tests/security/donnees-personnelles.test.ts` → 1 fichier, 7/7 verts.
- `npx tsc --noEmit -p .` → exit 0.
- `npx eslint src/commands/handlers/batch-handlers.ts tests/commands/gk34-batch.test.ts --max-warnings=0` → exit 0.
- `git diff --check` → exit 0.
- Mutation de la garde `if (unit.verifyOnly)` → rouge (2 tests) → restauration.
  Incident mineur pendant la restauration : un premier `git checkout --` (fait
  avant tout commit du correctif) a annulé la totalité du correctif au lieu de
  la seule mutation ; détecté immédiatement (`grep verifyOnly` vide), le
  correctif complet a été ré-appliqué à l'identique et revérifié de bout en
  bout (tests, tsc, eslint, reproduction réelle) avant tout commit. Aucune
  perte : rien n'avait encore été committé à ce stade.
- `ollama ps` vérifié avant/après chaque lancement : un seul `qwen3:4b-instruct`
  chargé pendant les repros de cette lane (un second modèle `qwen2.5:1.5b-instruct`
  observé plus tard appartient à une autre lane de la flotte, sur la même
  machine partagée — non lancé par BATCHFIX1, non arrêté).
- Aucun push, aucune API payante, aucun service démarré/arrêté par cette lane.
  `~/code-buddy` et le vrai `~/.codebuddy` non touchés (HOME temporaire
  `_qa/batchfix1/home` pour tous les appels `buddy`).

## Bilan (dix lignes max)

1. Reproduit en vrai (Ollama `qwen3:4b-instruct`) : `/batch` sur 2 fichiers
   créait bien les 2 fichiers mais comptait 3 unités de vérification/LLM
   comme « FAIL » — résumé « 2/5 (3 failed) » alors que rien n'a échoué.
2. Cause : la garde anti-« done vide » (GK12/TAUTFIX1) ne distinguait pas une
   unité d'écriture d'une unité de vérification.
3. Contrat ajouté : `BatchUnit.verifyOnly?: boolean` — absent/false = garde
   stricte inchangée ; `true` = succès sans écriture n'est plus un FAIL.
4. `createDefaultBatchSpawnFn`'s `spawn()` ne tranche plus lui-même ; seul
   `executeBatchPlan` (qui connaît `verifyOnly`) arbitre.
5. 4 tests rouges avant correctif, verts après ; mutation de la garde → rouge
   confirmé sur 2 tests, restauré.
6. Rejeu réel après correctif : `Completed: 4/4 (0 failed)`, les deux
   vérifications rapportées `[OK] … Verified — no write expected`.
7. `docs/agents.md` (section Batch Decomposition) corrigé pour décrire le
   contrat exact ; test de non-régression associé resté vert.
8. Vérifications : 174 fichiers/2119 tests `tests/commands`+`tests/security`
   verts ; `donnees-personnelles` 7/7 ; `tsc` 0 ; ESLint ciblé 0 ; diff-check 0.
9. Aucun push, aucune API payante, aucun service touché ; HOME temporaire
   confiné au clone.
10. Reste ouvert : `parseNumberedBatchUnits` (listes numérotées explicites de
    l'utilisateur) ne détecte pas `verifyOnly` par heuristique — hors mandat,
    la fuite observée venait du planificateur LLM, pas des listes numérotées.
