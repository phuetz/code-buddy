# Réparation FLOTTE1

## État initial

- Mission reçue le 2026-09-03.
- Rapport créé avant toute inspection du dépôt.
- Inspection, réservation, implémentation et vérifications à documenter au fil de l'eau.

## Journal de travail

- 2026-09-03 — rapport initial créé.
- 2026-09-03 — `docs/FABLE5-CODEX-COORDINATION.md` et `scripts/deleguer.sh` lus ; aucune réservation FLOTTE1 concurrente trouvée.
- 2026-09-03 — chantier réservé sur `feat/flotte1-journal-chaine-2026-09-03`, base `3fcf5a97d`.
- 2026-09-03 — étude `ETUDE-BUZZ.md` § 5 lue ; reprise limitée aux invariants de chaîne, identité Ed25519, approbation et JSON strict, sans Buzz ni dépendance ajoutée.
- 2026-09-03 — journal implémenté avec stockage configurable pour rendre les tests hermétiques ; le défaut reste `~/.codebuddy/delegations` et l’intégration dans `deleguer.sh` reste désactivée sans `CODEBUDDY_LANE_LEDGER=1`.
- 2026-09-03 — porte de fusion implémentée : dépôt propre, entrée de lane réussie et signée, HEAD/rapport inchangés, typecheck, tests touchés ou `--tests`, approbation chaînée, puis fast-forward ou `--merge` explicite.

## Vérifications rouge / vert

- Rouge environnemental (non probant pour la fonction) : `npx vitest run tests/scripts/lane-ledger.test.ts -t "appends canonical signed entries" --reporter=verbose` → code 1, `ERR_MODULE_NOT_FOUND: vitest` car `node_modules/` est absent du clone. Une installation locale hermétique est requise avant le vrai rouge.
- Dépendances : `npm ci --cache .npm --prefer-offline --no-audit --no-fund` → code 0, 1 848 paquets installés dans le clone.
- Rouge fonctionnel : même commande ciblée après installation → code 1, 1 test en échec et 8 ignorés ; cause attendue `scripts/lane-ledger.sh ENOENT`.
- Vert journal : test ciblé `appends canonical signed entries` → 1 passé, 8 ignorés, code 0.
- Vert altération : test ciblé `reports the exact broken line` → 1 passé, 8 ignorés, code 0.
- Vert opt-in : filtre `deleguer.sh ledger opt-in` → 2 passés, 7 ignorés, code 0 ; absence de `ledger.jsonl` sans drapeau, entrée complète avec drapeau.
- Vert porte : filtre `approval gate` → 5 passés, 4 ignorés, code 0.
- Vert ciblé cumulé : `npx vitest run tests/scripts/lane-ledger.test.ts --reporter=verbose` → 1 fichier, 9 tests passés, code 0.
- Statique ciblé : `bash -n scripts/deleguer.sh scripts/lane-ledger.sh scripts/fusionner-lane.sh`, ESLint strict du moteur/test et `git diff --check` → code 0, aucune sortie.
- Vert ciblé après mutation de signature : FLOTTE1 compte désormais 10/10 tests passés. Le test global `tests/security/donnees-personnelles.test.ts` échoue séparément sur trois occurrences préexistantes hors lot (`REPARATION-DARK3.md`, une ancienne mention de coordination et `src/companion/assistant-config.ts`) ; aucune ne vient des fichiers FLOTTE1 et elles ne sont pas modifiées ici.
- Typecheck complet : `npm run typecheck` → principal puis `tsconfig.gpuNode-identity.json`, code 0.
- Vert final FLOTTE1 : `npx vitest run tests/scripts/lane-ledger.test.ts --reporter=verbose` → 1 fichier, 10 tests passés, code 0.
- Lint final ciblé : `npx eslint scripts/lane-ledger.mjs tests/scripts/lane-ledger.test.ts --max-warnings=0` → code 0, aucune sortie.
- Syntaxe finale : `bash -n scripts/deleguer.sh scripts/lane-ledger.sh scripts/fusionner-lane.sh` → code 0, aucune sortie.
- Données du lot : recherche ciblée des chemins privés, hôtes/adresses et termes interdits dans les nouveaux scripts, le test et le guide → code 0, aucune occurrence.

## Commits

- `d85b7a65a` — `docs(fleet): reserve FLOTTE1 ledger work` (rapport initial et réservation).
- `7098e39d4` — `feat(fleet): add signed lane approval ledger` (implémentation et 9 tests).
- `57a9fbad8` — `test(fleet): verify signature tampering and opt-out` (mutation explicite de signature et défaut réellement absent).
- Lot documentaire de passation : commit courant/HEAD.

## État de passation

- Comportement historique de `deleguer.sh` conservé par défaut et couvert sans variable.
- Journal et clés réellement exercés uniquement sous `test-scripts/` dans ce clone ; aucune écriture dans le vrai `~/.codebuddy`.
- Aucun push, aucune API payante, aucun service et aucun dépôt original touchés.
- Limite ouverte documentée : sans ancre externe du dernier hash, une troncature de fin ne peut pas être distinguée d’un historique plus court.
