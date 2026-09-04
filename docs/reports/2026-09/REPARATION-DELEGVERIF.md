# REPARATION-DELEGVERIF — vérification adversariale du verdict NVIDIA sur DELEG3

- **Lane** : DELEGVERIF
- **Ouvert le** : 2026-09-04, avant toute inspection du code.
- **Clone** : `~/DEV/cb-delegverif-2026-09-04`, branche `fix/delegverif-2026-09-04`, issue de `codex/audit-systeme-nerveux-2026-09-01`.
- **Source du verdict à vérifier** : `docs/reports/2026-09/JUGE-NVIDIA-DELEG3.md` (juge automatique NVIDIA Nemotron 3 Ultra) sur la fusion DELEG3 (`8976a0c5e` QualityGate multiplexé, `c6971eee7` Verifier délégué).
- **Zone réservée** : `src/agent/middleware/quality-gate-middleware.ts`, `src/agent/specialized/agent-registry.ts`, `src/agent/delegation/thread-delegation.ts` et leurs tests.
- **Garde-fous** : HOME temporaire `_qa/delegverif/home` (gitignoré), aucune écriture dans `~/code-buddy` ni dans le vrai `~/.codebuddy`, aucun push, aucune API payante.

## Méthode

Un juge automatique se trompe souvent. Pour chacun des huit points, je lis le code au niveau `fichier:ligne`,
je rends un verdict **VRAI / FAUX / PARTIEL** appuyé sur une preuve (extrait de code ou test exécuté), et :

- si **VRAI** : test qui rougit d'abord, correction minimale, vert, puis mutation du correctif → rouge ;
- si **FAUX** : une phrase d'explication, plus un test de figeage du contrat s'il manquait.

## Contrats à ne pas casser

1. Concurrence par défaut du QualityGate **inchangée** par rapport à l'état d'avant DELEG3 (référence : `git show 8976a0c5e~1:src/agent/middleware/quality-gate-middleware.ts`).
2. Verifier à contexte réellement neuf : aucun message du parent ne doit lui parvenir.
3. Jamais `CONFIRMED` sans oracle.
4. Une gate non requise qui échoue ne bloque pas, si c'était bien le contrat d'avant.
5. Un délégué qui jette ou dépasse son budget ⇒ « revue incomplète », jamais un vert.

## Verdicts

| # | Gravité annoncée | Point | Verdict | Preuve | Suite |
|---|---|---|---|---|---|
| 1 | 🔴 | Résultats mappés avant la fin des délégués ⇒ faux vert | **FAUX** | `thread-delegation.ts:488` — `request.resolve({success:true})` est appelé par `runDelegate` APRÈS la consommation du flux du tour, pas à l'acceptation dans la file ; `thread-task-runner.ts:98-107` attend ce `handle.submit`. | Test d'ancrage ajouté (plantage TARDIF ⇒ revue incomplète). Mutation « mappage à l'acceptation » ⇒ 5 tests rouges. |
| 2 | 🔴 | `parentHistory` fuité vers le Verifier délégué | **PARTIEL** | `verifier-agent.ts:322` — `buildRequest` ne lit que `instruction`, `inputFiles`, `data` ; la conversation repart de `system` + `user`. Aucune fuite réelle. Mais `agent-registry.ts` transmettait `params` verbatim : la frontière n'appliquait pas le contrat. | **Corrigé** : `stripParentContext` retire les six canaux de conversation avant la soumission. Rouge avant, vert après, deux mutations rouges. |
| 3 | 🔴 | Régression silencieuse de la concurrence par défaut | **PARTIEL** | Fait confirmé : `git show 8976a0c5e~1:…:320` était une boucle `for…of` séquentielle ; le défaut est aujourd'hui `delegateConcurrency: 2`. Mais ce n'est ni silencieux ni une régression : c'est l'objectif ANNONCÉ de DELEG3 (`REPARATION-DELEG3.md`, mission ligne 1), plafonné dur à 2, et déjà couvert par le test `maxActive === 2`. Le mécanisme invoqué par le juge est faux : `{...DEFAULT, ...config}` fournit bien 2. | Non annulé (l'annuler exigerait d'affaiblir un test DELEG3 — mutation M4 le prouve). Valeur figée : plafond 2 même si l'appelant demande 5, et retour séquentiel avec `delegateConcurrency: 1`. |
| 4 | 🟠 | Coût vérifié après le tour et non pendant | **FAUX** | `thread-delegation.ts:480-486` — le tour qui franchit le budget échoue LUI-MÊME et ferme son canal ; `:426` refuse en outre toute soumission ultérieure avant de lancer l'agent. Deux gardes indépendantes ; aucun « tour 2 ». | Test d'ancrage ajouté. Mutation retirant LES DEUX gardes ⇒ rouge avec « expected 2 to be 1 », c'est-à-dire exactement le second tour que le juge annonçait. |
| 5 | 🟠 | Budget parent Verifier 12 tours vs 6 attendus | **FAUX** | `deriveChildThreadBudget` (`thread-delegation.ts:107`) applique un ratio 0,5 : parent 12 ⇒ enfant **6**. Le budget n'est pas divisé par le nombre de délégués. `agent-registry.ts` borne ensuite `maxSteps` par `budget.maxTurns` = 6, pas 12. | Aucun changement. Mutation (parent 12 → 8) ⇒ le test existant rougit sur `maxTurns: 4` : il est bien contraignant. |
| 6 | 🟠 | Test `clamps an oversized maxSteps` non contraignant | **FAUX** | Le juge a confondu deux mocks : celui de ce test (`verifier-delegation.test.ts:102-112`) renvoie un `tool_call` à CHAQUE tour et ne rend jamais de verdict ; la boucle va donc au bout de ses étapes. | Aucun changement. Mutation (clamp retiré) ⇒ rouge : « expected 999 to be less than or equal to 6 ». Le test est le plus contraignant du fichier. |
| 7 | 🟡 | Gates optionnelles devenues bloquantes sur erreur | **FAUX** | `quality-gate-middleware.ts:265-271` rend `action: 'warn'`, et `pipeline.ts:100-105` ne s'arrête que sur `stop`/`compact` : rien ne bloque, ni avant ni après DELEG3. Ce que DELEG3 a supprimé, c'est le FAUX VERT d'avant (`qg-before:388` renvoyait `passed: true` sur exception ⇒ « gates passed — no findings »), interdit par le contrat. | Test d'ancrage ajouté (`warn`, jamais `stop`, jamais « REQUIRED FIXES »). Mutation `stop` ⇒ 4 tests rouges. |
| 8 | 🟡 | Test « budget exhaustion » ne valide pas la concurrence | **VRAI** (sur le test, pas sur le code) | Le test s'appelait « preserves the inherited default concurrency of one » sans jamais mesurer la concurrence. En revanche l'explication du juge est fausse : `state.turns` (`thread-delegation.ts:462`) compte les tours RÉELS du délégué, pas les soumissions. | Assertion manquante ajoutée (`maxActive === 1`) et, surtout, la preuve mobile de la maîtrise de concurrence est apportée par le nouveau test à trois agentId distincts (mutations M2/M3 rouges). |

Bilan : **1 point corrigé dans le code** (n° 2), **2 partiels** (n° 2 et 3), **1 vrai sur un test** (n° 8),
**4 écartés avec preuve** (n° 1, 4, 5, 6) et un mineur écarté (n° 7). Aucun des trois « critiques » du juge
n'était un faux vert réel ; le seul défaut de sûreté trouvé était une frontière de délégation trop permissive.

## Mutations exécutées (preuve que les nouveaux tests mordent)

| Mutation | Effet attendu | Résultat |
|---|---|---|
| M0a — `boundedPositiveInteger(maxSteps, …)` retiré | point 6 rouge | rouge (999 appels LLM réels) |
| M0b — budget parent Verifier 12 → 8 | point 5 rouge | rouge (`maxTurns: 4`) |
| M1 — résultats mappés à l'acceptation | faux vert détecté | 5 tests rouges |
| M2 — plafond dur de concurrence retiré | 3 délégués simultanés | rouge |
| M3 — demande de l'appelant ignorée | `delegateConcurrency: 1` sans effet | rouge |
| M4 — défaut de configuration ramené à 1 | défaut figé | 2 tests rouges (dont un test DELEG3) |
| M5 — revue incomplète rendue `stop` | non-blocage | 4 tests rouges |
| M6 — canal non fermé après dépassement | — | VERT : la garde pré-tour suffit (défense en profondeur) |
| M7 — contrôle de coût post-tour supprimé | — | rouge |
| M8 — les deux gardes de coût retirées | le second tour s'exécute | rouge (« expected 2 to be 1 ») |
| M9 — `stripParentContext` neutralisé (2 variantes) | fuite du parent | rouge |

## Vérifications finales

```text
$ HOME=$PWD/_qa/delegverif/home npx vitest run tests/agent tests/agents tests/commands
Test Files  1 failed | 335 passed (336)
Tests       3 failed | 3944 passed (3947)

$ HOME=$PWD/_qa/delegverif/home npx vitest run tests/security/donnees-personnelles.test.ts
Tests       7 passed (7)

$ npx tsc --noEmit -p .            EXIT_CODE=0
$ npx eslint <4 fichiers touchés> --max-warnings=0   EXIT_CODE=0
$ git diff --check                 EXIT_CODE=0
$ git status --porcelain           (vide)
```

**Échec signalé, PRÉEXISTANT et hors périmètre** : `tests/commands/hermes-commands.test.ts`, 3 tests
(« real local Hermes browser smoke », « real auto … hybrid routing », « safe aggregate … local smoke suite »).
Vérifié en arbre de travail détaché sur le commit de base `957495492`, sans aucune de mes modifications :
les mêmes 3 tests y échouent déjà (48/51). Aucun rapport avec DELEG3 ni avec cette lane.

Le total est de 3 947 tests contre 3 942 annoncés par DELEG3 : les 5 tests ajoutés par cette lane
(1 Verifier, 3 QualityGate, 1 ThreadDelegation). Aucun test supprimé, ignoré ni affaibli.

## Commits

- `c238839d5` — rapport ouvert avant inspection et ligne de coordination réservée.
- `9a48dc582` — **correction** : `stripParentContext` coupe les canaux de conversation du parent avant le Verifier délégué.
- `2ccb971b0` — tests d'ancrage QualityGate (points 1, 3, 7, 8).
- `90df92fcc` — test d'ancrage ThreadDelegation (point 4).

Aucun push. `~/code-buddy` et le vrai `~/.codebuddy` n'ont pas été écrits. Aucune API payante, aucun service,
aucun processus tué. HOME de QA sous `_qa/delegverif/`, ignoré par Git.

## Journal

- 2026-09-04 — ouverture du rapport et réservation de la ligne de coordination, avant lecture du code.
- 2026-09-04 — lecture intégrale de `quality-gate-middleware.ts`, `agent-registry.ts`, `thread-delegation.ts`,
  `thread-task-runner.ts`, `verifier-agent.ts`, `pipeline.ts`, de la version d'avant DELEG3
  (`8976a0c5e~1`) et des trois fichiers de tests concernés.
- 2026-09-04 — huit verdicts rendus, une correction, quatre tests d'ancrage, onze mutations exécutées.
