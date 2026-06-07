# Mission Orchestrator — Phase 1 wiring plan

Status: **core landed, wiring pending review.** This document describes the
remaining work to connect the pure mission core to the running Cowork app. It
is the follow-up to `docs/AUTONOMOUS-SYSTEM-ROADMAP.md` Phase 1 (§2.1 Mission
Intake, §2.2 Mission Board, §2.3 Heartbeat, §2.4 Checkpointing).

## What already exists (this branch)

Pure, fully unit-tested TypeScript core — **no Electron, no IPC, no SQLite,
no LLM, no bridge coupling** (so it cannot break the app and runs under plain
vitest):

| File | Role |
| ---- | ---- |
| `cowork/src/main/missions/mission-types.ts` | `Mission`, `SubTask`, `MissionEvent`, `MissionStatus`/`SubTaskStatus` enums, injectable `Clock`/`IdFactory`, `isTerminalStatus()`. ISO-8601 string timestamps via an injected clock — never `Date.now()` at module scope. |
| `cowork/src/main/missions/mission-store.ts` | JSON persistence, one file per mission under a configurable base dir (default `~/.codebuddy/missions/`). Atomic write = unique-temp + rename (survives concurrent saves). `save/load/list/loadAll/remove`. Injectable `baseDir` + `fs` + `tempSuffix`. No `electron` import. |
| `cowork/src/main/missions/mission-manager.ts` | `EventEmitter` over the store: `init/createMission/getMission/listMissions/addSubTask/updateSubTaskStatus/recomputeProgress/updateStatus/recordEvent/cancel/addUsage/removeMission`. Emits `mission:created` \| `mission:updated` \| `mission:event`. Injectable clock + id factory. |
| `cowork/src/main/missions/mission-scheduler.ts` | Pure DAG scheduler. `readySubTasks(mission)` returns pending sub-tasks whose dependencies are satisfied, with blocker diagnostics for the future Mission Board. No execution, timers, IPC or Electron. |
| `cowork/src/main/missions/mission-bridge.ts` | Pure main-process wrapper over the manager. Streams `mission.*` events through an injected sender, applies boot recovery, exposes `readySubTasks`, and drives heartbeat ticks without importing Electron or registering IPC. |
| `cowork/tests/mission-core.test.ts` | 18 vitest tests: create→persist→reload from a fresh store, progress recompute (incl. zero-subtask), status transitions + reload, cancel, event-log append + emitter signals, atomic-write under 50 concurrent saves, corrupt-file tolerance. |
| `cowork/tests/mission-scheduler.test.ts` | Scheduler tests for ready roots, completed dependencies, blocked missing/running/failed/skipped dependencies, non-schedulable mission statuses, blocker diagnostics and the optional skipped-as-satisfied mode. |
| `cowork/tests/mission-bridge.test.ts` | Bridge tests for server-event translation, boot recovery streaming, ready-subtask exposure and heartbeat ticks without execution dispatch. |

`recomputeProgress` = `round(completed / total * 100)`, zero sub-tasks → `0`.

Everything below needs the running app / `better-sqlite3` / Electron / Patrice's
review, so it is intentionally **out** of the core.

---

## 1. The `mission` IPC namespace (one-shot handlers)

Mirror the **`workflow.*`** namespace exactly — it is the closest analog
(CRUD + run + lifecycle streaming).

**Register handlers** in `cowork/src/main/index.ts`, next to the existing
`workflow.*` block (`ipcMain.handle('workflow.list', …)` starts at
**index.ts:4062**, ends at `workflow.approve` **~index.ts:4130**). Add:

```ts
ipcMain.handle('mission.create',  (_e, input)            => missionManager.createMission(input));
ipcMain.handle('mission.list',    (_e, filter)           => missionManager.listMissions(filter));
ipcMain.handle('mission.get',     (_e, id)               => missionManager.getMission(id));
ipcMain.handle('mission.pause',   (_e, id)               => missionManager.updateStatus(id, MissionStatus.Paused));
ipcMain.handle('mission.resume',  (_e, id)               => missionManager.updateStatus(id, MissionStatus.Running));
ipcMain.handle('mission.cancel',  (_e, id)               => missionManager.cancel(id));
ipcMain.handle('mission.requestInput', (_e, id, prompt)  => /* set WaitingApproval + emit event */);
```

**Instantiate + wire the manager** where `WorkflowBridge` is created in
`index.ts` (**index.ts:1713**, `workflowBridge = new WorkflowBridge();
workflowBridge.setSendToRenderer(sendToRenderer);`). For missions:

```ts
const missionStore   = new MissionStore();              // default ~/.codebuddy/missions
const missionManager = new MissionManager({ store: missionStore });
await missionManager.init();                            // rehydrate from disk on boot
missionManager.on('mission:created', (m)  => sendToRenderer({ type: 'mission.created', payload: m }));
missionManager.on('mission:updated', (m)  => sendToRenderer({ type: 'mission.updated', payload: m }));
missionManager.on('mission:event',  (sig) => sendToRenderer({ type: 'mission.event',   payload: sig }));
```

> Note: a thin **`MissionBridge`** wrapper (cowork/src/main/missions/
> `mission-bridge.ts`) is the cleaner home for this glue — it owns the
> `MissionManager`, the `sendToRenderer` subscription, and the decomposition /
> execution calls (§4). That keeps `index.ts` to just `new MissionBridge()` +
> handler registration, exactly like `WorkflowBridge`.

**Expose in preload** `cowork/src/preload/index.ts` — add a `mission`
namespace next to the `workflow` block (**preload/index.ts:1579**). Each method
is a one-shot `ipcRenderer.invoke('mission.<method>', …)`:

```ts
mission: {
  create:       (input)      => ipcRenderer.invoke('mission.create', input),
  list:         (filter?)    => ipcRenderer.invoke('mission.list', filter),
  get:          (id)         => ipcRenderer.invoke('mission.get', id),
  pause:        (id)         => ipcRenderer.invoke('mission.pause', id),
  resume:       (id)         => ipcRenderer.invoke('mission.resume', id),
  cancel:       (id)         => ipcRenderer.invoke('mission.cancel', id),
  requestInput: (id, prompt) => ipcRenderer.invoke('mission.requestInput', id, prompt),
},
```

(The `mission` namespace is the one proposed by
`docs/AUTONOMOUS-SYSTEM-ROADMAP.md` §2.1 — "Nouveau namespace IPC `mission` ou
extension de `workflow`". Register it the same way the namespaces documented in
`cowork/ARCHITECTURE.md` are.)

Watch the **rc.8 dual-`mainWindow` gotcha** (CLAUDE.md): do not redeclare
`mainWindow`; `sendToRenderer` already reads it via `getMainWindow()` after
`setMainWindow()`. We reuse the exact same path, so nothing new is needed
there — just don't reintroduce a second `let mainWindow`.

## 2. Streaming mission events to the renderer

Reuse the **single existing `'server-event'` channel** — do **not** add a new
preload `ipcRenderer.on(...)` listener. The preload registers exactly one
`'server-event'` listener that forwards to `useIPC`
(`cowork/src/main/ipc-main-bridge.ts:sendToRenderer()` →
`webContents.send('server-event', event)` at **ipc-main-bridge.ts:93**).

Steps:

1. **Extend the `ServerEvent` union** in
   `cowork/src/renderer/types/index.ts` (the union is where
   `workflow.event` / `workflow.approval_required` live, **~lines 1658–1659**):
   ```ts
   | { type: 'mission.created'; payload: Mission }
   | { type: 'mission.updated'; payload: Mission }
   | { type: 'mission.event';   payload: { missionId: string; event: MissionEvent } }
   ```
   (import the types from `../../main/missions/mission-types`, mirroring how
   `workflow.event` imports `WorkflowEventPayload`).
2. **Handle them in `useIPC`** `cowork/src/renderer/hooks/useIPC.ts` — add
   `case 'mission.created' | 'mission.updated' | 'mission.event':` next to the
   existing `case 'workflow.event':` (**useIPC.ts:539**), each delegating to a
   new Zustand store mutator (`applyMissionEvent` / `upsertMission`), exactly as
   `workflow.event` calls `store.applyWorkflowEvent(event.payload)`.
3. **Store slice** in `cowork/src/renderer/store/index.ts` — a
   `missions: Record<id, Mission>` map plus `upsertMission` / `applyMissionEvent`
   mutators (mirror the workflow run-state slice).

This is the same end-to-end push path the Mission Board needs for live updates,
with zero new IPC plumbing.

## 3. `MissionBoard.tsx` renderer component

New component `cowork/src/renderer/components/MissionBoard.tsx`, registered as a
panel in `cowork/src/renderer/App.tsx` + the nav store (same place
`WorkflowEditor` / `KanbanPanel` are wired — see `App.tsx` and
`store/index.ts`).

Mirror these existing panels:
- **`KanbanPanel.tsx`** — column/card layout for the mission list grouped by
  status (Planning / Running / Waiting Approval / Paused / Completed /
  Failed / Cancelled).
- **`WorkflowEditor.tsx`** — for the per-mission **sub-task DAG** (React-Flow
  nodes/edges); reuse its node/edge rendering for `SubTask.dependsOn`.
- **`ReasoningTraceViewer.tsx`** / the trace panel — for the live **activity
  feed** rendered from `mission.events` (same shape as `trace.step` rendering).

What it shows per mission:
- Status badge + progress bar (`mission.progress`, 0–100).
- Sub-task list / interactive DAG (click a node → detail drawer with
  `result` / `error`).
- Live activity log (streamed `mission.event`s), cost (`costUsd`) and tokens.
- Controls: **Pause / Resume / Cancel / Request Human Input / View Full Trace**
  → call `electronAPI.mission.pause|resume|cancel|requestInput`.
- Intake: a **"New Mission"** form (or a `/mission "<task>"` chat command) that
  calls `electronAPI.mission.create({ title, description })` (§2.1).
- Push notifications via the existing `notification` namespace; optional
  Presence "agent at work" affordance (§2.2).

## 4. Manager → existing bridges (decomposition + execution)

The core deliberately makes **no** LLM calls and **no** bridge calls. The
`MissionBridge` wrapper (§1) connects them:

- **Decomposition (§2.1)** — on `createMission`, call the core LLM (via
  `CodeBuddyEngineRunner` / a one-shot engine call) with a structured
  Tree-of-Thought / MCTS prompt to produce sub-tasks, then `addSubTask(...)`
  for each, and `updateStatus(Planning → Running)`. Optionally compile the
  resulting DAG into a visual workflow and persist it via
  `WorkflowBridge.create()` (`cowork/src/main/workflows/workflow-bridge.ts`)
  so the Mission Board can show / re-use the visual editor.
- **Execution** — assign sub-tasks to:
  - `SubAgentBridge` (`cowork/src/main/agent/sub-agent-bridge.ts` —
    `spawn / wait / list / close`) for single-agent sub-tasks;
  - `TeamBridge` (`cowork/src/main/agent/team-bridge.ts`) for multi-agent
    sub-tasks;
  - `FleetBridge` (`OrchestratorBridge`,
    `cowork/src/main/agent/orchestrator-bridge.ts`) for `peer_delegate`
    dispatch across Fleet peers.
  Map each bridge's progress/completion events back to
  `updateSubTaskStatus(missionId, subTaskId, …)` (which auto-recomputes mission
  progress and emits `mission:updated`), and forward cost/token deltas via
  `addUsage(...)`.
- **Approvals (§2.7)** — reuse the existing `workflow.approval_required` /
  `PermissionDialog` path; set the mission to `WaitingApproval` while pending.

## 5. Heartbeat per mission (§2.3)

- A configurable scheduler (15 min / 1 h / custom) wakes the `MissionBridge`
  for each non-terminal mission. Model it on the core fleet heartbeat
  (`src/fleet/heartbeat-broadcaster.ts`,
  `src/fleet/autonomous-tick-broadcaster.ts`) and/or the existing Cowork
  schedule store (`cowork/src/main/schedule/scheduled-task-store.ts` +
  manager) so timers survive boot.
- On each tick the manager: checks sub-task progress, emits a
  `recordEvent(id, { type: 'heartbeat', … })` (already supported by the core,
  streamed live to the board), detects stalls (e.g. a sub-task `Running` past a
  threshold) and either retries, proposes a fix, or flips to `WaitingApproval`,
  and can run background tasks (cleanup, research). Proactive updates go out via
  the `notification` namespace / channel bridges.
- Per-mission `HEARTBEAT.md` (or a section in mission memory under
  `~/.codebuddy/missions/`) is optional polish; the structured `events[]` log
  already captures the same information machine-readably.

## 6. Checkpoint / resume (§2.4)

- **State is already durable**: every mutating manager method persists the full
  mission (atomic temp+rename) to `~/.codebuddy/missions/<id>.json`, and
  `MissionManager.init()` rehydrates all missions at boot — so a Cowork crash /
  restart resumes the board with no data loss. This is the JSON half of §2.4
  and is done.
- **Remaining**: on boot, for each mission left in `Running` /
  `WaitingApproval`, the `MissionBridge` decides resume vs. recover —
  re-attach to a still-running sub-agent, re-dispatch an interrupted sub-task,
  or mark `Failed` with `error` if unrecoverable. Persist a `checkpoint` event
  (`recordEvent`) at each safe point. For sub-task-level snapshots beyond the
  mission JSON, reuse the core checkpoint managers
  (`src/checkpoints/persistent-checkpoint-manager.ts`,
  `src/agent/autonomous/checkpoint-manager.ts`). The optional SQLite mirror
  from §2.4 (Cowork `cowork.db`) is a later add — the JSON store is the source
  of truth for V1.
- Auto-repair leans on the existing core middlewares (`AutoRepairMiddleware`,
  `QualityGateMiddleware`) already running inside `CodeBuddyEngineRunner`.

---

### Phase-1 wiring checklist

- [x] `MissionBridge` (`cowork/src/main/missions/mission-bridge.ts`) owning the
      manager + `sendToRenderer` subscription, boot recovery, ready-subtask
      planning and heartbeat ticks. Decomposition/execution glue remains TODO.
- [ ] `mission.*` `ipcMain.handle` block in `index.ts` (next to `workflow.*`).
- [ ] `mission` preload namespace + `ServerEvent` union variants + `useIPC`
      cases + store slice.
- [ ] `MissionBoard.tsx` + nav registration.
- [ ] Decomposition prompt + bridge dispatch + progress mapping.
- [x] Pure DAG scheduler for ready sub-tasks (`readySubTasks`) — no execution side effects.
- [x] Heartbeat selection + boot-recovery **core logic** (pure, tested) — see below.

## Heartbeat & Recovery (implemented — pure core)

Two additive, pure modules (no Electron/IPC/timers; unit-tested in
`cowork/tests/mission-heartbeat-recovery.test.ts`, 8 tests):

- `cowork/src/main/missions/mission-recovery.ts` — §2.4 boot recovery.
  `planBootRecovery(missions)` (pure) flags missions persisted as
  `planning`/`running` (live in-memory execution lost on restart) and
  `applyBootRecovery(manager)` parks them in `paused` with a `boot-recovery`
  audit event. Idempotent across restarts; leaves terminal / already-parked
  (`paused`/`waiting_approval`) missions untouched.
- `cowork/src/main/missions/mission-heartbeat.ts` — §2.3 proactive heartbeat.
  `selectDueMissions(missions, now, intervalMs)` (pure) picks heartbeat-active
  missions whose last `heartbeat` event (derived from the event log — no schema
  change) is older than the interval. `MissionHeartbeat.tick(now)` records a
  `heartbeat` event + emits `mission:heartbeat` for each due mission. **No real
  timer** — an external scheduler (the IPC/Electron layer, still TODO) calls
  `tick()` on a cadence, keeping the logic deterministic/testable.

**Remaining wiring** (needs the running app): call `applyBootRecovery(manager)`
after `manager.init()` at Cowork boot; drive `MissionHeartbeat.tick()` from a
`setInterval`/scheduler in the main process; surface `mission:heartbeat` to the
Mission Board via the existing `server-event` channel.
