# Journal — Ministar Ubuntu, séance grok-cli

Suffix `-grok-cli` pour continuité topic avec `ministar-grok-cli.md`
(MINISTAR Windows). Le hostname Ubuntu réutilise `Ministar` → suffixe
`-ubuntu` pour distinguer (cf. `journal/README.md`).

## 2026-05-09 ~10h — Audit Cowork Bloc 2 : 5 composants live/mock

Brief reçu de Claude Opus 4.7 (MINISTAR Windows / grok-cli) dans
`ministar-grok-cli.md` entry 2026-05-09 ~09h. Méthode : lecture statique
du composant React + chemin IPC (preload) + handler/bridge côté main,
pour conclure live/mock par `file:line`. Budget conservatif (67 % hebdo
utilisé) → Ollama dispo localement mais pas mobilisé : la lecture
statique a tranché chaque cas sans ambigüité.

Repo cloné dans `/home/patrice/DEV/code-buddy/`, HEAD =
`dffee6a fix(chatgpt): add connect + idle timeouts to Responses provider`
(commit du matin de l'autre Claude). `npm install` = 1509 paquets
(68 vulns reportées par npm audit, hors scope du Bloc 2). Régression
ChatGPT Responses validée à part : `npx vitest run
tests/codebuddy/providers/provider-chatgpt-responses.test.ts` →
**40/40 pass**.

### 1. `ComputerUseOverlay.tsx` — **LIVE** ✅

Chaîne IPC complète, screenshots inclus :

- `cowork/src/main/engine/codebuddy-engine-runner.ts:241-250` — détection
  d'un tool `gui_operate` (`isGuiOperateTool`) → `emitGuiActionEvent(...)`.
- `cowork/src/main/engine/codebuddy-engine-runner.ts:535-571` —
  `emitGuiActionEvent` construit le payload (`action`, `screenshot` extrait
  de `event.tool.data` via `extractScreenshotFromData`, `click {x,y}`,
  `details`, `timestamp`) et `sendToRenderer({ type: 'gui.action', payload })`.
- `cowork/src/renderer/hooks/useIPC.ts:441-444` — réception côté
  renderer → `store.appendGuiAction(event.payload)`.
- `cowork/src/renderer/store/index.ts:1080-1085` — append + auto-open
  (`showComputerUseOverlay: true`).
- `cowork/src/renderer/components/ComputerUseOverlay.tsx:33-46` — lit
  `guiActions` du store, filtre par `activeSessionId`, autoplay au
  dernier step.

**Aucun mock en chemin.** Le bouton STOP (ligne 113-125) appelle
`useIPC.stopSession(activeSessionId)` qui passe par
`window.electronAPI.send({ type: 'session.stop', ... })` (cf.
`useIPC.ts:450`). Wired bout-en-bout.

### 2. `WorkflowEditor.tsx` — **PARTIELLEMENT LIVE** ⚠️

IPC + bridge live, mais sémantique d'exécution = noop côté engine.

Chaîne save/run :
- `cowork/src/renderer/components/settings/SettingsWorkflows.tsx:21,138`
  monte le composant et fournit `onSave`/`onRun`.
- Save : `api.workflow.create|update` → `cowork/src/preload/index.ts:1077-1079`
  → `cowork/src/main/index.ts:2789-2818` → `WorkflowBridge.create/update`
  (persistance JSON locale OK).
- Run : `api.workflow.run(id, {})` → `preload:1091` → `main/index.ts:2825-2839`
  → `WorkflowBridge.run` (`cowork/src/main/workflows/workflow-bridge.ts:130-208`).
- `WorkflowBridge.run` charge dynamiquement `workflows/workflow-engine.js`
  depuis le **core** code-buddy et appelle `engine.startWorkflow`. C'est
  un vrai engine, pas un mock.

**Mais** la conversion visual → engine est dégradée :
- `workflow-bridge.ts:178-185` — pour chaque node :
  - `start`/`end` filtrés (OK)
  - `tool` → `action: 'noop'`
  - `condition`/`parallel`/`approval` → `action: node.type` (mais le
    StepManager du core n'a registered que `'log'`, `'delay'`,
    `'setVariable'`, `'conditional'`, `'noop'` — cf.
    `src/workflows/step-manager.ts:22-53`. Donc `condition` (≠
    `conditional`), `parallel`, `approval` lèvent
    `throw new Error('Unknown action: ${step.action}')` à
    `src/workflows/step-manager.ts:108-110`).
- **Les edges du DAG visuel ne sont jamais transmis à l'engine** —
  `engine.registerWorkflow` ne reçoit que `steps[]` plat.
- Et surtout : le core `WorkflowEngine.startWorkflow` lui-même est un
  **itérator séquentiel pur** (`src/workflows/workflow-engine.ts:221`,
  `for (; stepIndex < workflow.steps.length; stepIndex++)`) — il ne
  consulte aucune notion d'edges, de transitions, de parallel, ni de
  routing conditionnel. Même si le bridge passait les edges, le core
  ne saurait pas quoi en faire.

**Conclusion** : éditeur ergonomique, sauvegarde JSON OK, déclenchement
engine OK ; mais `Run` exécute des noops (pour les tool nodes) et
échoue silencieusement (pour les autres types). La topologie graphique
est cosmétique côté exécution. C'est un **stub semi-câblé**.

### 3. `SubAgentPanel.tsx` — **LIVE STREAM** ✅

Émetteurs côté main (deux bridges, preuve que c'est utilisé en vrai) :
- `cowork/src/main/agent/sub-agent-bridge.ts:141 (status), :161
  (completed), :212 (spawned)` — émis depuis le sub-agent runtime
  (CodeBuddy core agent → cowork ServerEvents).
- `cowork/src/main/agent/orchestrator-bridge.ts:145 (spawned), :155
  (completed), :170 (status)` — second émetteur depuis l'orchestrator
  multi-agent (`OrchestratorLauncher`).

Réception :
- `cowork/src/renderer/hooks/useIPC.ts:368-389` — handlers
  `subagent.spawned/status/completed/output` → mutent le store.
- `cowork/src/renderer/store/index.ts:267,635,1262-1283,1378` — slice
  `subAgents: Record<sessionId, SubAgent[]>` + `subAgentOutputs`.
- `selectors.ts:420 useActiveSessionSubAgents` et `:428 useSubAgentOutput`
  branchés sur le store.

Le composant lui-même (`SubAgentPanel.tsx:316,63`) consomme ces
selectors. Mode `graph` recalcule layout via `useMemo([agents])` à
chaque update. **Stream temps réel**, pas snapshot.

### 4. `SettingsA2AAgents.tsx` — **LIVE (HTTP réel)** ✅

Mais attention au cadre : c'est le protocole **Google A2A** externe,
pas le fleet code-buddy `peer_delegate`/`list_peers`. Deux systèmes
distincts.

- Preload : `cowork/src/preload/index.ts:1179-1241` — méthodes
  `list/discover/add/remove/ping/invoke/cancelTask/listTasks`.
- Handlers : `cowork/src/main/index.ts:2937-3003` — chacun délègue à
  `getA2ABridge()`.
- Bridge : `cowork/src/main/a2a/a2a-bridge.ts` :
  - `:167-168` — `discover` = `fetch(<base>/.well-known/agent.json)` réel
  - `:258` — `invoke` = `POST /tasks/send` réel
  - `:310` — `cancelTask` = `POST /tasks/<taskId>/cancel` réel
  - `:351,:397` — polling task status via `fetch + ReadableStream`
    (SSE-style côté main process, pas EventSource navigateur)
- Tâches actives : `useAppStore((s) => s.a2aTasks)` mises à jour par
  les events bridge → store. UI bouton Cancel/Clear branché sur
  `cancelTask`/`removeA2ATask`.

**Tout est live HTTP**. Aucun fixture. Pour la confusion potentielle
"vrais peers du fleet" du brief : ce composant ne touche **pas** le
FleetRegistry/FleetListener du fleet code-buddy (d.17→d.20). Si l'on
veut l'UI fleet code-buddy peer-to-peer, c'est ailleurs (`/fleet send`,
`peer_delegate` côté core, pas dans `SettingsA2AAgents`).

### 5. `SettingsHooks.tsx` — **LIVE pour command, MOCK assumé pour le reste** ⚠️

- Preload : `cowork/src/preload/index.ts:1340-1375` — `list/upsert/remove/test`.
- Handler test : `cowork/src/main/index.ts:3078-3092` →
  `getHooksBridge().test(handler)`.
- Bridge : `cowork/src/main/hooks/hooks-bridge.ts:197-280` :
  - `type === 'command'` → `spawn(shell, [shellFlag, handler.command],
    { cwd: workspaceDir, env: CODEBUDDY_HOOK_DRY_RUN=1 })` réel, capture
    stdout/stderr/exitCode/durationMs, timeout configurable. **Live**.
  - `type` ∈ `'http'|'prompt'|'agent'` → retourne `success: true,
    exitCode: 0, ...` no-op (lignes 198-206). **Mock assumé**, le
    commentaire de tête (ligne 192-196) le dit explicitement : "HTTP/
    prompt/agent handlers are not executed — they return a no-op success
    so authors can still save them without triggering side effects from
    the editor."

L'UI n'affiche pas non plus le bouton Test pour ces 3 types (ligne 373
filtre `draft.type === 'command'`). Le bouton Save (`hooks.upsert`)
fonctionne pour tous les types (persistance dans `.codebuddy/hooks.json`
gérée par le bridge). Donc dry-run = command-only, intentionnel.

### Synthèse

| # | Composant                | Verdict                         |
|---|---------------------------|---------------------------------|
| 1 | ComputerUseOverlay        | **LIVE**                        |
| 2 | WorkflowEditor            | **partiel** : IPC live, run = noop, edges perdus |
| 3 | SubAgentPanel             | **LIVE STREAM**                 |
| 4 | SettingsA2AAgents (Google A2A) | **LIVE** (HTTP réel)       |
| 5 | SettingsHooks (dry-run)   | **LIVE command**, mock HTTP/prompt/agent (assumé) |

Le seul cas où il y a **vraiment** un manque fonctionnel = #2 :
WorkflowEditor produit des DAG visuels qui sont bien sauvegardés JSON
mais dont l'exécution est noop. C'est un candidat naturel pour V0.6
ou follow-up (mapper `tool` node → vraie invocation tool, parser les
edges en graphe d'exécution séquentielle/parallèle).

Les autres "soupçons" du brief ne tiennent pas après lecture : 1, 3, 4,
5 sont câblés au niveau attendu pour leur usage actuel.

### Pas explorée

- **Build Electron** (`npm run build:gui` + `buddy install-gui` +
  `buddy gui`) non lancé — la lecture statique a suffi pour conclure
  live/mock par composant. Ollama est prêt à 127.0.0.1:11434 si une
  itération ultérieure veut un E2E `buddy gui` avec un agent local
  (ferait sens pour observer le flux `gui.action` en mouvement, pas
  pour conclure le verdict d'audit).
- **Vitest full** non lancé (~26K tests, hors scope du brief).
- **Réconciliation `feat/face-memory-cowork` ↔ `feat/cowork-presence-d21`**
  rappelée par le brief comme reste — pas touchée ici, c'est un autre
  axe (cherry-pick V0.5/V0.6/OrchestratorLauncher).

### Reste pour la prochaine session

1. **WorkflowEditor exécution** : décider si on câble réellement (mapper
   tool nodes → tool invocation, traverser le DAG en respectant edges)
   ou si on accepte le statu quo "design-only" et on documente.
   Scoping révisé : le core `WorkflowEngine` ne supporte pas la topologie
   (séquentiel pur). Donc câbler "vraiment" implique soit :
   (a) étendre le core engine pour parser des edges/branches/parallel
       — refonte non-triviale, plusieurs sessions ;
   (b) interpréter le DAG côté bridge cowork (topo-sort + invocations
       séquentielles dans l'ordre du graphe, sans vrai parallèle ni
       branchement) — 2-3h pour la version dégradée ;
   (c) acquérir un vrai DAG runner (ex. inferer depuis un autre projet,
       ou wrapper temporal/airflow-like) — change architecture.
   À discuter avec Patrice. Originellement annoncé "1-2h" — révisé.
2. **Désambigüation A2A vs fleet** : si la vision Cowork "computer-use
   multi-agent OpenClaw" prévoit que la SettingsA2AAgents UI puisse
   aussi piloter le fleet code-buddy (peer_delegate cross-host), ajouter
   un onglet "Fleet peers" séparé câblé sur `FleetRegistry`. Sinon
   garder les deux systèmes distincts est sain.
3. **Hooks dry-run pour HTTP** : potentiellement utile (POST avec body
   factice et `CODEBUDDY_HOOK_DRY_RUN=1` côté serveur). Bas risque,
   mais pas dans la vision Cowork — peut attendre.
4. **Fix `condition`/`conditional` mismatch** dans
   `workflow-bridge.ts:183` : `node.type === 'condition'` mais le
   StepManager attend `'conditional'`. Trivial à corriger, mais
   forcément lié au point 1 (sans exécution réelle, c'est cosmétique).

### Blockers

Aucun. La machine Linux est prête (Ollama OK, espace OK). Le
`npm install` initial a affiché 68 vulnérabilités npm — bruit habituel,
non-blocker pour l'audit.

### Discipline

Entrée écrite **après** l'audit en bloc, pas au fil. Note pour
prochaine session multi-IA, comme grok-cli s'en est repenti dans son
entry du 8 mai.

— Claude Opus 4.7 (1M context), Ministar Linux / DEV (audit code-buddy
Bloc 2), 9 mai 2026 ~10h

## 2026-05-09 ~12h — Implémentation WorkflowEditor V1 + 2 bugs runtime fixés

Faisant suite au gap #2 identifié par l'audit Bloc 2 (WorkflowEditor :
DAG visuel sauvé en JSON mais exécution = noop côté engine). Plan
discuté avec Patrice : scope **Full** (tool + condition + parallel +
approval), UI enrichie dans la même tâche, stratégie **wrapper
`Orchestrator` core** plutôt qu'étendre le séquentiel `WorkflowEngine`.

### Pipeline livré

```
visual DAG (nodes + edges)
  └─ workflow-bridge.ts                 persist → <userData>/workflows.json
       └─ dag-compiler.ts               topo + branches → core WorkflowDefinition
            └─ Orchestrator.startWorkflow()
                 └─ task_assigned (cowork-tool-runner pool of 4)
                      ├─ runToolInvoke()    → FormalToolRegistry.execute()
                      └─ runApprovalWait()  → IPC promise + workflow.approve
                 └─ workflow.event / workflow.approval_required → renderer store
```

### Branche `feat/workflow-execution` (6 commits)

- `776eb645` feat(cowork-workflows): visual DAG compiler + tool/approval agent
- `5c5f499a` feat(cowork-workflows): wrap core Orchestrator in WorkflowBridge
- `7966a6c4` feat(cowork-workflows): IPC + renderer store for live execution events
- `bf053182` feat(cowork-workflows): UI inspector configs + approval dialog + live status
- `c51c1dcf` test(cowork-workflows): 21 cases — compilation, agent, integration
- `9f67e4a0` docs(cowork-workflows): README — pipeline + node types + V1 limits

Files clés :

| Type | Fichier |
|---|---|
| nouveau | `cowork/src/shared/workflow-types.ts` (~140 LOC) |
| nouveau | `cowork/src/main/workflows/dag-compiler.ts` (~280) |
| nouveau | `cowork/src/main/workflows/cowork-tool-agent.ts` (~180) |
| réécrit | `cowork/src/main/workflows/workflow-bridge.ts` (~440 LOC) |
| nouveau | `cowork/src/renderer/components/ApprovalDialog.tsx` (~95) |
| nouveau | `cowork/src/main/workflows/README.md` |
| patch | `cowork/src/main/index.ts` (IPC `workflow.approve` + sendToRenderer wire) |
| patch | `cowork/src/preload/index.ts` (`workflow.approve`) |
| patch | `cowork/src/renderer/types/index.ts` (2 ServerEvent) |
| patch | `cowork/src/renderer/hooks/useIPC.ts` (handlers) |
| patch | `cowork/src/renderer/store/index.ts` (`workflowExecutions` + `pendingApprovals` slices) |
| patch | `cowork/src/renderer/components/WorkflowEditor.tsx` (Inspector configs + statut runtime) |
| patch | `cowork/src/renderer/App.tsx` (mount ApprovalDialog) |
| nouveau | `cowork/tests/workflow-bridge-compilation.test.ts` (9 cas) |
| nouveau | `cowork/tests/cowork-tool-agent.test.ts` (8 cas) |
| nouveau | `cowork/tests/workflow-bridge-integration.test.ts` (4 cas vrai Orchestrator) |

### 2 bugs runtime trouvés par advisor pass et fixés

1. **Deadlock orchestrator** : la classe core `Orchestrator` n'appelle
   `processQueue()` que depuis `start()`/`completeTask()`/`failTask()`.
   `queueTask()` ne le déclenche pas — donc la première task d'un
   workflow restait en queue jusqu'au timeout 5min de `waitForTask`.
   Fix : listener `task_created` qui appelle `queueMicrotask(() =>
   orchestrator.processQueue())`. Le `queueMicrotask` est essentiel —
   `task_created` fire synchronement *avant* `queueTask`, donc on doit
   différer pour que la task soit dans la queue avant qu'on demande à
   processer.

2. **`workflowId` vide sur le premier event** : ordre des listeners.
   Le listener global `workflow_started` était enregistré au boot
   (`ensureOrchestrator`) et lisait `instanceToWorkflowId.get(...)` —
   mais à ce moment-là le mapping n'était pas encore set car le
   captureHandler run-scoped dans `run()` était registered APRÈS.
   Fix : `prependListener` pour le captureHandler dans `run()` —
   garantit qu'il run avant le global, donc le mapping est populé
   quand le global lit.

Les 2 bugs ne déclenchent ni en typecheck ni dans les tests
unitaires (compiler ou agent isolé). Test d'intégration ajouté qui
boot un vrai `Orchestrator` core + stub registry et exécute un
workflow E2E — couvre les 2 bugs.

### Validation

- ✅ `npx tsc --noEmit` cowork : clean.
- ✅ **21/21 tests** : 9 compilation + 8 agent + 4 intégration.
- ⚠️ Smoke E2E GUI **non lancé** — le full `npm run build` cowork
  enchaîne `download:node`, `build:wsl-agent`, `build:lima-agent`,
  `prepare:python:all`, `prepare:gui-tools`, `build:tray-icon`, `tsc`,
  `vite build`, `electron-builder` → 5-10min minimum, mauvais ROI vu
  le budget Claude hebdo (67% déjà utilisé). Les tests d'intégration
  couvrent la chaîne main process bout-en-bout (Orchestrator + bridge
  + agent + approval lifecycle), seule la layer IPC renderer↔main
  Electron n'est pas testée en GUI réelle. Reportée à un test manuel
  de Patrice ou à une session ultérieure.

### Limitations V1 (documentées dans README)

- `parallel` et `condition` sont des "leaves" du main chain. Pas de
  convergence avant `end` (V0.5).
- `condition` requiert 2 outgoing edges labellisés `'true'`/`'false'`.
- `safeEvalCondition` du core impose une whitelist d'opérateurs.
- 1 workflow à la fois (single-tenant V1, mapping instanceId↔workflowId
  scope par run actif).
- Tool node config = JSON brut, validation à l'invocation.
- Approval timeout = hard fail.

### Reste pour cette session (Phase 2 + V0.5 + Hooks HTTP)

Plan validé : 4 axes restants à attaquer :
- **Réconciliation `feat/face-memory-cowork`** — 4 commits orphelins
  dont 2 méritent cherry-pick (channel-A2A + Buffalo_S scripts), 2
  abandonnés (docs + wiring déjà fait par D21).
- **V0.5 WorkflowEditor** — loop nodes + convergence post-parallel.
- **Hooks HTTP dry-run** — combler le mock de `hooks-bridge.ts:198-206`.

— Claude Opus 4.7 (1M context), Ministar Linux / DEV, 9 mai 2026 ~12h

## 2026-05-09 ~13h — Phase 2 : V0.5 + Hooks HTTP + réconciliation face-memory

Suite de la Phase 1 (WorkflowEditor V1 livré sur `feat/workflow-execution`).
Cette session a attaqué les 3 axes restants identifiés par l'audit + le
plan « Phase 2 post-impl ». Tout exécuté en ~1h30.

### Axe 2 — Réconciliation `feat/face-memory-cowork` (sur `main`)

Découverte clé : seul `face-memory-cowork` (4 commits orphelins) restait
à traiter. Les 3 autres branches (`cowork-presence-d21`,
`wake-dormant-d21`, `chatgpt-polish-d25`) sont **déjà mergées dans
main** — vérifié par `git merge-base --is-ancestor`.

Sur les 4 commits orphelins :
- **GARDÉS** (cherry-pick sur `main`) :
  - `f3b9b984` (ex-`29de151b`) `feat(server): channel-A2A bridge` —
    `src/server/channel-a2a-bridge.ts` (220 LOC) + 9 tests verts.
  - `15e1e9f8` (ex-`96db314b`) `feat(presence): one-click Buffalo_S
    downloader` — scripts `cowork/scripts/download-buffalo-s.{ps1,sh}`,
    README mergé manuellement (3 paths : in-app dialog + CLI scripts +
    file picker, avec install path cross-platform commun).
- **ABANDONNÉS** :
  - `fbbaecfb` README cleanup — trivial, obsolète après le merge ci-dessus.
  - `3489b0ec` App.tsx + Titlebar wiring — déjà fait par D21 dans `main`.

Pushé sur `main` (`dffee6aa..15e1e9f8`).

### Axe 3 — V0.5 WorkflowEditor (sur `feat/workflow-execution`, commit `2dd2d987`)

Deux features V0.5 qui débloquent les workflows réels :

**Loop nodes**. Nouveau `WorkflowNodeType = 'loop'`. L'éditeur trace
2 edges `'body'` / `'exit'`. Le compiler produit un `WorkflowStep` de
type `'loop'` avec `loopCondition` + `loopBody` (chaîne linéaire) et
exit comme `continueFrom`. Découverte du *one-tick lag* dans le core
engine : `context.iteration` est mis à jour DANS le body, donc une
condition `iteration < N` exécute le body N+1 fois si on seed
`iteration: 0` en initialContext. Documenté dans le test
d'intégration ; on utilise `iteration < 2` pour 3 itérations exactes.

**Convergence**. `parallel` et `condition` peuvent maintenant se rejoindre
sur un nœud commun (« join ») avant de continuer le main chain. Algo
`findJoinTarget` walks chaque branche en avant, repère le 1er node
avec `incoming.length > 1` (= join) ou `end`. Toutes les branches
doivent converger sur le *même* join (ou toutes finir en `end`),
sinon `CompilationError` "branches converge on different nodes".

Refactor : `compileSingle` retourne désormais `CompiledStep`
(`{ step, continueFrom?: Node | null }`). Sémantique :
- `undefined` → fallback sur l'edge classique (tool/approval)
- `null` → fin de main chain (parallel/condition avec branches → end)
- `Node` → continuation explicite (loop exit, parallel/condition join)

15 tests compilation (V1: 9 + V0.5: 6) + 6 tests intégration
(V1: 4 + V0.5: 2) = **21 tests workflow verts**.

### Axe 4 — Hooks HTTP dry-run (commit `bbe7a5f5`)

Comble le mock de `hooks-bridge.ts:198-206` pour le type `'http'` (les
types `prompt`/`agent` restent mockés — ils impliquent un round-trip
LLM, hors scope d'un test d'authoring).

`testHttpHandler` : POST réel avec body `{ tool, event, dryRun: true,
cwd }`, header `X-CodeBuddy-Hook-DryRun: 1`, AbortController +
timeout, body capé à 64 KB, headers user forwardés (ex. authorization).

`SettingsHooks.tsx` : le bouton **Test** apparaît maintenant pour
`command` ET `http` (était command-only). Disabled gating mis à jour.

5 tests : 200, 404, timeout, invalid URL, custom headers — tous verts
(globalThis.fetch stubbé pour pas hit le réseau).

### État final feat/workflow-execution

8 commits :
- `776eb645` types/compiler/agent
- `5c5f499a` bridge wrapper Orchestrator
- `7966a6c4` IPC + store
- `bf053182` UI Inspector + ApprovalDialog
- `c51c1dcf` tests V1 (21)
- `9f67e4a0` doc README
- `2dd2d987` V0.5 loop + convergence
- `bbe7a5f5` Hooks HTTP dry-run

**26 tests verts** au total (21 workflow + 5 hooks HTTP).
Typecheck propre (root + cowork).

### État `main`

`origin/main` à jour avec 2 cherry-picks de Phase 2 :
- `f3b9b984 feat(server): channel-A2A bridge`
- `15e1e9f8 feat(presence): one-click Buffalo_S downloader`

### Reste pour Patrice

1. **PR review** — la branche `feat/workflow-execution` (8 commits)
   est prête : https://github.com/phuetz/code-buddy/pull/new/feat/workflow-execution
2. **Smoke E2E GUI** — toujours non lancé (build cowork complet =
   5-10min de pré-steps lourds : download:node, build:wsl-agent, …).
   Si tu veux un test live, je peux le lancer dans une session dédiée
   avec budget alloué exprès. Sinon les 6 tests d'intégration
   (qui boot un *vrai* Orchestrator core) couvrent la chaîne main
   process bout-en-bout.
3. **`feat/face-memory-cowork` peut être supprimée du remote** —
   tous ses commits utiles sont mergés (D21 + 2 cherry-picks).
   Commande : `git push origin --delete feat/face-memory-cowork`
   (à ta discrétion ; je n'efface pas sans OK explicit).
4. **Hors scope ce soir** (V1.x backlog) :
   - Smoke E2E GUI manuel.
   - Sécurité réseau Ministar phase 2 (`secure_network.sh`, CLAUDE.md TODO #3).
   - Lemonade Server / NPU XDNA (CLAUDE.md TODO #2 — bloqué par bug HSA gfx1150 upstream).

### Discipline

Cette entrée arrive en milieu de session, après chaque axe (au lieu
de en bloc final comme la précédente). Mieux. Coût budget Claude
hebdo : ~10-15% de plus consommé sur cette session, total approchant
80% pour la semaine — penser au reset lundi.

— Claude Opus 4.7 (1M context), Ministar Linux / DEV, 9 mai 2026 ~13h

## 2026-05-09 ~14h — E2E réel + V0.6 + ai-providers inline + diagnostic Ollama

Phase 1 (smoke E2E GUI Cowork) **livrée pour de vrai cette fois** —
build cowork via `vite build` (le full `npm run build` foire sur
`prepare:python:all` HTTP 504 GitHub API mais on n'en a pas besoin),
Electron lancé sur DISPLAY=:10.0 avec `--no-sandbox` (suid sandbox
non configuré) + `--remote-debugging-port=9222`, test injecté via CDP
WebSocket en CommonJS Node.

### 3 bugs runtime trouvés par le E2E réel

1. **Symlink `@phuetz/ai-providers` dangling** — le `node_modules`
   pointait vers `/home/patrice/DEV/ai-providers/` qui n'existait pas
   sur Ministar Linux (workspace setup local jamais cloné ici). 3
   fichiers du core import dessus (`utils/retry.ts`,
   `providers/types.ts`, `providers/base-provider.ts` doc), donc
   `loadCoreModule('tools/registry/index.js')` échouait silencieusement
   et le WorkflowBridge tombait en "Orchestrator unavailable".
   - **Fix court** : clone du repo + `npm run build`.
   - **Fix permanent** : commit `5757b197` — inline le contenu (52K, 0
     deps) dans `src/providers/_shared/`, retire la dep workspace.

2. **`FormalToolRegistry` vide côté Cowork** — `getFormalToolRegistry()`
   retourne le singleton mais le seul registrar est `ToolHandler.
   initializeRegistry()` (`src/agent/tool-handler.ts:174`), instancié
   uniquement par `CodeBuddyAgent` au boot d'une session. Le
   WorkflowBridge tournant indépendamment, le registry restait vide.
   - **Fix** : commit `6c5e39f6` — `registerBuiltinTools(registry)`
     ajouté à `src/tools/registry/index.ts` + appelé depuis
     `WorkflowBridge.ensureOrchestrator()`. 111 tools enregistrés au
     boot.

3. **Cowork build chain Linux-hostile** — `npm run build` enchaîne
   `download:node` + `build:wsl-agent` + `build:lima-agent` +
   `prepare:python:all` (HTTP 504 sur l'API GitHub depuis Ministar) +
   `prepare:gui-tools` (macOS-only, skipped) + `build:tray-icon` +
   `tsc` + `vite build` + `electron-builder`. Pour un E2E renderer↔main,
   `vite build` seul suffit (le plugin electron-vite construit le
   bundle main + preload). À documenter pour la prochaine fois.

### Smoke E2E v2 — 7/7 verts via CDP

Avec `shell_exec` et `list_directory` (les vrais noms canoniques —
pas `bash_run` que j'avais inventé) :

| Workflow | Result |
|---|---|
| linéaire (shell_exec echo hello) | ✅ |
| parallel (2 list_directory concurrent) | ✅ |
| conditional (true branch) | ✅ |
| approval (renderer→main→resume, approved=true) | ✅ |
| loop V0.5 (3 iter avec iteration<2 + lag) | ✅ |
| convergence V0.5 (parallel-join-tool) | ✅ |
| Hooks HTTP dry-run | 405 capté propre (endpoint health attend GET) |

Toute la chaîne electronAPI → preload → main IPC → WorkflowBridge →
Orchestrator → CoworkToolAgent → FormalToolRegistry → real tool
exécution + workflow.event events → renderer store, **validée en
runtime Electron**.

### Phase 2 — Cleanup git + release rc.7

- Branches remote supprimées : `feat/face-memory-cowork`,
  `feat/workflow-execution`.
- `cowork/package.json` bumped `1.0.0-rc.6` → `1.0.0-rc.7`.
- CHANGELOG entry `[1.0.0-rc.7]` rédigée (3 axes principaux + tests).
- **Pas de tag** : `release.yml` trigger sur `v*` et publierait le
  *root* `@phuetz/code-buddy`, pas Cowork. À tag manuellement quand
  Cowork doit être releasé séparément (ou narrow le trigger à
  `v*-cowork`).

### Phase 3 — V0.6 WorkflowEditor + Hooks prompt

- **Nested parallel** confirmé (test ajouté, le V0.5 compiler
  supporte récursivement déjà).
- **`maxRetries`** exposé sur `ToolNodeConfig`, compilé dans le
  `TaskDefinition` core qui re-queue automatiquement sur fail.
- **Tool dropdown** dans `NodeConfigTool` via nouvelle IPC `tools.list`
  (les 111 tools de la registry, fallback text input si IPC fail).
- **Hooks `prompt` dry-run** via nouveau `dryRunPromptHook` exporté
  depuis `claude-sdk-one-shot.ts`. Test button apparaît pour
  `prompt` (en plus de command/http). `agent` reste mocké (sub-agent
  spawn = trop lourd pour authoring dry-run).

41 tests Cowork verts (15 compilation + 8 agent + 6 intégration + 5
hooks HTTP + 4 hooks prompt + 3 dans nested-parallel/maxRetries).

### Phase 4 — Bug Ollama qwen3.6 prompt UI

Patrice a observé "processing 3 min" sur "bonjour" avec
`qwen3.6:35b-a3b-q4_K_M` via Ollama localhost. Diagnostic depuis le
log `/tmp/cowork-e2e.log` :

- La réponse **arrive** : `[OneShot] Response: Salutations blocks: 2
  textBlocks: 1 thinkingBlocks: 1`.
- L'agent termine : `[ClaudeAgentRunner] Agent finished` +
  `prompt() returned: "void"` + `[TIMING] pi-coding-agent prompt
  completed: 70146ms`.
- Le `void` return + thinking blocks suggère que pi-coding-agent SDK
  considère la conversation terminée mais sans assistant message
  pousser dans l'history.
- 70s ≠ 3min → cold start Ollama (loading 23 GB qwen3.6) + thinking
  long (qwen3 peut produire 500+ tokens de raisonnement) probables.

**Causes probables** :
1. **Cold start Ollama** : 23 GB à loader la première fois (~30-60s).
2. **Thinking long** : qwen3.6 produit du `<think>...</think>` parfois
   très verbeux (1000+ tokens à 17.7 tok/s = 60s+).
3. **UI ne montre pas le thinking en streaming** : `stream.thinking`
   est émis (`agent-runner.ts:2179`) mais le ChatView peut ne pas
   l'afficher par défaut → user voit juste un spinner.
4. **`prompt() returned: "void"`** suggère que la réponse pourrait ne
   pas être correctement attachée au session log.

**Fixes recommandés** (à tester par Patrice, hors scope ce soir) :
- Switch `qwen3:4b` (2.5 GB, <10s) pour validation rapide.
- Si toujours bug : vérifier que le ChatView affiche `stream.thinking`
  en temps réel (collapsable). Sinon, ajouter un indicateur "thinking…"
  dans le UI.
- Vérifier dans `pi-coding-agent` SDK que les `textBlocks` du
  response sont bien push dans `messages[]` avant `agent_end`.

### État final main

- `5757b197` chore(providers): inline ai-providers
- `9b2fbbc3` feat(cowork-hooks): prompt dry-run
- `daa8cefb` feat(cowork): tools.list IPC
- `1c6556d7` feat(cowork-workflows): V0.6 — tool dropdown + retries + nested
- `42e8ff77` chore(cowork): bump rc.7 + CHANGELOG
- `6c5e39f6` fix(workflows): registerBuiltinTools
- (avant) `c764730c` Merge feat/workflow-execution

41 tests workflow + hooks verts. Typecheck clean. Tous pushed sur
origin/main.

— Claude Opus 4.7 (1M context), Ministar Linux / DEV, 9 mai 2026 ~14h

## 2026-05-09 ~15h30 — Session après-midi : Cowork hardening, 9 phases livrées

Après le diag du bug `mainWindow` (cf. entry 14h), Patrice a demandé un
"long plan d'améliorations pour travailler des heures". J'ai planifié
15 phases (~22 h estimées) et livré **9 phases en 1h30** ciblées sur
les quick wins UX et la dette technique tangible.

### Pushed sur `origin/main`

| Commit | Phase | Sujet |
|---|---|---|
| `0765e3e9` | P1 | elapsed counter + cold-start hint sur "processing" |
| `b7ca5fb4` | P2 | Settings → Embedded server (port, host, JWT, WS) |
| `f5629cdc` | P5 | Hooks agent dry-run via `dryRunSubAgent` (dernier mock fermé) |
| `59859753` | P7 | ApprovalDialog enrichi : preview tool input + warnings destructive patterns |
| `4094d60b` | P10 | ToolSelector V2 — combobox avec search + groupes par catégorie |
| `f14cc8c4` | P11 | API heartbeat monitor 30s → `/api/health.apiHeartbeat` live |
| `c673be7b` | P14 | `cowork/ARCHITECTURE.md` + `cowork/DEV-LINUX.md` + CHANGELOG rc.8 |
| `ab2dbba1` | P15 | `release-cowork.yml` workflow trigger sur `cowork-v*` |
| `ec79f3ea` | P13 | Fix dual-let pattern `tray` (même que `mainWindow`, latent) |

### Hors scope ce soir (laissé en TODO du plan)

- **P3 — cross-session search** : nécessite migration FTS5 SQLite, ~2 h.
- **P4 — workflow V0.7 variables** : `setVariable` node + `outputAs` + `iterateOver`, ~3 h.
- **P6 — tab management** : drag-drop reorder + pin + unread, ~2 h.
- **P8 — voice input** : whisper venv + mic IPC, ~2 h.
- **P9 — server dashboard** : modal requests history + WS clients + sparkline, ~1.5 h.
- **P12 — E2E CDP automatisés** : harness pour détecter les régressions de bridge, ~2 h.

### Highlights notables

1. **Cold-start UX** : le ChatView affiche maintenant un compteur en
   secondes dès 1s + sub-message "Loading model" à 5s+ + warning à
   30s+. Plus de spinner muet pendant les 60-120s du cold start
   qwen3.6:35b.

2. **Settings → Embedded server** : page dédiée avec live status
   (host:port, uptime, last error), persist du JWT secret (sinon mint
   runtime), Apply & restart cycle. AppConfig étendu avec un champ
   `server?` (config-store + renderer types).

3. **Hooks dry-run complet** : tous les 4 types testables maintenant
   (command/http/prompt/agent). 12 tests verts au total. Le `agent`
   utilise un `dryRunSubAgent` exporté depuis sub-agent-bridge qui
   spawn une instance temporaire avec un sendToRenderer no-op.

4. **ApprovalDialog smart** : si payload présent (toolName +
   toolInput), preview JSON syntax-highlight + warning rouge si
   destructive pattern matché (rm -rf, chmod 777, sudo, mkfs, fork
   bomb, curl|bash, git push --force, DROP DATABASE, …). Le
   compiler ne set pas le payload encore — c'est V0.8.

5. **ToolSelector V2** : combobox custom 170 LOC avec autofocus
   search, groupage par catégorie, navigation clavier (Up/Down/Enter/
   Escape), close on outside click. Remplace le simple select des
   111 tools.

6. **Heartbeat monitor** : 30s probe loop sur le baseUrl du provider
   actif (Ollama/OpenAI/Anthropic/xAI/Gemini), 5s timeout via
   AbortController, accept 2xx/3xx/401/403 comme reachable. Le
   `/api/health.apiHeartbeat.lastCheck` n'est plus null.

7. **Documentation** : `cowork/ARCHITECTURE.md` (mermaid + 8 bridges
   + state paths + dual-mainWindow regression callout) +
   `cowork/DEV-LINUX.md` (vite build seul, electron-rebuild,
   gotchas).

8. **Release workflow** : `release-cowork.yml` se déclenche sur
   `cowork-v*` tags, vérifie tag === package.json version, publie
   sur npm depuis cowork/, prerelease auto si rc/beta/alpha.
   **Pas de tag pushé** — c'est à Patrice de décider quand release.

9. **Tray dual-let fixed** : même pattern que `mainWindow`, latent
   (personne n'utilise `getTray()` aujourd'hui), fixé pendant que
   c'était frais.

### Total session

- **8 phases UX/feature shipped** + **1 fix latent** + **3 docs**
- **CHANGELOG rc.8** complet, commit-by-commit
- **Cowork bumped 1.0.0-rc.7 → 1.0.0-rc.8**
- **Aucun test cassé**, typecheck cowork + core clean tout le long

### Pour Patrice ce soir / demain

1. **Tester** : ouvre Cowork, vérifie le bouton ⏻ (start server),
   essaie Settings → Embedded server (change port, Apply & restart),
   teste l'icône ? (shortcuts dialog), retape "bonjour" avec qwen3:4b
   (cold-start indicator).
2. **Tag rc.8** quand prêt :
   ```bash
   cd /home/patrice/DEV/code-buddy
   git tag cowork-v1.0.0-rc.8
   git push origin cowork-v1.0.0-rc.8
   ```
   (déclenche le workflow GitHub Actions qui publie sur npm).
3. **Phases TODO** : P3/P4/P6/P8/P9/P12 attendent quand budget Claude
   reset (lundi 2026-05-11 05h selon la mémoire).

### Discipline + sentiment

Bonne session, sentiment de progression visible (UX wins immédiats,
docs durables, dette technique fermée). Le journal est à jour. Le
mémoire `MEMORY.md` n'a pas besoin de mise à jour — pas de nouveau
fait sur Patrice ou sur la stack non-Cowork.

— Claude Opus 4.7 (1M context), Ministar Linux / DEV, 9 mai 2026 ~15h30
