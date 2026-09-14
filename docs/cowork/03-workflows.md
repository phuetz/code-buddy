# Workflows visuels

Cowork permet de dessiner un workflow sous forme de DAG (graphe orienté acyclique), puis de l'exécuter en déléguant au cœur de Code Buddy. L'éditeur visuel produit un DAG, un compilateur le traduit dans le format `WorkflowDefinition` du noyau, et un `Orchestrator` singleton l'exécute via un petit pool d'agents.

```
Éditeur visuel (DAG)
   │  @xyflow/react + rc-dock  (cowork/src/renderer/components/workflow_pro/)
   ▼
dag-compiler.compileVisualToCore()            cowork/src/main/workflows/dag-compiler.ts
   │  → CoreWorkflowDefinition { steps: [...] }
   ▼
Orchestrator (singleton)                      src/orchestration/orchestrator.ts (noyau)
   │  pool de 4 slots d'agents → CoworkToolAgent
   ▼
FormalToolRegistry.execute(toolName, input)   src/tools/registry/
```

Le pont central est `cowork/src/main/workflows/workflow-bridge.ts` (classe `WorkflowBridge`). Il assure le CRUD, la persistance, le boot de l'orchestrateur, et l'aiguillage des tâches.

## Stack de l'éditeur (renderer)

| Élément | Détail |
|---|---|
| Rendu du graphe | `@xyflow/react` **12.11.0** (le successeur de React Flow, pas le paquet historique `reactflow`) |
| Disposition des panneaux | `rc-dock` **4.0.0-alpha.2** (alpha — surface dockable encore en évolution) |
| Code | `cowork/src/renderer/components/workflow_pro/editor/` (`ModernWorkflowEditor.tsx`, hooks `useWorkflowState`, `useWorkflowEvents`, layout ELK…) |

L'éditeur émet une définition visuelle (`WorkflowVisualDefinition` : `nodes` + `edges`), envoyée au processus principal via IPC.

## Du DAG visuel aux tâches du noyau

Le compilateur (`dag-compiler.ts`, `compileVisualToCore()`) parcourt le graphe depuis le nœud `start` et produit une liste de `steps`. Chaque type de nœud visuel devient un type de step/tâche du noyau :

| Nœud visuel | Type de tâche émis | Exécuté par |
|---|---|---|
| `tool` | `tool_invoke` | `CoworkToolAgent.runToolInvoke()` → `FormalToolRegistry.execute(toolName, toolInput)` |
| `approval` | `approval_wait` | `CoworkToolAgent.runApprovalWait()` (suspend jusqu'à réponse de l'UI) |
| `setVariable` | `set_variable` | `CoworkToolAgent.runSetVariable()` (évalue une expression / littéral JSON) |
| `condition` | step `conditional` (`trueBranch` / `falseBranch`) | noyau Orchestrator |
| `parallel` | step `parallel` (`branches[]`) | noyau Orchestrator |
| `loop` | step `loop` (`loopBody`) | noyau Orchestrator |
| `batch` | step `batch` (`batchBody`) — **expérimental** | noyau Orchestrator |

Le compilateur **échoue tôt** (`CompilationError`) sur les erreurs de topologie ou de configuration, avant même de démarrer l'orchestrateur, pour donner un message clair au moment de la conception (cf. `WorkflowBridge.run()` dans `workflow-bridge.ts`).

## Exécution : l'Orchestrator et le pool d'agents

`WorkflowBridge.ensureOrchestrator()` (boot paresseux, au premier `run`) :

1. Charge dynamiquement le module noyau `orchestration/orchestrator.js` et instancie **un** `Orchestrator` singleton (`maxAgents: 4`).
2. Remplit le `FormalToolRegistry` via `registerBuiltinTools()` — indispensable car le noyau ne le peuple paresseusement qu'au démarrage d'une session `CodeBuddyAgent`, chemin dont le pont Cowork est indépendant.
3. Enregistre **4 slots d'agents** (`WORKER_POOL_SIZE = 4` : `cowork-tool-runner`, puis `-1`, `-2`, `-3`).

> **Précision importante.** Ce ne sont pas 4 objets agents distincts : c'est **une seule instance `CoworkToolAgent`** exposée derrière 4 slots enregistrés. Le `findAvailableAgent` du noyau alloue une tâche par agent *idle* ; le parallélisme des branches vient donc du **nombre de slots**, pas d'une logique dupliquée. Avec 4 slots, jusqu'à 4 branches parallèles s'exécutent simultanément.

L'aiguillage réel se fait sur l'événement `task_assigned` (`workflow-bridge.ts`, ~lignes 418-482). Le handler lit `task.definition.type` et appelle la bonne méthode :

```ts
if (task.definition.type === 'tool_invoke')      output = await toolAgent.runToolInvoke(task.definition.input);
else if (task.definition.type === 'approval_wait') output = await toolAgent.runApprovalWait(task.definition.input, workflowInstanceId);
else if (task.definition.type === 'set_variable')  output = await toolAgent.runSetVariable(task.definition.input);
// puis orchestrator.completeTask(...) / failTask(...) + émission node_completed / node_failed
```

> Il n'existe **pas** de méthode `CoworkToolAgent.execute()`. Le seul `.execute()` du chemin est `FormalToolRegistry.execute(toolName, toolInput)`, appelé *à l'intérieur* de `runToolInvoke()`.

Chaque étape émet vers le renderer des événements de cycle de vie (`workflow.event` : `node_started`, `node_completed`, `node_failed`, `started`, `completed`, `failed`) pour animer le graphe en temps réel.

## Portes d'approbation (approval gates)

Un nœud `approval` compile vers une tâche `approval_wait`. À l'exécution, `runApprovalWait()` :

1. émet `workflow.approval_required` vers le renderer (avec `approvalId`, `workflowInstanceId`, `stepId`, message, `expiresAt`, et un éventuel aperçu de l'action),
2. **suspend** la tâche dans une `Promise`,
3. attend que l'UI réponde via le canal IPC `workflow.approve({ approvalId, workflowInstanceId, stepId, approved })`, relayé à `WorkflowBridge.approveStep()` → `CoworkToolAgent.resolveApproval()`.

Chaque demande reçoit un `approvalId` unique, y compris lors d'une nouvelle occurrence dans une boucle. Le moteur vérifie les trois identifiants et exige un booléen `approved` : une réponse périmée, dupliquée ou utilisant l'ancienne signature est refusée. La fin du run annule ses attentes et retire uniquement ses demandes du renderer, sans les approuver automatiquement.

Délai par défaut : **60 s**. En l'absence de réponse, la tâche est **auto-rejetée** (timeout → `failTask`), ce qui fait échouer le workflow.

## Deux bugs corrigés (mécanique de l'Orchestrator)

Le noyau `Orchestrator` n'a pas été conçu pour ce mode de pilotage externe ; deux pièges réels ont été corrigés dans `workflow-bridge.ts`.

**1. Deadlock de `processQueue` (premier task jamais drainé).**
Le noyau ne déclenche `processQueue()` que depuis `start()`, `completeTask()` et `failTask()`. Sans intervention, la toute première tâche d'un workflow resterait à jamais dans la file (le `waitForTask` interne sonde mais ne la voit jamais assignée). Correctif :

```ts
orchestrator.on('task_created', () => {
  queueMicrotask(() => orchestrator.processQueue());
});
```

Le `queueMicrotask` est **load-bearing** : `task_created` est émis *synchronement avant* que `queueTask()` ait poussé la tâche dans la file ; le report en microtâche garantit qu'on draine **après** le push.

**2. Ordre des listeners sur `workflow_started`.**
L'`instanceId` est généré par l'orchestrateur, mais les événements de cycle de vie doivent être tagués avec le `workflowId` persistant. On installe le handler de capture avec `prependListener` **avant** d'appeler `startWorkflow`, donc **avant** l'émetteur global :

```ts
this.orchestrator.prependListener('workflow_started', captureHandler); // peuple instanceToWorkflowId
const instance = await this.orchestrator.startWorkflow(coreDef, initialContext);
```

Sans le `prependListener`, le premier `workflow_started` partirait avec un `workflowId` vide (la map `instanceToWorkflowId` n'étant pas encore peuplée).

## Persistance

Les définitions de workflows sont stockées en JSON dans :

```
<userData>/workflows/workflows.json
```

(`app.getPath('userData')` côté Electron). `WorkflowBridge` gère un cache en mémoire et réécrit le fichier à chaque `create` / `update` / `delete`. Un fichier illisible est traité comme une liste vide (dégradation gracieuse, pas de crash).

## Surface IPC

Deux surfaces IPC distinctes coexistent — ne pas les confondre :

| Canal | Cible | Rôle |
|---|---|---|
| `workflow.list` / `get` / `create` / `update` / `delete` | `WorkflowBridge` | CRUD des définitions |
| `workflow.run` | `WorkflowBridge.run()` | Compile + exécute un workflow par `id` |
| `workflow.approve` | `WorkflowBridge.approveStep()` | Répond à une porte d'approbation |
| `tools.list` | `FormalToolRegistry` | Catalogue des outils pour le dropdown du nœud `tool` |
| `workflow.start` / `stop` / `status` | `WorkflowService` (**séparé**, sans rapport avec le pont) | Service distinct — ne relève pas de l'exécution de DAG |

## Solide vs expérimental

**Solide :**

- Nœuds `tool`, `approval`, `setVariable`, `loop`, et structurels `condition` / `parallel`.
- Pipeline compile → Orchestrator → `FormalToolRegistry`, avec émission temps réel des événements de nœud.
- Persistance JSON et CRUD.

**Limites et points expérimentaux (à connaître) :**

- **Une seule exécution concurrente (V1).** `currentRun` est singulier ; le handler de capture suppose que « le premier `workflow_started` après notre appel est le nôtre ». Il n'existe pas de map durable `workflowId ↔ instanceId` pour plusieurs runs simultanés.
- **Compilateur V0.5** (`dag-compiler.ts`). Topologies contraintes :
  - les branches d'un `parallel` / `condition` doivent **toutes converger sur un même nœud de jointure** ou **toutes atteindre `end`** (sinon `CompilationError`) ;
  - un nœud `condition` exige des arêtes sortantes étiquetées `'true'` et `'false'` ;
  - un nœud `loop` exige des arêtes `'body'` et `'exit'`, et son corps doit être une **chaîne linéaire acyclique** (pas de re-bouclage visuel ni de structure parallèle/condition rentrant dans le même corps).
- **`maxIterations` (loop) n'est pas réellement appliqué.** Le type de step du noyau ne le porte pas : la valeur est seulement ajoutée au `name` de l'étape à titre de traçabilité. Le noyau impose un **plafond dur de 100 itérations**. C'est un paramètre qui « a l'air configurable » mais ne l'est pas.
- **Nœud `batch` expérimental.** Compilé via des casts `as any` (champs `batchItemsExpression` / `batchVariableName` / `batchBody`) ; moins éprouvé que `tool` / `approval` / `loop`.
- **`rc-dock` en `4.0.0-alpha.2`** : surface de docking encore en alpha.

## Fichiers source

- `cowork/src/main/workflows/workflow-bridge.ts` — pont CRUD + exécution (orchestrateur, pool, aiguillage `task_assigned`, persistance).
- `cowork/src/main/workflows/dag-compiler.ts` — compilation DAG visuel → `CoreWorkflowDefinition`.
- `cowork/src/main/workflows/cowork-tool-agent.ts` — `runToolInvoke` / `runApprovalWait` / `runSetVariable`.
- `src/orchestration/orchestrator.ts` — moteur d'orchestration du noyau Code Buddy.
- `cowork/src/renderer/components/workflow_pro/` — éditeur visuel (`@xyflow/react` + `rc-dock`).
