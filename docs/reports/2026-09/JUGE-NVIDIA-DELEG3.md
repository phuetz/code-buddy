# Revue Adversariale DELEG3

## 🔴 CRITIQUE

### `src/agent/middleware/quality-gate-middleware.ts:369-395`
**Chemin vert malgré délégué qui jette / budget dépassé** — `runGates` utilise `ThreadTaskRunner` mais **n'attend pas** que les délégués terminent avant de mapper les résultats. `Promise.all(gates.map(...runner.submit...))` soumet toutes les tâches puis mappe immédiatement sur `outcomes` ; or `runner.submit` retourne une `Promise<ThreadTaskOutcome>` qui se résout **quand la tâche est acceptée dans la file**, pas quand elle termine. Si un délégué jette ou dépasse son budget *après* la soumission, `outcome.success` peut être `true` (accepté) alors que l'exécution réelle échouera plus tard. Le `eventPump` est `await`é *après* le mapping, donc les événements d'échec arrivent trop tard.

### `src/agent/specialized/agent-registry.ts:292-370`
**Fuite de contexte parent vers le Verifier** — `executeVerifierOnDelegate` passe `task.params.parentHistory` tel quel au délégué (ligne 332 : `...input, params: { ...input.params, ... }`). Le test `verifier-delegation.test.ts:88-90` vérifie que `"parent-history-marker"` n'apparaît pas dans le *premier* tour, mais le Verifier reçoit l'historique complet via `params.parentHistory` et peut l'injecter dans ses propres appels LLM ultérieurs. Aucune sanitization n'est faite.

### `src/agent/middleware/quality-gate-middleware.ts:264-272`
**Régression : concurrence par défaut = 1 au lieu de 2** — `configuredConcurrency` défaut à `MAX_QUALITY_GATE_CONCURRENCY` (2) seulement si `delegateConcurrency` n'est pas fini. Mais le constructeur merge `config.delegateParentBudget` sans merger `delegateConcurrency` (ligne 173-180). Si l'appelant passe `{ delegateParentBudget: {...} }` sans `delegateConcurrency`, `this.config.delegateConcurrency` reste `undefined` → `configuredConcurrency = 2` (OK), **mais** le `runner` reçoit `concurrency: Math.min(2, 2, gates.length)` = 2. Problème : l'ancien chemin séquentiel (`for...of`) est supprimé ; si `delegateConcurrency: 1` est passé explicitement, ça marche, mais le défaut *documenté* "concurrence par défaut" a changé de séquentiel → parallèle sans migration flag.

## 🟠 MAJEUR

### `src/agent/delegation/thread-delegation.ts:476-502`
**Budget coût : vérification *après* le tour, pas pendant** — Le coût est vérifié **une seule fois** à la fin du tour (`turn_completed`). Un délégué qui dépasse `maxCostUsd` *pendant* son exécution (ex. appel LLM coûteux unique) ne sera arrêté qu'au tour suivant. Le test `thread-delegation.test.ts:219-250` ne fait qu'un tour (`sessionCost = 1.25` après un `yield`), donc il passe, mais un délégué multi-tours qui dépasse le budget au tour 1 continuera au tour 2 avant d'être coupé.

### `src/agent/specialized/agent-registry.ts:315-340`
**Budget enfant Verifier : `maxTurns: 12` parent vs `6` attendu** — `VERIFIER_DELEGATION_PARENT_BUDGET.maxTurns = 12` (ligne 51), mais le test attend `delegateBudget.maxTurns === 6` (ligne 58). Le `ThreadTaskRunner` divise le budget parent entre délégués concurrents ; ici un seul délégué Verifier, donc il reçoit 12 tours, pas 6. Le test `clamps an oversized maxSteps request to the reduced child turn budget` (ligne 108) passe parce que `boundedPositiveInteger(999, 12)` = 12, mais l'assertion `llmCalls <= 6` **échouerait** si le délégué utilisait vraiment 12 tours. Le test ne détecte pas la régression car le mock LLM retourne `FINAL VERDICT: CONFIRMED` au tour 2.

### `tests/agents/verifier-delegation.test.ts:108-135`
**Test qui ne rougit sous aucune mutation** — `clamps an oversized maxSteps...` : le mock `llmCall` retourne `tool_calls` avec `task_verify` à **chaque tour**, mais le Verifier s'arrête dès qu'il voit `FINAL VERDICT: CONFIRMED` dans le *contenu* (pas dans l'outil). Le mock retourne ce verdict au tour 2 → `llmCalls = 2` ≤ 6 → test passe. Si on mutait le Verifier pour boucler 12 fois, le mock continuerait à retourner `CONFIRMED` au tour 2 → test toujours vert. Le test ne force **pas** le Verifier à épuiser ses tours.

## 🟡 MINEUR

### `src/agent/middleware/quality-gate-middleware.ts:447-456`
**`runSingleGate` : `incompleteGate` même pour `gate.required = false`** — Ancien code : `passed: !gate.required` (non-requis = passe en cas d'erreur). Nouveau : toujours `passed: false` + `incomplete: true`. Change la sémantique : une gate optionnelle qui plante devient bloquante (warn + findings high). Peut être intentionnel (fail-closed), mais non documenté.

### `tests/agent/middleware/quality-gate-middleware.test.ts:380-410`
**Test "budget exhaustion" ne vérifie pas la concurrence** — `delegateConcurrency: 1` + deux gates même `agentId` → `ThreadTaskRunner` les sérialise. Le test attend `turn budget exhausted` mais le budget parent est `maxTurns: 2` pour *deux* délégués séquentiels → chacun a 1 tour. Le mock `runSingleGate` retourne succès immédiat (0 tour consommé côté délégué). Le test passe par hasard car `ThreadTaskRunner` compte les tours *parent* (soumission), pas les tours réels du délégué.

---

## Résumé par gravité

| Gravité | Fichier:Ligne | Problème |
|---------|---------------|----------|
| 🔴 | `quality-gate-middleware.ts:369` | Mapping résultats avant fin exécution délégués → vert faux |
| 🔴 | `agent-registry.ts:332` | `parentHistory` fuité vers Verifier délégué |
| 🔴 | `quality-gate-middleware.ts:173` | Régression concurrence défaut (séquentiel→parallèle) silencieuse |
| 🟠 | `thread-delegation.ts:485` | Vérification coût post-tour, pas intra-tour |
| 🟠 | `agent-registry.ts:51` | Budget parent Verifier 12 tours vs 6 attendus |
| 🟠 | `verifier-delegation.test.ts:108` | Test `maxSteps` clamp non contraignant (mock trop complaisant) |
| 🟡 | `quality-gate-middleware.ts:450` | Gates optionnelles deviennent bloquantes sur erreur |
| 🟡 | `quality-gate-middleware.test.ts:395` | Test budget exhaustion ne valide pas la concurrence réelle |

--- nvidia/nemotron-3-ultra-550b-a55b via NVIDIA Build : $0.0000 (palier gratuit, ~40 RPM) | 1855 tokens
