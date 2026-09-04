# Réparation MEMFIX2B — lot B

Date : 2026-09-04  
Branche : `fix/memfix2b-harnais-atomiques-2026-09-04`  
Clone : `~/DEV/cb-memfix2b-2026-09-04`  
Zone réservée : les 16 fichiers de tests unitaires explicitement attribués à MEMFIX2B. Aucun fichier de production n'a été conservé modifié : aucun défaut MEM1 n'a été démontré.

## Contraintes et méthode

- Rapport créé puis chantier réservé dans `docs/FABLE5-CODEX-COORDINATION.md` avant toute inspection du dépôt.
- Aucun accès en écriture à `~/code-buddy`, aucun push, aucune API payante et aucun service lancé.
- Toutes les commandes de test ont reçu `HOME=~/DEV/cb-memfix2b-2026-09-04/_qa/memfix2b/home`, `TMPDIR=~/DEV/cb-memfix2b-2026-09-04/_qa/memfix2b/tmp` et `XDG_CACHE_HOME=~/DEV/cb-memfix2b-2026-09-04/_qa/memfix2b/cache`. `_qa/memfix2b/` est exclu localement par `.git/info/exclude`.
- Chaque fichier a d'abord été exécuté seul sur HEAD non corrigé. Les journaux sont sous `~/DEV/cb-memfix2b-2026-09-04/_qa/memfix2b/logs/*.initial.log`.
- Aucun test supprimé ou ignoré, aucune assertion affaiblie. Les attentes portent maintenant sur la frontière atomique et sur les données structurées réellement persistées.
- Pour chaque fichier réparé, une mutation temporaire de production a ensuite été appliquée avec `apply_patch`, le test a été observé rouge, puis la mutation a été annulée avec `apply_patch` avant la vérification finale.

Commande de reproduction, répétée séparément pour chacun des 16 fichiers :

```bash
env HOME=~/DEV/cb-memfix2b-2026-09-04/_qa/memfix2b/home \
  TMPDIR=~/DEV/cb-memfix2b-2026-09-04/_qa/memfix2b/tmp \
  XDG_CACHE_HOME=~/DEV/cb-memfix2b-2026-09-04/_qa/memfix2b/cache NO_COLOR=1 \
  npx vitest run tests/unit/<fichier>.test.ts
```

## État initial : rouges collés et verdicts

Les numéros de ligne ci-dessous sont ceux des fichiers de test avant correction. Pour chaque ligne listée, le verdict est **HARNAIS** ; il n'existe aucun verdict **PRODUCTION** dans ce lot. Les 15 exécutions arrivées à terme totalisent `178 failed | 830 passed` sur 1 008 tests. `webhooks` ne terminait pas et n'a donc produit aucun décompte initial.

| Fichier | Rouge initial | Lignes des échecs initiaux | Verdict par échec et cause |
|---|---:|---|---|
| `mcp-discovery.test.ts` | 15 failed / 39 passed | 241, 500, 541, 554, 569, 580, 593, 608, 619, 629, 639, 651, 662, 674, 856 | 15/15 HARNAIS : anciennes assertions `fs.writeFileSync` et mock `fs` sans `openSync`; la persistance passe par `writeJsonAtomicSync`. |
| `memory.test.ts` | 59 failed / 123 passed | 361, 411, 416, 422, 428, 444, 539, 554, 564, 576, 591, 601, 816, 950, 977, 1056; cascades de `beforeEach` à 1138, 1146, 1173, 1179, 1190, 1267, 1315, 1353, 1406, 1431, 1453, 1483, 1536, 1573 | 59/59 HARNAIS : les spies `fs-extra` ne voyaient plus les lectures/écritures atomiques; de vraies données s'accumulaient sous le HOME temporaire et faussaient les comptes. |
| `migration-manager.test.ts` | 18 failed / 33 passed | 381, 405, 424, 444, 458, 475, 501, 524, 539, 553, 581, 649, 682, 794, 808, 824, 840, 887 | 18/18 HARNAIS : le mock `fs-extra` n'interceptait pas l'écrivain atomique, d'où `EACCES: permission denied, mkdir '/test'`. |
| `misc-tools-part2.test.ts` | 1 failed / 7 passed | 122 | 1/1 HARNAIS : `copyFileContent` poursuivait jusqu'au vrai backend presse-papiers et expirait après 20 s; le test du routage VFS devait isoler cet effet aval. |
| `permission-config.test.ts` | 1 failed / 47 passed | 158 | 1/1 HARNAIS : attente sur `fs.writeFileSync`, désormais contourné par `writeJsonAtomicSync`. |
| `persistent-checkpoint-manager.test.ts` | 7 failed / 58 passed | 170, 261, 282, 667, 730, 984, 1018 | 7/7 HARNAIS : le faux système de fichiers n'était plus relié à `readJsonAtomicSync`/`writeJsonAtomicSync`. |
| `response-cache.test.ts` | 3 failed / 36 passed | 93, 118, 447 | 3/3 HARNAIS : attentes directes sur `ensureDir`/`writeJson`; la création de dossier et le JSON appartiennent maintenant à la frontière atomique. |
| `roi-tracker.test.ts` | 13 failed / 38 passed | 76, 105, 122, 152, 240, 246, 254, 283, 313, 498, 544, 639, 670 | 13/13 HARNAIS : spies lecture/écriture distincts de ceux de l'écrivain atomique, puis état réel accumulé et comptages pollués. |
| `security-modes.test.ts` | 1 failed / 124 passed | 227 | 1/1 HARNAIS : attente sur l'ancien `fs.writeFileSync` au lieu de `writeJsonAtomicSync`. |
| `session-replay.test.ts` | 6 failed / 45 passed | 238, 288, 420, 446, 477, 499 | 6/6 HARNAIS : les mocks `fs-extra.readJson`/`writeJson` n'alimentaient plus les primitives atomiques. |
| `telemetry-config.test.ts` | 1 failed / 5 passed | 44 | 1/1 HARNAIS : le test écrivait avec un ancien spy mais relisait le disque réel; `false` restait visible au lieu de `true`. |
| `tool-permissions.test.ts` | 5 failed / 72 passed | 589, 616, 704, 769, 781 | 5/5 HARNAIS : assertions et injection d'erreur placées sur `fs.writeFileSync`, plus appelé. |
| `vector-store.test.ts` | 6 failed / 70 passed | 391, 413, 430, 438, 476, 719 | 6/6 HARNAIS : `No "openSync" export is defined on the "fs" mock`; chemins `/tmp` en dur incompatibles avec l'isolation demandée. |
| `version-detector.test.ts` | 3 failed / 63 passed | 410, 419, 426 | 3/3 HARNAIS : l'ancien mock `fs-extra.writeJson` laissait l'écrivain atomique tenter `mkdir '/test'`, donc EACCES. |
| `webhooks.test.ts` | exécution bloquée, interrompue à 3 min 04 s | aucun test achevé; sortie arrêtée après `RUN v4.1.9` | HARNAIS : les exports nommé et `default` de `node:https`/`node:http` détenaient deux spies `request` différents; l'import builtin échappait au transport configuré. Le faux `fs` devait aussi être raccordé aux primitives atomiques. Après correction, aucun transport réel n'est atteint. |
| `workflows.test.ts` | 39 failed / 65 passed, 5 rejets non gérés | 504, 513, 519, 525, 534, 546, 554, 563, 578, 585, 601, 614, 621, 637, 792, 820, 846, 866, 886, 909, 928, 947, 969, 1001, 1019, 1036, 1063, 1094, 1131, 1175, 1203, 1239, 1268, 1295, 1333, 1350, 1370, 1390, 1440 | 39/39 HARNAIS et 5/5 rejets en cascade : mock `fs` sans `openSync`, donc chargement/sauvegarde atomique impossible. |

Extraits représentatifs conservés dans les journaux initiaux :

```text
AssertionError: expected "vi.fn()" to be called at least once
Error: [vitest] No "openSync" export is defined on the "fs" mock.
Error: EACCES: permission denied, mkdir '/test'
Error: Test timed out in 20000ms.
AssertionError: expected false to be true // Object.is equality
```

## Corrections du harnais

- `mcp-discovery`, `permission-config`, `security-modes`, `tool-permissions` : spies explicites sur `writeJsonAtomicSync`; vérification exacte du chemin, de l'objet et, lorsqu'il est contractuel, du mode `0o600`.
- `memory`, `migration-manager`, `session-replay`, `version-detector` : adaptateurs atomiques asynchrones raccordés aux doubles `fs-extra` existants; les lectures respectent le fallback `null`.
- `persistent-checkpoint-manager`, `vector-store`, `webhooks`, `workflows` : adaptateurs atomiques synchrones branchés sur le système de fichiers mémoire existant, avec sérialisation/désérialisation structurée.
- `response-cache`, `telemetry-config` : frontière atomique simulée directement; stockage remis à zéro entre tests et assertions sur le document persisté.
- `roi-tracker` : les mocks `fs` et atomiques partagent les mêmes spies hoistés, ce qui supprime l'état réel résiduel.
- `misc-tools-part2` : `ClipboardTool.writeText` est isolé; le test prouve toujours la lecture VFS avec le chemin et l'encodage attendus, puis le contenu transmis au presse-papiers.
- `vector-store` et `webhooks` : remplacement des littéraux `/tmp/...` par `path.join(os.tmpdir(), ...)`, donc toutes les écritures temporaires restent sous `~/DEV/cb-memfix2b-2026-09-04/_qa/memfix2b/tmp`.
- `webhooks` : un même spy `request` est partagé entre les formes nommée et `default` des mocks `node:http`/`node:https`; cela supprime la sortie réseau qui causait le blocage.

Commits fonctionnels :

- `f9d9e2119 test(memfix2b): realign atomic persistence harnesses`
- `160e5a7ea test(clipboard): isolate file-copy side effect`
- `ab63292a8 test(webhooks): share transport and atomic seams`

## Preuves de mutation de production

Chaque ligne représente une mutation volontairement fautive, non conservée. Tous les processus Vitest ont terminé avec le code `1`; un `git diff -- src` vide a confirmé l'annulation des 16 mutations.

| Test | Mutation temporaire | Résultat rouge |
|---|---|---:|
| `mcp-discovery` | `src/mcp/config.ts:278`, URL `$schema` remplacée | 1 failed / 53 passed |
| `memory` | `src/memory/enhanced-memory.ts:950`, mises à jour de profil ignorées | 3 failed / 179 passed |
| `migration-manager` | `src/versioning/migration-manager.ts:883`, compteur de migrations non incrémenté | 1 failed / 50 passed |
| `misc-tools-part2` | `src/tools/clipboard-tool.ts:333`, lecture VFS omise | 1 failed / 7 passed |
| `permission-config` | `src/security/permission-config.ts:248`, mode `0o600` changé en `0o644` | 2 failed / 46 passed |
| `persistent-checkpoint-manager` | `src/checkpoints/persistent-checkpoint-manager.ts:199`, identifiant du chemin altéré | 1 failed / 64 passed |
| `response-cache` | `src/utils/response-cache.ts:92`, `savedAt` numérique changé en chaîne | 1 failed / 38 passed |
| `roi-tracker` | `src/analytics/roi-tracker.ts:101`, tâche retirée aussitôt ajoutée | 13 failed / 38 passed |
| `security-modes` | `src/security/security-modes.ts:232`, mode sauvegardé altéré | 1 failed / 124 passed |
| `session-replay` | `src/advanced/session-replay.ts:71`, identifiant omis du nom de fichier | 3 failed / 48 passed |
| `telemetry-config` | `src/utils/telemetry-config.ts:24`, valeur par défaut `true` changée en `false` | 1 failed / 5 passed |
| `tool-permissions` | `src/security/tool-permissions.ts:193`, mode `0o600` changé en `0o644` | 2 failed / 75 passed |
| `vector-store` | `src/context/codebase-rag/vector-store.ts:202`, version acceptée `1` changée en `2` | 1 failed / 75 passed |
| `version-detector` | `src/versioning/version-detector.ts:267`, version persistée remplacée par `0.0.0` | 1 failed / 65 passed |
| `webhooks` | `src/api/webhooks.ts:435`, mode `0o600` changé en `0o644` | 1 failed / 83 passed |
| `workflows` | `src/workflows/state-manager.ts:119`, nouvel état `pending` changé en `paused` | 3 failed / 101 passed |

Journaux : `~/DEV/cb-memfix2b-2026-09-04/_qa/memfix2b/logs/*.mutation.log`.

## Vérifications finales

### Les 16 fichiers, séparément après annulation des mutations

Les 16 commandes isolées sont vertes : **16 fichiers, 1 092 tests passed, 0 failed**.

| Fichier | Résultat final |
|---|---:|
| `mcp-discovery.test.ts` | 54 passed |
| `memory.test.ts` | 182 passed |
| `migration-manager.test.ts` | 51 passed |
| `misc-tools-part2.test.ts` | 8 passed |
| `permission-config.test.ts` | 48 passed |
| `persistent-checkpoint-manager.test.ts` | 65 passed |
| `response-cache.test.ts` | 39 passed |
| `roi-tracker.test.ts` | 51 passed |
| `security-modes.test.ts` | 125 passed |
| `session-replay.test.ts` | 51 passed |
| `telemetry-config.test.ts` | 6 passed |
| `tool-permissions.test.ts` | 77 passed |
| `vector-store.test.ts` | 76 passed |
| `version-detector.test.ts` | 66 passed |
| `webhooks.test.ts` | 84 passed |
| `workflows.test.ts` | 104 passed |

Journaux : `~/DEV/cb-memfix2b-2026-09-04/_qa/memfix2b/logs/*.final.log`.

### Balayage `tests/unit`

Commande exacte :

```bash
env HOME=~/DEV/cb-memfix2b-2026-09-04/_qa/memfix2b/home \
  TMPDIR=~/DEV/cb-memfix2b-2026-09-04/_qa/memfix2b/tmp \
  XDG_CACHE_HOME=~/DEV/cb-memfix2b-2026-09-04/_qa/memfix2b/cache NO_COLOR=1 \
  npx vitest run tests/unit
```

Résultat : **13 failed | 345 passed (358 fichiers)**; **88 failed | 14 998 passed (15 086 tests)**, durée 28,14 s. Les 16 fichiers MEMFIX2B restent tous verts. Fichiers rouges hors zone, laissés intacts :

| Fichier hors zone | Échecs |
|---|---:|
| `config-migrator.test.ts` | 18 |
| `cost-tracker.test.ts` | 7 |
| `auth.test.ts` | 4 |
| `codebase-rag.test.ts` | 1 |
| `crypto.test.ts` | 3 |
| `hook-manager.test.ts` | 8 |
| `doctor-fix.test.ts` | 12 |
| `mcp-client.test.ts` | 5 |
| `error-handling-audit.test.ts` | 2 |
| `graph-drift.test.ts` | 4 |
| `history-manager.test.ts` | 20 |
| `swarm-handler.test.ts` | 1 |
| `tools-core.test.ts` | 3 |

Journal : `~/DEV/cb-memfix2b-2026-09-04/_qa/memfix2b/logs/tests-unit.full.log`. Le balayage a ajouté une entrée datée dans `.codebuddy/agent-memory/alice/MEMORY.md`; cette seule écriture induite a été retirée avec `apply_patch` après le test.

### Contrôles statiques

- `npx tsc --noEmit -p .` : code 0.
- ESLint ciblé sur les 16 fichiers : code 0, **0 erreur**, 42 avertissements préexistants (`no-unused-vars` et deux `no-explicit-any`).
- `git diff --check` : code 0.
- `git diff -- src` : vide; **0 modification de production conservée**.

## Conclusion

Verdict final : **0 défaut de production, 178 échecs de harnais plus 1 exécution bloquée (`webhooks`)**. Les tests observaient les anciennes primitives `fs` au lieu de la frontière atomique MEM1, ou laissaient échapper un effet externe. Les 16 harnais sont réalignés, chacun détecte une mutation du comportement de production qu'il couvre, et les seuls rouges restants dans `tests/unit` appartiennent à des fichiers hors de la zone MEMFIX2B.
