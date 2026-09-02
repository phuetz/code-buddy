# Cowork architecture

Electron desktop app split across three contexts: **main** (Node-side
privileged code), **preload** (the IPC bridge exposed to the renderer
via `contextBridge`), and **renderer** (the React UI). The core
agent/server modules live one directory up in `code-buddy/src/` and are
loaded into the main process via `loadCoreModule()` (`cowork/src/main/utils/core-loader.ts`)
which dynamic-imports them from the compiled `code-buddy/dist/`.

## Process diagram

```mermaid
flowchart LR
    subgraph renderer["Renderer (React + Zustand)"]
        UI[ChatView / SettingsPanel / WorkflowEditor / …]
        store[useAppStore]
        useIPC[useIPC hook]
    end

    subgraph preload["Preload (contextBridge)"]
        api[window.electronAPI<br/>send / on / invoke + namespaces]
    end

    subgraph main["Main (Electron + Node)"]
        idx[index.ts: ipcMain.handle('<...>')]
        sendToRenderer[sendToRenderer<br/>ipc-main-bridge.ts]

        subgraph bridges["Bridges (cowork/src/main/<area>/)"]
            HB[HooksBridge]
            WB[WorkflowBridge]
            A2A[A2ABridge]
            PB[PresenceBridge]
            SB[ServerBridge]
            SAB[SubAgentBridge]
            TB[TeamBridge]
            FB[FleetBridge]
        end
    end

    subgraph core["Core (code-buddy/dist/)"]
        Orch[Orchestrator]
        Reg[FormalToolRegistry]
        DB[DatabaseManager]
        Server[HTTP server<br/>+ WS gateway<br/>+ /api/health]
        Agents[Multi-agent runtime]
    end

    UI -->|hooks| store
    UI -->|electronAPI.config.save| api
    api -->|ipcRenderer.invoke| idx
    api -->|ipcRenderer.on 'server-event'| useIPC
    useIPC -->|store mutators| store

    idx --> bridges
    WB -->|loadCoreModule| Orch
    WB -->|registerBuiltinTools| Reg
    SB -->|startServer| Server
    SAB -->|spawnAgent| Agents
    SB -->|getDatabaseManager| DB

    bridges -.events.-> sendToRenderer
    sendToRenderer -->|webContents.send 'server-event'| api
```

## Key bridges

| Bridge | File | Responsibility |
| ------ | ---- | -------------- |
| `CodeBuddyEngineRunner` | `cowork/src/main/engine/codebuddy-engine-runner.ts` | **Default agent runner since post-2026-05.** Wraps the `CodeBuddyEngineAdapter` (built into `dist/desktop/codebuddy-engine-adapter.js`) which itself wraps the core `CodeBuddyAgent`. Translates `EngineStreamEvent` chunks into Cowork `ServerEvent`s. See `RUNNER_AUDIT.md` for the parity matrix vs the legacy `ClaudeAgentRunner` (pi). |
| `WorkflowBridge` | `cowork/src/main/workflows/workflow-bridge.ts` | Persists visual workflows to `<userData>/workflows/workflows.json`, compiles them via `dag-compiler.ts` into the core `Orchestrator` shape, and dispatches `task_assigned` events to `CoworkToolAgent` (which delegates to `FormalToolRegistry.execute`). Live execution events (`workflow.event`, `workflow.approval_required`) flow back to the renderer. |
| `HooksBridge` | `cowork/src/main/hooks/hooks-bridge.ts` | CRUD on `.codebuddy/hooks.json` + dry-run for the four handler types (`command`, `http`, `prompt`, `agent`). |
| `A2ABridge` | `cowork/src/main/a2a/a2a-bridge.ts` | Google A2A protocol — register remote agents by URL, fetch `/.well-known/agent.json`, invoke `/tasks/send`. |
| `PresenceBridge` | `cowork/src/main/presence/presence-bridge.ts` | Face memory: webcam → Buffalo_S ArcFace ONNX → cosine match → `current.json` cross-process file consumed by the core agent. |
| `ServerBridge` | `cowork/src/main/server/server-bridge.ts` | Boots / stops the core HTTP server (port 3000 + WS 3001) in-process. Reads persisted settings from `configStore.getAll().server`. |
| `SubAgentBridge` | `cowork/src/main/agent/sub-agent-bridge.ts` | Wraps `agent/multi-agent/agent-tools.ts` and translates its event stream into `subagent.spawned/status/completed/output` ServerEvents. Also exposes `dryRunSubAgent()` for hooks-bridge. |
| `TeamBridge` | `cowork/src/main/agent/team-bridge.ts` | Agent Teams (Phase 4 layer 9) — multi-host coordination on top of SubAgentBridge. |
| `FleetBridge` | `cowork/src/main/agent/orchestrator-bridge.ts` | OrchestratorLauncher / `peer_delegate` dispatch (d.17). |
| `GpuMediaAdminBridge` | `cowork/src/main/gpu-media/gpu-media-admin-bridge.ts` | Typed Cowork administration for the authenticated GPU node worker: submit/status/cancel, PanoWorld manifest export and LongCat MP4 download. |

## IPC channels (one-shot)

Format: `electronAPI.<namespace>.<method>(args)` → `ipcMain.handle('<namespace>.<method>', …)`.

Namespaces include `config`, `mcp`, `skills`, `plugins`, `sandbox`, `logs`, `remote`, `template`, `workflow`, `tools`, `server`, `presence`, `hooks`, `a2a`, `subagent`, `orchestrator`, `fleet`, `team`, `gpuMedia`, `notification`, `bookmark`, `snippet`, `customCommand`, `workspacePreset`, `permissionRule`, `sessionInsights`, `costDashboard`, `voice` (planned), `mcpMarketplace`, `mcpPlayground`, `globalSearch`, `nav`, `update`, `window`, `presence:event` listener, `presence:download-progress` listener.

## IPC channels (streaming)

A single channel `'server-event'` carries every push from main to renderer.
The preload (`cowork/src/preload/index.ts`) registers exactly one
listener and forwards to a callback installed by `useIPC`. The
`ServerEvent` discriminated union (`cowork/src/renderer/types/index.ts`)
enumerates ~70 event types: `stream.message`, `stream.partial`,
`stream.thinking`, `stream.done`, `session.status`, `session.update`,
`trace.step`, `trace.update`, `gui.action`, `workflow.event`,
`workflow.approval_required`, `subagent.spawned`, … etc.

## Persistent state

| Path | Role |
| ---- | ---- |
| `<userData>/cowork.db` | Cowork SQLite — sessions, messages, traces, etc. |
| `<userData>/workflows/workflows.json` | Visual workflow definitions. |
| `<userData>/presence-store.json` | Enrolled face identities. |
| `<userData>/models/buffalo_s.onnx` | ArcFace recognizer (~13 MB, manual or scripted install). |
| `~/.codebuddy/codebuddy.db` | Core SQLite (server route handlers, ICM memory). |
| `~/.codebuddy/presence/current.json` | Cross-process presence state (read by the core agent). |

## Agent runner architecture

Cowork has two agentic-loop implementations that coexist behind the
same `IAgentRunner` interface:

```
SessionManager.createAgentRunner()
   │
   ├─ if engineAdapter set (DEFAULT post-2026-05)
   │     → CodeBuddyEngineRunner.run()
   │        └─ CodeBuddyEngineAdapter.runSession()
   │           └─ CodeBuddyAgent.processUserMessageStream()
   │              └─ runTurnLoop yields StreamingChunk
   │                 └─ EngineStreamEvent translated to ServerEvent
   │
   └─ else (CODEBUDDY_EMBEDDED=0 or bundle absent)
        → ClaudeAgentRunner.run() [legacy pi-coding-agent fallback]
```

Decision is made at boot in `cowork/src/main/index.ts:870` by
`shouldLoadEngine(userMode, env)` (`cowork/src/main/engine/embedded-mode.ts`),
combining the user's Settings → Core engine choice (`'auto' |
'force-on' | 'force-off'`) with the env override `CODEBUDDY_EMBEDDED`.

The **engine path** is preferred because it brings the core's 7
middlewares (turn limit, cost, context warning, reasoning, workflow
guard, auto-repair, quality gate), output sanitizer, transcript
repair, and ~110 built-in tools. The **pi path** stays as fallback
for environments where the engine bundle didn't ship (e.g. `cowork`
checked out without building the parent CLI).

State sync from Cowork → engine runs through optional methods on the
`EngineAdapter` interface (`src/desktop/engine-adapter.ts`):

| Method | Trigger | Purpose |
| ------ | ------- | ------- |
| `setMcpServers(configs)` | `SessionManager.invalidateMcpServersCache` | Push add/remove/update of MCP servers to the core's `MCPManager` singleton (separate from Cowork's). |
| `setPermissionCallback(cb)` | Boot | Hook the GUI permission modal into `ConfirmationService`. |
| `reloadSkills()` | `SessionManager.invalidateSkillsSetup` | Reload the SKILL.md registry after install/uninstall. |

The runner badge in the titlebar (`cowork/src/renderer/components/RunnerBadge.tsx`)
calls `electronAPI.runner.status()` every 5 s so Patrice sees instantly
which runner is live, with click-to-open `RunnerDetailsDialog` for
boot errors / cached session count.

## Critical regression to watch

The main and window-management modules each used to keep their own
`let mainWindow`. The latter was exported via `getMainWindow()` and
read by `sendToRenderer()`, but only the former was ever assigned to
when `new BrowserWindow()` ran. **All IPC events were silently dropped.**
Fixed in commit `751f7eb6` by exporting `setMainWindow()` from
`window-management.ts` and calling it in `index.ts` after the window is
created. The bridge logs `[ipc-main-bridge] dropped <event>` at error
level if anyone ever reintroduces the same shape.

## Build modes

- **Dev** (`npm run dev` from `cowork/`): heavy — downloads Node, builds
  WSL/Lima agents, prepares Python embedded runtime, then `vite`.
  Often fragile on Linux because `prepare:python:all` HTTP-504s
  GitHub's `python-build-standalone` releases API.
- **Vite-only** (`npx vite build`): the production bundle for
  `dist/` (renderer) + `dist-electron/main` + `dist-electron/preload`,
  ~30 s, no Python download. **Use this for iterative dev on Linux**
  — see `docs/dev-linux.md`.
- **Full build** (`npm run build`): vite + `electron-builder` package.
  Required only for shipping installers.
