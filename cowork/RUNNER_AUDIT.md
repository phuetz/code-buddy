# Cowork runner audit — engine vs pi (2026-05-09)

> Snapshot at commit `a6568c59`. Maintained at each runner-related
> change so the deprecation path of `ClaudeAgentRunner` (pi-coding-agent)
> is traceable.

## TL;DR

- The **embedded Code Buddy core engine** is the **default runner** since
  post-2026-05 (`cowork/src/main/engine/embedded-mode.ts`). Opt-out via
  `CODEBUDDY_EMBEDDED=0`.
- `ClaudeAgentRunner` (pi) is now a **fallback** — only used when the
  engine bundle is missing (`MODULE_NOT_FOUND`) or explicitly disabled.
- The engine path is **functionally complete** for chat + tools +
  thinking + diff preview + cancellation, but **lacks Cowork-specific
  features** (MCP runtime sync, sudo password injection, skills hot-reload).

The remaining work is to fill those gaps so we can deprecate pi without
regressions.

---

## Files involved

| Layer | File | LOC | Role |
|---|---|---|---|
| Boot | `cowork/src/main/engine/embedded-mode.ts` | 103 | Engine path resolution + opt-out policy |
| Bridge (main proc) | `cowork/src/main/engine/codebuddy-engine-runner.ts` | 571 | Translate `EngineStreamEvent` → `ServerEvent` |
| Adapter (core) | `src/desktop/codebuddy-engine-adapter.ts` | 313 | Wrap `CodeBuddyAgent.processUserMessageStream` |
| Adapter contract | `src/desktop/engine-adapter.ts` | 100 | `EngineAdapter` TS interface |
| Permission bridge | `dist/desktop/permission-bridge.js` | (built) | `DesktopPermissionBridge` for tool approvals |
| Legacy fallback | `cowork/src/main/claude/agent-runner.ts` | 2628 | pi-coding-agent path |

Cowork wiring at `cowork/src/main/index.ts:870-905` resolves the engine
bundle, instantiates `CodeBuddyEngineAdapter`, wires
`DesktopPermissionBridge`, then hands the adapter to `SessionManager`.
SessionManager picks `CodeBuddyEngineRunner` when the adapter is set,
otherwise falls back to `ClaudeAgentRunner`.

---

## Feature parity matrix

Status legend : **OK** (engine matches pi), **GAP** (engine missing
something pi has), **DIFF** (engine does it differently — usually
better), **N/A** (pi-specific quirk that doesn't apply to engine).

| Feature | pi (ClaudeAgentRunner) | engine (CodeBuddyEngineRunner) | Status | Severity |
|---|---|---|---|---|
| **Streaming chunks** |  |  |  |  |
| `content` (text delta) | `text_delta` | `EngineStreamEvent.content` → `stream.partial` | OK | — |
| `reasoning` (thinking) | `thinking_delta` | `EngineStreamEvent.thinking` → `stream.thinking` | OK | — |
| `tool_calls` (start) | `toolcall_start` → `trace.step` | `EngineStreamEvent.tool_start` → `trace.step` (id=tool_use_id) | OK | — |
| `tool_result` | parsed from message | `EngineStreamEvent.tool_end` → `trace.update` | OK | — |
| `tool_stream` (delta) | partial parser | `EngineStreamEvent.tool_stream` → `trace.update` | OK | — |
| `token_count` | merged in `message_end.usage` | `EngineStreamEvent.token_count` → `session.contextInfo` | OK | — |
| `ask_user` | not in pi | `EngineStreamEvent.ask_user` → `trace.step` (synthesised AskUserQuestion tool call) | DIFF | — |
| `plan_progress` | not in pi | `EngineStreamEvent.plan_progress` (passthrough) | DIFF | — |
| `diff_preview` | not in pi | `EngineStreamEvent.diff_preview` → `diff.preview` | DIFF | — |
| `done` (turn end) | `message_end` → `stream.message` | `EngineStreamEvent.done` → `stream.done` + final `stream.message` | OK | — |
| `error` | thrown from prompt() | `EngineStreamEvent.error` → `error` ServerEvent | OK | — |
| `steer` | n/a | not handled (log-only acceptable) | GAP | nice-to-have |
| `run_event` | n/a | not handled (log-only acceptable) | GAP | nice-to-have |
| **Tool integration** |  |  |  |  |
| Built-in tools (read/write/edit/bash/...) | from pi SDK | from core `getToolRegistry()` (~110 tools) | DIFF (more tools) | — |
| MCP server config sync at runtime | `invalidateMcpServersCache()` rebuilds tools per query | `EngineAdapter.setMcpServers(configs)` (Phase 2). Diff-based sync from `SessionManager.invalidateMcpServersCache` + `initializeMCP` + `reloadMCP`. | OK (Phase 2) | — |
| MCP tool routing | `mcp__<server>__<name>` via `buildMcpCustomTools` | `mcp__<server>__<name>` via core's `MCPManager` singleton, kept in sync with Cowork's via the new setter | OK (Phase 2) | — |
| Bash sudo password injection | `wrapBashToolForSudo` IPCs `requestSudoPassword` | not ported | GAP | low (rare in GUI) |
| Bash default timeout | `wrapBashToolWithDefaultTimeout` | core BashTool has its own timeout config | OK | — |
| Custom tool registration | n/a | core's plugin system | DIFF | — |
| Computer Use / GUI overlay | n/a | `isGuiOperateTool` detection + screenshot extraction | OK (engine) | — |
| **Permission flow** |  |  |  |  |
| Tool approval UX | `permission.request` ServerEvent + `permission.response` IPC | `permission.request` ServerEvent (Cowork-shape, with `bridgeId`) + `permission.bridge.response` reply (Phase 7) | OK (Phase 7) | — |
| Allow-once / allow-always | yes | yes (`allow` / `allow_always` / `deny`) | OK | — |
| Auto-approve session flags | `ConfirmationService` session flags | `ConfirmationService` session flags (same singleton) | OK | — |
| **Session lifecycle** |  |  |  |  |
| Session cache (per Cowork session) | `Map piSessions, MAX 50` | `Map agents, MAX 50 LRU eviction` (Phase 9). Insertion-ordered Map, touch-on-access, dispose evicted. | OK (Phase 9) | — |
| Hot-swap model | `piSession.setModel()` native | Auto-dispose + recreate on next runSession when `apiKey:baseURL:model` identity changes (Phase 8). History rehydrated from `messages`. | OK (Phase 8) | — |
| Hot-swap thinking level | `piSession.setThinkingLevel()` native | not exposed yet | GAP | low |
| AbortController for cancel | yes | yes | OK | — |
| Disposal on session close | yes | yes (`clearSession`) | OK | — |
| Restore prior history | `existingMessages` pushed to pi history | `convertMessages` pushes to core `chatHistory` | OK | — |
| **Skills / Plugins** |  |  |  |  |
| Skills hot-reload after install | `invalidateSkillsSetup()` rebuilds resourceLoader | not ported (engine reloads only on agent recreate) | GAP | low |
| Plugin runtime service | `_pluginRuntimeService` stored | core has its own plugin system | DIFF | — |
| **Reasoning / Middlewares** |  |  |  |  |
| 7 conversation middlewares (turn limit / cost / context warning / reasoning / workflow guard / auto-repair / quality gate) | n/a (pi has its own retry only) | active in core | DIFF (engine wins) | — |
| Output sanitizer (`<think>`, `<\|im_start\|>`, etc.) | n/a (or via pi internals) | active in core | DIFF (engine wins) | — |
| Transcript repair (orphan tool_result, lost tool_call pairs) | n/a | active in core | DIFF (engine wins) | — |
| Lessons / writing_rules / `<reasoning_guidance>` injection | n/a | active in core (per CLAUDE.md) | DIFF (engine wins) | — |
| **Provider routing** |  |  |  |  |
| OpenAI-compat / Anthropic / Gemini / Ollama / LM Studio | pi-ai resolver | core `client.ts` strategy pattern (3 providers) | OK | — |
| Custom base URL | yes | yes | OK | — |
| Auth storage | `getSharedAuthStorage` | `apiKey` passed to constructor | DIFF (engine simpler) | — |
| **Misc** |  |  |  |  |
| Save message to SQLite | `saveMessage` callback | `saveMessage` callback (same shape) | OK | — |
| Ghost snapshot before turn | yes (loaded core module) | yes (in CodeBuddyEngineRunner) | OK | — |
| Reasoning capture (ToT/MCTS replay) | active | active in CodeBuddyEngineRunner | OK | — |
| Stream done event | `stream.message` final | `stream.done` + `stream.message` final | OK | — |
| Session status updates | `session.status` running/idle/error | `session.status` running/idle/error | OK | — |

---

## Gaps prioritized for Phase 2

### Blocker (must fix before deprecating pi)

1. ~~**MCP runtime sync**~~ — **fixed in Phase 2 (2026-05-09)**.
   `EngineAdapter` now exposes optional `setMcpServers(configs)`.
   `CodeBuddyEngineAdapter` implements diff-based sync against the
   core's `MCPManager` singleton (add new, remove missing, re-add on
   transport change). Cowork's `SessionManager` calls it from
   `initializeMCP()`, `reloadMCP()`, and `invalidateMcpServersCache()`.
   Tests : 4 in `cowork/tests/engine-mcp-sync.test.ts` +
   6 in `tests/desktop/codebuddy-engine-adapter-mcp.test.ts`.

### Medium (should fix soon, has UX impact)

2. ~~**Hot-swap model**~~ — **fixed in Phase 8 (2026-05-09)**.
   `CodeBuddyEngineAdapter` tracks per-session identity
   `apiKey:baseURL:model`. On next `runSession`, if the desired
   identity differs from cached, the agent is disposed and recreated.
   The full message history is replayed into the new agent (the
   `messages` array always carries it), so the user perceives a
   model switch with zero context loss beyond the in-memory
   middleware state. 6 tests in
   `tests/desktop/codebuddy-engine-adapter-hotswap.test.ts`.
3. ~~**Permission UI consistency**~~ — **fixed in Phase 7 (2026-05-09)**.
   The `DesktopPermissionBridge` now emits a `permission.request`
   payload that matches Cowork's `PermissionRequest` shape
   (`toolUseId`, `toolName`, `input`, `sessionId`) plus a `bridgeId`
   marker. The renderer's `respondToPermission()` reads `bridgeId`
   and routes the answer via `permission.bridge.response` so the
   engine bridge resolves correctly. Without this fix, every
   destructive tool on the engine path silently deadlocked because
   the dialog rendered "use undefined" and the response went to the
   wrong channel. 5 tests in
   `tests/desktop/permission-bridge-unify.test.ts`.

### Low (acceptable V1, follow-up)

4. **Bash sudo password injection** — rare use case in Cowork,
   document as missing.
5. **Skills/plugins hot-reload** — restart workaround acceptable.
6. ~~**Session cache LRU**~~ — **fixed in Phase 9 (2026-05-09)**.
   `MAX_CACHED_SESSIONS = 50` matches pi. Insertion-ordered `Map`
   is touch-on-access; oldest evicted on overflow with `dispose()`
   called. 7 tests in
   `tests/desktop/codebuddy-engine-adapter-lru.test.ts`.
7. **`steer` / `run_event` chunks** — log-only is fine, no UI needed.

---

## How to verify which runner is active

At Cowork boot, look in the logs for one of:

- `[Main] Code Buddy engine adapter initialized (embedded mode)` →
  engine ON.
- `[Main] CODEBUDDY_EMBEDDED=0 — embedded engine disabled by env opt-out`
  → pi fallback (explicit).
- `[Main] Engine bundle missing at <path> — falling back to pi runner`
  → pi fallback (engine bundle absent — usually means
  `dist/desktop/codebuddy-engine-adapter.js` wasn't built).

To force pi for debugging :
```bash
CODEBUDDY_EMBEDDED=0 npm run dev
```

To force engine even if embedded-mode says no :
```bash
CODEBUDDY_ENGINE_PATH=/abs/path/to/dist npm run dev
```

(But normally engine is auto-detected — just `npm run dev` works.)

---

## Next steps

- ~~Phase 2 : fix the blocker (MCP sync) + audit permission UI.~~ — done.
- ~~Phase 3 : surface "active runner = engine | pi" in titlebar.~~ — done.
- ~~Phase 4 : Settings opt-in / opt-out persisté.~~ — done.
- ~~Phase 5 : add tests for event-mapping.~~ — done (9 cases).
- Phase 6 : update CHANGELOG + README runner section. **In flight.**
- Out of scope here : deprecate pi (V0.9+, after 4-6 weeks of
  engine-only daily use). The audit doc + Settings page are the
  prerequisites for a clean deprecation announcement.
