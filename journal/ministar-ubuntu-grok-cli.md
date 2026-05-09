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
