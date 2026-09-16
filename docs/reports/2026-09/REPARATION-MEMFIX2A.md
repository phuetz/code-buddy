# Réparation MEMFIX2A — harnais atomiques (lot A)

## Périmètre, réservation et méthode

Ce rapport a été créé avant toute inspection du dépôt, puis le chantier a été réservé dans
`docs/FABLE5-CODEX-COORDINATION.md`.

- Clone : `~/DEV/cb-memfix2a-2026-09-04`
- Branche : `fix/memfix2a-harnais-atomiques-2026-09-04`
- HEAD initial : `8403c05377444caf45db349b84f8b4c0aafc3845`
- HOME QA : `~/DEV/cb-memfix2a-2026-09-04/_qa/memfix2a/home` (gitignoré)
- Original `~/code-buddy` : jamais écrit ; aucun push, aucune API payante, aucun service touché.
- Zone : les 16 tests de la mission, ce rapport et la ligne de coordination ; deux corrections
  `src/` sont documentées ci-dessous car elles correspondent à des défauts de production
  observés par des tests nommés.

Chaque fichier a d'abord été exécuté seul avec
`HOME="$PWD/_qa/memfix2a/home" npx vitest run <fichier>`. Les lignes ci-dessous sont celles
de la reproduction rouge initiale, avant réalignement du harnais.

## Rouge initial et verdict par échec

| Fichier | Rouge initial | Verdict détaillé |
|---|---:|---|
| `tests/channels/dm-pairing.test.ts` | 2/38 | `:549` : **défaut production MEM1** ; `readJsonAtomic(..., [])` transformait un JSON corrompu en allowlist vide. `:567` : effet de cascade du spy `logger.warn` après le premier échec, donc harnais. |
| `tests/features/tailscale-dashboard-nodes.test.ts` | 2/76 | `:372`, `:378` : harnais périmé ; la persistance atomique `node:fs` contournait le mock `fs` et relisait l’état réel du HOME. |
| `tests/identity/identity-manager.test.ts` | 3/40 | `:361`, `:374`, `:389` : harnais périmé ; le writer atomique atteignait `/home/user` au lieu du `fs/promises` mocké. |
| `tests/sensory/agent-reply-routing.test.ts` | 1/2 | `:147` : harnais incomplet, scoreboard mocké sans `measuredTurnLatency`; aucun défaut atomique. |
| `tests/tools/verify-tool.test.ts` | 1/7 | `:99` : contrat de test périmé ; le code fail-closed refuse `CONFIRMED` sans oracle réel. L’assertion a été réalignée, sans l’affaiblir. |
| `tests/unit/auth.test.ts` | 4/145 | `:882`, `:1768` : assertions sur les anciens writers ; `:1161`, `:1172` : mock `fs` incomplet laissant passer l’implémentation atomique et son `unlink`. Quatre échecs de harnais. |
| `tests/unit/codebase-rag.test.ts` | 1/56 | `:468` : harnais périmé ; l’écriture passe par `writeJsonAtomic`, non par `fs/promises.writeFile`. |
| `tests/unit/config-migrator.test.ts` | 18/69 | `:287`, `:300` et les assertions de chargement/migration/événements en cascade : harnais périmé ; `readJsonAtomic`/`writeJsonAtomic` n’étaient pas mockés, puis le chemin fictif `/test` était réellement créé. |
| `tests/unit/cost-tracker.test.ts` | 7/68 | `:85`, `:271`, `:409`, `:416`, `:512`, `:523`, `:544` : anciens `fs-extra` read/write/ensureDir attendus ; harnais périmé face aux atomiques. |
| `tests/unit/crypto.test.ts` | 3/62 | `:316`, `:345`, `:468` : assertions sur `fs-extra.writeFile`; harnais périmé, le code utilise `writeFileAtomic`. |
| `tests/unit/doctor-fix.test.ts` | 12/16 | Toutes les erreurs étaient `No "spawnSync" export is defined` dans le mock `child_process` : harnais incomplet, sans lien avec MEM1. |
| `tests/unit/error-handling-audit.test.ts` | 2/21 | `:85` : défaut source réel (`src/index.ts:3209`, `catch {}` dans le fichier audité). `:161` : défaut du test (`fail` non défini). Aucun lien avec l’écriture atomique. |
| `tests/unit/graph-drift.test.ts` | 4/14 | `:33`, `:47` : mock `fs` sans primitives atomiques ; `:102`, `:116` : lectures configurées sur `readFileSync` alors que la production lit via `readJsonAtomicSync`. Quatre échecs de harnais. |
| `tests/unit/history-manager.test.ts` | 20/77 | Échecs répartis sur les assertions de chargement/sauvegarde (notamment ancien `readFileSync`/`writeFileSync`) : harnais périmé et état persistant réel non isolé. |
| `tests/unit/hook-manager.test.ts` | 8/65 | Échecs de chargement, ajout, suppression, reload et erreurs : anciens `readJsonSync`/`writeJsonSync`/`ensureDirSync`; harnais périmé. |
| `tests/unit/mcp-client.test.ts` | 5/54 | Échecs de chargement/sauvegarde/formatage sur anciens `readFileSync`/`writeFileSync`; harnais périmé face à `readJsonAtomicSync`/`writeJsonAtomicSync`. |

Total initial : **93 échecs sur 888 tests**, répartis dans les 16 fichiers.

## Corrections appliquées

- `dm-pairing` : lecture avec défaut `null` et validation ; un fichier allowlist illisible est
  maintenant journalisé puis rejeté, au lieu de vider silencieusement les autorisations.
- Les harnais de tailscale, identity, auth, codebase-rag, config-migrator, cost-tracker,
  crypto, graph-drift, history-manager, hook-manager et mcp-client mockent les fonctions du
  module `src/utils/atomic-write.js` réellement appelées et vérifient leurs payloads/options.
  Les chemins fictifs ne déclenchent plus d’I/O réel.
- `doctor-fix` exporte `spawnSync` dans son mock ; `agent-reply-routing` fournit la mesure de
  latence attendue par le selector ; `verify-tool` vérifie explicitement le fail-closed sans
  oracle réel.
- `error-handling-audit` utilise une assertion Vitest valide et `src/index.ts:3209` lie le
  paramètre `_error` dans le `catch` vide audité. Ce second point est un défaut de production
  statique réel découvert par le test, préexistant à MEM1, et non une modification de contrat.
- Aucune assertion n’a été supprimée ou affaiblie ; aucun `it.skip` n’a été ajouté.

## Preuves de mutation, une par fichier

Chaque mutation a été appliquée temporairement dans `src/`, le test ciblé a été exécuté en
rouge, puis la ligne nominale a été restaurée par `apply_patch`.

| Test | Mutation et résultat rouge |
|---|---|
| `dm-pairing` | Défaut `null` → `[]` dans `loadAllowlist` : exécution complète `38 tests`, `2 failed` (`:549` + cascade `:567`). Restauré. |
| `tailscale-dashboard-nodes` | `listDevices` → `[]` : ciblé `1 failed, 75 skipped`, attendu 2 reçu 0 (`:383`). Restauré. |
| `identity-manager` | Map mise à jour avec contenu vide : ciblé `1 failed, 39 skipped`, contenu attendu non conservé (`:387`). Restauré. |
| `agent-reply-routing` | `localOnly: ...` → `localOnly: false` : ciblé `1 failed, 1 skipped`, `true` attendu, `false` reçu (`:147`). Restauré. |
| `verify-tool` | `claimedConfirmed && oracleCount > 0` → `claimedConfirmed` : ciblé `1 failed, 6 skipped`, verdict `CONFIRMED` reçu au lieu de `NEEDS REVIEW`. Restauré. |
| `auth` | mode d’écriture `0o600` → `0o644` : ciblé `1 failed, 143 skipped`, mode 420 reçu au lieu de 384. Restauré. |
| `codebase-rag` | garde `if (!indexPath) return` inversée : ciblé `1 failed, 55 skipped`, writer atomique non appelé. Restauré. |
| `config-migrator` | payload `config` → `{}` : ciblé `1 failed, 68 skipped`, payload vide reçu. Restauré. |
| `cost-tracker` | budget assigné à `0` : ciblé `1 failed, 67 skipped`, 100 attendu, 0 reçu. Restauré. |
| `crypto` | mode `0o600` → `0o644` : ciblé `1 failed, 61 skipped`, assertion de permissions rouge (`:351`). Restauré. |
| `doctor-fix` | création de `.codebuddy` déplacée vers `.broken` : ciblé `1 failed, 15 skipped`, répertoire attendu absent (`:65`). Restauré. |
| `error-handling-audit` | `catch (_error)` → `catch {}` : exécution `2 failed, 19 passed`, violations à `src/index.ts:3209`. Restauré. |
| `graph-drift` | `tripleCount` forcé à 0 : ciblé `1 failed, 13 skipped`, 1 attendu, 0 reçu (`:49`). Restauré. |
| `history-manager` | `text.trim()` → `text` : ciblé `1 failed, 76 skipped`, espaces non retirés (`:150`). Restauré. |
| `hook-manager` | `getHooks()` → `[]` : ciblé `1 failed, 64 skipped`, longueur 1 attendue, 0 reçue (`:318`). Restauré. |
| `mcp-client` | payload `{ servers }` → `{ servers: [] }` : ciblé `1 failed, 53 skipped`, serveur attendu absent (`:285`). Restauré. |

## Vert final et contrôles

- Relances isolées finales : **16 fichiers passés, 888/888 tests passés**, avec les comptages
  suivants : 38, 76, 40, 2, 7, 145, 56, 69, 68, 62, 16, 21, 14, 77, 65 et 54.
- `HOME="$PWD/_qa/memfix2a/home" npx vitest run tests/unit` : **358 fichiers, 341 passés,
  17 rouges ; 15 086 tests, 14 852 passés, 234 rouges ; 5 erreurs non gérées**. Les 17
  fichiers rouges sont hors lot et n’ont pas été modifiés : `swarm-handler`, `workflows`,
  `response-cache`, `vector-store`, `persistent-checkpoint-manager`, `session-replay`,
  `migration-manager`, `memory`, `permission-config`, `security-modes`, `roi-tracker`,
  `version-detector`, `tool-permissions`, `mcp-discovery`, `telemetry-config`,
  `misc-tools-part2`, `webhooks`.
- `HOME="$PWD/_qa/memfix2a/home" npx tsc --noEmit -p .` : code 0.
- ESLint ciblé sur les 2 sources et 15 tests modifiés : code 0, 0 erreur ; 17 avertissements
  `no-unused-vars` préexistants dans les tests.
- `git diff --check` : code 0.

## Commits et passation

- `f6817bcc5` — `fix(dm-pairing): fail closed on corrupt allowlists` : défaut MEM1 de
  production dans `src/channels/dm-pairing.ts`.
- `a2bd27b31` — `test(memory): align state harnesses with atomic persistence` : 11 harnais
  alignés sur `atomic-write`.
- `e21d52719` — `test(harness): restore audited contracts` : 4 harnais non atomiques et le
  défaut statique audité de `src/index.ts`.
- Le rapport et la coordination sont ajoutés séparément par chemins nommés ; aucun
  `git add -A` ni `git commit -a` n’a été utilisé.

## Bilan (dix lignes maximum)

1. Les 16 fichiers du lot A sont verts : 888/888 tests.
2. 92 des 93 échecs initiaux étaient des harnais périmés ou incomplets.
3. Un vrai défaut MEM1 a été corrigé : allowlist DM corrompue désormais fail-closed.
4. Un défaut statique `catch {}` préexistant a aussi été corrigé pour l’audit nommé.
5. Une mutation source par fichier a fait rougir son test, puis toutes ont été restaurées.
6. `tests/unit` reste à 234 échecs dans 17 fichiers de l’autre lot, nommés ci-dessus.
7. TypeScript est à 0 erreur et ESLint ciblé à 0 erreur.
8. `git diff --check` est vert.
9. Aucun push, service, API payante ou écriture dans `~/code-buddy`.
10. La coordination est mise à jour avec les hashes et vérifications ci-dessus.
