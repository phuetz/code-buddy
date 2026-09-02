# R17 — Réparation des innovations Code Buddy mesurées par exécution

Date : 2026-09-02  
Dépôt : `/home/patrice/DEV/cb-repar-cb2-2026-09-02`  
Branche : `fix/repar-cb2-2026-09-02`  
Rapport source : `AUDIT-A-REPARER.md` (lu intégralement)  
Coordination : `docs/FABLE5-CODEX-COORDINATION.md` lue intégralement ; non modifiée conformément à la consigne R17.

## Réservation et garde-fous

Chantier réservé à cette session dans ce rapport. Zone : code et tests strictement nécessaires aux points 1, 4, 5, 6, 7, 8, 9, 10, 11 et 12 de l’audit. Les points 4 et 6 sont d’abord vérifiés contre R16 avant décision. Aucun service externe, port local, réseau, fournisseur LLM ou appel réel n’est utilisé. Les fichiers non suivis préexistants (`AUDIT-A-REPARER.md`, `node_modules`) restent hors index.

Règles d’édition : correctif minimal, test rouge puis vert par point, un commit par point, `git add` nominatif uniquement. Aucun `git add -A`, `git commit -a`, push, reset, prune, nettoyage récursif ou modification de `docs/FABLE5-CODEX-COORDINATION.md`.

## Baseline auditée

L’audit d’exécution réelle rapporte notamment :

- deux tours `--prompt` réussis sous `CODEBUDDY_TIMELINE=true`, sans timeline, session ni run ;
- `skills exchange install --trust` et `dev plan` bloqués à 300 s après production de leur sortie utile ;
- rejets non gérés pour `skills exchange keys` gate off et `research sync` sans pair ;
- `skills delete` incapable de supprimer le skill exchange installé ;
- backups sans payload et non visibles depuis un répertoire `--output` custom ;
- `ws search` incomplet sur `.txt` et indifférent à `--repo` ;
- `context_expand` exposé hors gate et refusé en mode plan ;
- absence de `widgetHtml` pour la table Markdown headless ;
- `shadow status -d` utilisant le dépôt du répertoire courant.

## Suivi par point

| Point | État initial | Correctif / décision | Commit | Preuves finales |
|---|---|---|---|---|
| 1 — timeline/session/run headless | FAIL audit | Corrigé : session persistante, run et timeline branchés dans `processPromptHeadless`; `--ephemeral` reste exclu | `77db72602` | Vert : 1 test, 5 skipped ; typecheck 0 ; ESLint 0 |
| 4 — install exchange ne rend pas la main | FAIL audit ; R16 vérifié, correctif R16 limité à l’import local | Corrigé : `stopWatching()` après le reload de l’échange | `a0f069d25` | Vert : 2 fichiers, 19 tests ; typecheck 0 ; ESLint 0 |
| 5 — `dev plan` ne rend pas la main | FAIL audit | Corrigé : readiness skills suivie, agent/MCP/registre/RunStore libérés en `finally` | `0efcddb68` | Vert : 1 test ; typecheck 0 ; ESLint 0 |
| 6 — suppression d’un skill exchange | FAIL audit ; R16 vérifié, import exchange absent du lockfile | Corrigé : `exchange install` enregistre le SKILL.md dans le Skills Hub avant retour | `0e88c5665` | Vert : cycle CLI install→delete ; 2 fichiers, 19 tests ; typecheck 0 ; ESLint 0 |
| 7 — rejets non gérés | FAIL audit | Corrigé : catches métier, message logger et `process.exitCode=1` pour les deux commandes | `9e3a3a124` | Vert : 4 fichiers, 35 tests ; typecheck 0 ; ESLint 0 |
| 8 — backup vide/non listé | FAIL audit | Corrigé : payload base64 réel dans le manifeste, vérification des octets, `list --output` respecté | `ec0468116` | Vert : 2 fichiers, 16 tests ; typecheck 0 ; ESLint 0 (8 warnings préexistants, 0 erreur) |
| 9 — recherche workspace | FAIL audit | Déjà couvert : `.txt` et `repos` fonctionnent sur le chemin CLI réel ; aucun changement produit | — | Vérification temporaire : 1 fichier, 8 tests passés ; test retiré sans commit |
| 10 — context zoom/lecture seule | FAIL audit | Corrigé : gate sur noms inspectés/adaptateurs du registre ; `context_expand` est explicitement read-only | `81df5aa4a` | Vert : 1 fichier, 5 tests ; typecheck 0 ; ESLint 0 |
| 11 — widget automatique headless | FAIL audit | Corrigé : rendu de table sûr et branchement `autoWidget` dans la sortie JSON ; seuil 200 inclusif | `e6e4a647b` | Vert : headless 1 test + 6 skipped ; matcher/auto-widget 2 fichiers, 14 tests ; typecheck 0 ; ESLint 0 |
| 12 — shadow `-d` | FAIL audit | Corrigé : option `-d/--directory` acceptée par `shadow status` après le sous-comando | commit final point 12 (HEAD) | Vert : 1 test + 10 skipped ; typecheck 0 ; ESLint 0 |

## Journal des vérifications

Les tests utilisent uniquement des faux fournisseurs HTTP locaux ou des doubles ; aucun LLM réel, réseau ou service existant n’a été sollicité.

### Point 1 — headless/session/timeline

Chemin : `src/index.ts:processPromptHeadless` → `SessionStore.createSession`/`saveCurrentSession` → `RunStore.startRun/endRun` → hook timeline de `CodeBuddyAgent`. Le chemin ne crée ces artefacts que si `sessionStore.isEphemeral()` est faux.

Rouge : `npx vitest run tests/cli/headless-exit-code.test.ts` — échec sur l’absence de fichier `.json` dans `sessions`.

Vert :

```text
Test Files  1 passed (1)
Tests  1 passed | 5 skipped
```

Vérifications : `npm run typecheck` → exit 0 ; `npx eslint src/index.ts tests/cli/headless-exit-code.test.ts` → exit 0. Commit `77db72602`.

### Point 8 — backup

Chemin : `backup create` collecte les fichiers → écrit les octets base64 dans `files[].content` → `backup verify` recalcule taille/checksum ; `backup list` parse maintenant son propre `--output`.

Rouge : `npx vitest run tests/commands/backup-archive-r17.test.ts tests/commands/backup-handlers.test.ts` — 2 échecs : `archive.files` indéfini et archive vide sans `exitCode` d’échec.

Vert :

```text
Test Files  2 passed (2)
Tests  16 passed (16)
```

Vérifications : `npm run typecheck` → exit 0 ; `npx eslint src/commands/handlers/backup-handlers.ts tests/commands/backup-archive-r17.test.ts tests/commands/backup-handlers.test.ts` → exit 0, 8 warnings existants, 0 erreur. Commit `ec0468116`.

### Points 4 et 5 — ressources one-shot

R16 a été vérifié dans son rapport et ses commits : fermeture des watchers de l’import local et cohérence import local→liste→delete. Il ne couvrait pas l’action `skills exchange install`, qui recharge son propre registre, ni le cleanup de `dev plan`.

Pour le point 4, rouge : `npx vitest run tests/skills/skill-exchange-command-lifecycle.test.ts` → `spawnSync ... ETIMEDOUT (5 sec)` après installation utile. Vert :

```text
Test Files  2 passed (2)
Tests  19 passed (19)
```

Pour le point 5, rouge : `npx vitest run tests/commands/dev/dev-lifecycle.test.ts` → `timedOut: true` à 5 s, avec le plan déjà imprimé. Vert :

```text
Test Files  1 passed (1)
Tests  1 passed (1)
```

Vérifications point 4 : `npm run typecheck` → exit 0 ; `npx eslint src/commands/skills-cli/index.ts tests/skills/skill-exchange-command-lifecycle.test.ts` → exit 0. Commit `a0f069d25`.

Vérifications point 5 : `npm run typecheck` → exit 0 ; `npx eslint src/agent/codebuddy-agent.ts src/commands/dev/index.ts tests/commands/dev/dev-lifecycle.test.ts` → exit 0. Commit `0efcddb68`.

### Point 6 — delete exchange

Rouge : le second processus réel `skills delete imported-authored-lifecycle-demo --approved-by R17 --json` retournait status 1 (`Skill not found in lockfile`) alors que le dossier installé existait.

Vert : le même test de cycle install→delete passe dans les 19 tests ci-dessus ; le dossier est absent après la suppression. Commit `0e88c5665`.

### Point 7 — rejets métier

Chemin : actions Commander `skills exchange keys` et `research sync` → rejet de la garde/absence de pair → catch → logger + exit 1.

Rouge : les deux tests échouaient parce que `parseAsync()` rejetait directement l’`Error` métier.

Vert :

```text
Test Files  4 passed (4)
Tests  35 passed (35)
```

Vérifications : `npm run typecheck` → exit 0 ; `npx eslint src/commands/skills-cli/index.ts src/commands/research/knowledge-ingest.ts tests/skills/skill-exchange-errors-r17.test.ts tests/commands/research/research-sync-errors-r17.test.ts` → exit 0. Commit `9e3a3a124`.

### Point 9 — ws search

Le chemin `src/commands/ws.ts` (`--repo`) → `WorkspaceSearchTool.execute({ repos })` → `SearchTool.searchText()` → ripgrep ne filtre pas les `.txt` par défaut et restreint bien la liste des dépôts avant recherche. Une vérification temporaire du CLI réel a passé :

```text
Test Files  1 passed (1)
Tests  8 passed (8)
```

Les tests temporaires ont été retirés et aucun fichier source n’a été modifié pour ce point ; le résultat est donc « déjà couvert », pas un commit artificiel.

### Point 10 — context zoom

Rouge : `npx vitest run tests/tools/context-expand.test.ts` — `expected [...] not to include 'context_expand'` (le nom était encore visible avec le gate off).

Vert :

```text
Test Files  1 passed (1)
Tests  5 passed (5)
```

Vérifications : `npm run typecheck` → exit 0 ; `npx eslint src/codebuddy/tools.ts src/tools/registry/interactive-adapters.ts src/security/permission-modes.ts tests/tools/context-expand.test.ts` → exit 0. Commit `81df5aa4a`.

### Point 11 — widgets headless

Le seuil est démontré par `detectWidgetable`: longueur `>= 200`, donc 200 accepté et 199 refusé. La branche table produit un document CSP sans script ; la sortie JSON conserve `.result` et ajoute `widgetHtml` seulement si disponible.

Rouge : le nouveau test de seuil échouait avant le correctif (`expected undefined to be 'table'`) ; l’audit headless observait aussi l’absence de `widgetHtml`.

Vert :

```text
Test Files  1 passed (1)
Tests  1 passed | 6 skipped

Test Files  2 passed (2)
Tests  14 passed (14)
```

Vérifications : `npm run typecheck` → exit 0 ; `npx eslint src/index.ts src/widgets/auto-widget.ts tests/cli/headless-exit-code.test.ts tests/widgets/widget-matcher.test.ts` → exit 0. Commit `e6e4a647b`.

### Point 12 — shadow

Rouge : `npx vitest run tests/speculative/shadow-workspace.test.ts -t "status accepts -d"` → `error: unknown option '-d'`.

Vert :

```text
Test Files  1 passed (1)
Tests  1 passed | 10 skipped
```

Vérifications : `npm run typecheck` → exit 0 ; `npx eslint src/commands/shadow.ts tests/speculative/shadow-workspace.test.ts` → exit 0.

## Passation finale

Le commit final du point 12 a ajouté nominativement `src/commands/shadow.ts`, `tests/speculative/shadow-workspace.test.ts` et ce rapport. Le hash exact de HEAD est relevé à la passation ; les commits précédents sont listés dans le tableau ci-dessus. `docs/FABLE5-CODEX-COORDINATION.md` reste inchangé. Les fichiers préexistants `AUDIT-A-REPARER.md` et `node_modules/` restent hors index.
