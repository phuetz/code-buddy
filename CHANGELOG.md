# Changelog

All notable changes to Code Buddy are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once it reaches `1.0.0`.

---

## [Unreleased]

Heading toward `1.0.0` final. Open audit blockers tracked in
`claude-et-patrice/propositions/` and the V1.x roadmap section of
[`docs/fleet-guide.md`](docs/fleet-guide.md). Backlog notes also under
`## [0.5.1-fleet]`.

### Added — Fleet V1.3 partial (Phase d.23) — `peer.tool.invoke`

- **`peer.tool.invoke` + `peer.tool.invoke.stream`** — read-only remote
  tool invocation via the fleet WebSocket. A peer Code Buddy can ask
  another peer to execute a tightly-scoped read tool against THIS
  peer's filesystem and stream the result back. Pattern is OpenClaw
  `node.invoke` extended to tools.
  - V1 allowlist (hardcoded, override via env `CODEBUDDY_PEER_TOOL_ALLOWLIST`):
    `view_file`, `list_directory`, `search` (ripgrep). All three already
    carry `fleetSafe: true` in `src/tools/metadata.ts`.
  - **Three security gates**, in order: allowlist → registry `fleetSafe`
    flag → workspace root (every path arg is `realpath`'d and checked
    against `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT`). **Fail-closed when
    the workspace env is unset** so a misconfigured peer cannot
    accidentally expose `/`.
  - Streaming variant uses `ctx.emitChunk` → `peer:chunk` frames
    (16 KB chunks for `view_file`, line-by-line for `search`).
  - Anti-loop guards (`CODEBUDDY_PEER_MAX_DEPTH`, `CODEBUDDY_PEER_ROLE=leaf`)
    inherited from the dispatcher — no new wiring.
  - Audit log via `logger.info('[fleet] peer.tool.invoke', meta)` on
    every invocation (success and failure), with shape
    `{ event, from, traceId, depth, tool, stream, ok, error?, durationMs }`.
  - R4 audit hardening: `view_file` now reads only a capped prefix,
    `list_directory` caps entries and reports truncation, stream output
    is sanitized before live terminal display, and the WebSocket
    loopback path is covered by `tests/fleet/fleet-loopback-smoke.test.ts`.
  - Fleet provider routing now detects `/login chatgpt` OAuth credentials
    as `chatgpt-oauth`, advertises Codex subscription models at zero
    marginal cost, and lets `peer.chat` use the ChatGPT Codex Responses
    backend before falling back to paid API providers.
  - `list_peers({ includeCapabilities: true })` now enriches connected
    peers with `peer.describe` provider/model summaries so the LLM can
    choose between ChatGPT OAuth, Ollama, Gemini CLI, and paid APIs before
    calling `peer_delegate`.
  - New module `src/fleet/peer-tool-bridge.ts` (~280 LOC,
    standalone executors using `fs/promises` + `@vscode/ripgrep`).
    18 unit tests in `tests/server/peer-tool-bridge.test.ts`.
  - Client convenience: `FleetListener.invokeTool(name, args, opts)` +
    `invokeToolStream(name, args, onChunk, opts)`.
  - Wired alongside `peer-chat-bridge` in `src/server/index.ts`.
  - Docs: [`docs/fleet-guide.md`](docs/fleet-guide.md) — section
    "`peer.tool.invoke` + `peer.tool.invoke.stream` — Phase (d).23 / V1.3".
  - Out of scope for V1 (kept for future phases): mutating tools
    (Edit/Write/Bash) — require explicit per-call approval; permission
    modes on the peer side; multi-workspace; cancellation cross-WS;
    JWT scope `peer:tool:invoke`; MCP-tool exposure.
  - **Behavior note** — the bridge is wired unconditionally on every
    `buddy server` start (no env feature flag). Safe by fail-closed
    default: with no `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` set, every
    invocation rejects with `PEER_WORKSPACE_NOT_CONFIGURED` and
    nothing else changes. Existing deployments need no migration.
  - **Test coverage scope** — unit tests dispatch directly via
    `dispatchPeerRequest`, while `tests/fleet/fleet-loopback-smoke.test.ts`
    starts a real Gateway WebSocket server and exercises `/fleet tool`
    over the loopback transport in both buffered and streamed modes.
    Cross-host E2E with a real DARKSTAR fleet gateway remains the
    intended Phase 2-3 follow-up.

### Added — Fleet V1.2 (Phase d.21)

- **`peer.chat-session.start/.continue/.end`** — multi-turn
  conversations between fleet peers, with state held in-memory on the
  peer that hosts the LLM client. Where `peer.chat` (d.15) is a
  stateless one-shot, this trio lets a caller open a session, append
  turns that build on prior context, and close it explicitly.
  - Idle TTL 30 min (override via `CODEBUDDY_PEER_SESSION_IDLE_MS`),
    reset on each `continue`. Opportunistic GC — no setInterval timer.
  - Concurrent `continue` calls on the same sessionId serialise FIFO
    via per-session promise chains so assistant messages can't
    interleave on shared history.
  - Failed turns roll back the user message they appended, so a
    retry stays consistent with what the model has actually seen.
  - Error codes: `SESSION_NOT_FOUND`, `SESSION_EXPIRED`,
    `CLIENT_UNAVAILABLE`. `traceId` echoed in every response.
  - New module `src/fleet/peer-session-bridge.ts` (~250 LOC),
    17 unit tests in `tests/fleet/peer-session-bridge.test.ts`.
  - Wired alongside `peer-chat-bridge` in `src/server/index.ts`.
  - Docs: [`docs/fleet-guide.md`](docs/fleet-guide.md) — section
    "`peer.chat-session.*` V1.2 (Phase d.21)".
  - Limitations carried into V1.3: no tools (separate
    `peer.tool.invoke` design), no cross-restart durability
    (saga-store backing is a possible follow-up).

### Added — Fleet V1.2.1 (`/fleet chat` slash helper)

- **`/fleet chat start|say|end|list`** — UX wrapper around
  `peer.chat-session.*` so users don't have to copy `sessionId` between
  turns. Aliases default to `<peer>-1`, `<peer>-2`, … and can be set
  with `--name <alias>`. The "active" session resolves to the unique
  one when there's only one open, or to the last `start` otherwise;
  `--session <alias>` overrides on `say`/`end`.
  - Errors propagate cleanly from the server: `SESSION_NOT_FOUND` /
    `SESSION_EXPIRED` purge the local handle so the user sees the error
    once and can restart cleanly.
  - `/fleet stop <peer>` and `/fleet stop --all` auto-purge any chat
    sessions tied to the peer being closed (server-side will TTL out).
  - Implementation in `src/commands/handlers/fleet-handler.ts` (~280
    LOC for the new sub-action + state). 18 unit tests in
    `tests/fleet/fleet-chat-helper.test.ts`.

### Added — /fleet history --type + --json

- **`--type <glob>`** — filter the rendered history by event-type
  pattern (e.g. `fleet:agent:tool*` or `fleet:peer:*`). The glob
  supports `*` only; everything else is escaped, so it's safe with
  literal `:` in event names. The filter operates on the in-memory
  ring after the size cap so older filtered-out events don't get
  hidden.
- **`--json`** — emit the rendered slice as a JSON array (one object
  per event with `peer`, `at`, `type`, `hostname`, `agentId`,
  `payload`). Lets `/fleet history --json | jq` workflows feed into
  external tooling. Empty result becomes `[]` (no header), which is
  what jq users expect.
- Both flags combine cleanly. New `compileTypeFilter()` helper in
  `src/commands/handlers/fleet-handler.ts` converts the glob to a
  RegExp anchored at both ends. 5 new tests in
  `tests/fleet/fleet-handler.test.ts`.

### Added — /fleet status --with-sessions

- New flag on `/fleet status` that fans out `peer.chat-session.list`
  to every connected peer in parallel (5 s timeout each) and prints
  the open sessions inline under each peer block. Slow peers don't
  serialise the command — total elapsed ≈ max(per-peer latency), not
  sum.
- Output per peer block adds either `Chat sessions (N):` with one
  line per session (sessionId, turn count, idle, model), `Chat
  sessions: (none open on this peer)`, or `Chat sessions:
  (unreachable — <error>)` when the RPC failed (timeout, peer dropped
  the method, etc.).
- 5 new tests in `tests/fleet/fleet-chat-helper.test.ts` covering
  baseline `/fleet status` unchanged, populated session list, empty
  list, unreachable peer, and parallelism (slow + fast peer total
  near max not sum).

### Added — Fleet peer.chat-session.list

- **Read-only snapshot RPC** — `peer.chat-session.list` returns the
  in-memory sessions on a peer with metadata only: `sessionId`,
  `turnCount`, `model?`, `ageMs`, `idleMs`, `expiresInMs`. Useful for
  `/fleet status --with-sessions` and external monitors that want to
  know which conversations are open without sniffing content.
- **Privacy guarantee**: a test asserts the response NEVER contains
  the words `systemPrompt`, `messages`, or `content`, and NEVER
  exposes the actual prompt / assistant text the session is carrying.
- Calls `purgeExpired` before returning so callers never see ghosts.
- 5 new tests in `tests/fleet/peer-session-bridge.test.ts` covering
  empty state, multi-session metadata, privacy assertion, idle-purge
  before report, and `traceId` echo.

### Added — Fleet peer.chat-session.continue-stream

- **Streaming variant of `peer.chat-session.continue`** — mirrors the
  Phase d.19 `peer.chat-stream` pattern but reuses the session's
  multi-turn history. Each assistant delta is pushed via
  `ctx.emitChunk`; the final response carries the aggregated text +
  usage so transports without streaming support still get a usable
  answer. Same FIFO serialisation per session and same persistence /
  observability hooks as the non-streaming `continue`.
- Error handling: if the stream throws before producing any delta the
  user message is rolled back (consistent with `continue`); if some
  text was emitted before the error, it's persisted as the assistant
  message so the next turn sees what the model already said.
- 9 new bridge tests in `tests/fleet/peer-session-bridge.test.ts`
  covering delta forwarding, no-transport aggregation, multi-turn
  history accumulation across streaming + non-streaming, missing
  params, server errors with zero / partial deltas, and the
  `fleet:chat-session:turn` event.

### Added — Fleet privacy-lint PII patterns

- **SSN, IBAN, phone, credit-card detection** added to
  `src/fleet/privacy-lint.ts`. The router now flags prompts containing
  US Social Security numbers (with the SSA-reserved prefix block
  list), IBANs (FR/DE/etc., with or without space grouping), phone
  numbers (E.164 international + French national format), and credit
  card numbers (Visa/MC/Amex/Discover/JCB/Diners) validated through a
  Luhn checksum to keep false positives down.
- `pii-ssn` and `pii-credit-card` are high-confidence; `pii-iban` and
  `pii-phone` are low-confidence (caller decides whether to block or
  just downgrade `privacyTag` to `'sensitive'`).
- 10 new unit tests in `tests/fleet/privacy-lint.test.ts` covering
  positive cases, SSN reserved prefixes, Luhn rejection, and
  no-false-positive on benign sentences with numbers.

### Added — Fleet V1.2-saga + observability (Phase d.22)

- **Cross-restart session durability** — `peer.chat-session.*` state
  now persists to `~/.codebuddy/peer-sessions/<sessionId>.json` using
  the same lockfile + atomic-rename pattern as the saga store. On
  peer restart, sessions younger than `CODEBUDDY_PEER_SESSION_IDLE_MS`
  are re-hydrated before the RPC methods are registered; older
  entries are purged. Closes the V1.2 limitation explicitly deferred
  in the previous release.
  - New module `src/fleet/peer-session-store.ts` (~180 LOC) with
    `save / load / loadAll / delete / purgeExpired` and a
    test-injectable singleton (`_setPeerSessionStoreForTests`).
  - 14 unit tests in `tests/fleet/peer-session-store.test.ts`
    (round-trip, atomic write, corrupt-file resilience, TTL purge).
  - `wirePeerSessionBridge` is now `async`; the boot path in
    `src/server/index.ts` was updated accordingly.
- **`fleet:chat-session:*` observability events** — start / turn / end
  emitted on the fleet bus so `/fleet listen` consumers and
  `/fleet history` see chat-session activity.
  - `fleet:chat-session:start` carries `{ sessionId, model? }`.
  - `fleet:chat-session:turn` carries `{ sessionId, turnCount,
    elapsedMs, usage }`.
  - `fleet:chat-session:end` carries `{ sessionId, reason: 'end' |
    'expired' }` (so listeners distinguish explicit close vs TTL
    purge).
  - **Privacy guard**: payloads are metadata only — no prompt content,
    no assistant text, no system prompt. A unit test scans the
    aggregated payload blob for the words `prompt` / `messages` /
    `content` and the actual conversation strings to enforce this.
  - 3 new event types + wrappers in
    `src/server/websocket/fleet-bridge.ts`.
- 10 new unit tests in `tests/fleet/peer-session-bridge.test.ts`
  (hydrate at wire, persist on start/continue/end, history replay
  after restart, all 4 event paths, privacy assertion).

---

## [1.0.0-rc.8] — 2026-05-09 (afternoon)

**Cowork hardening session** — eight commits aimed at making the
end-to-end experience trustworthy after the rc.7 ship. Highlights:

### Fixed — critical regression

- **Dual-`mainWindow` bug** (commit `751f7eb6`). `cowork/src/main/index.ts`
  and `cowork/src/main/window-management.ts` each kept their own
  `let mainWindow: BrowserWindow | null = null`. Only the former was
  ever set; the latter's `getMainWindow()` (used by
  `ipc-main-bridge.ts:sendToRenderer()`) always returned `null`, so
  every IPC push from main to renderer (`stream.message`,
  `session.status`, `trace.step`, …) was silently dropped. The chat
  UI froze on "processing" forever; the only recovery was clicking
  "Repair transcript" which re-fetched messages over a different
  channel. Fixed by exporting `setMainWindow()` from
  `window-management.ts` and calling it after the BrowserWindow is
  created. The bridge now emits an error log if a future regression
  reintroduces the same shape.

### Fixed — server lifecycle

- **`@phuetz/ai-providers` inlined** (commit `5757b197`) into
  `src/providers/_shared/`. The workspace symlink was a footgun on
  any host that didn't have the sibling repo cloned (e.g. fresh
  Ministar Linux): `loadCoreModule('tools/registry/index.js')` failed
  silently because `utils/retry.js` couldn't resolve the import.
- **Core DB initialization before startServer** (commit `cc2d2260`).
  `ServerBridge.start()` now calls `getDatabaseManager().initialize()`
  before `startServer()` so `/api/health.checks.database` doesn't
  return 'error' on first boot.
- **Runtime JWT_SECRET fallback**. Auth middleware throws at
  module-load under `NODE_ENV=production` if the env var is missing.
  ServerBridge mints a 64-byte hex secret at boot if none is
  persisted (single-user fallback; tokens don't survive a Cowork
  restart unless the user persists a secret in Settings → Server).
- **`health.checkApi` accepts every provider** (commit `cc2d2260`).
  The original check returned 'error' for any user not setting
  `GROK_API_KEY`. Now accepts `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
  `GEMINI_API_KEY`, `XAI_API_KEY`, or any loopback `OPENAI_BASE_URL`
  (Ollama / LM Studio).

### Added — UX

- **Live API heartbeat monitor** (commit `f14cc8c4`). `/api/health.apiHeartbeat`
  now shows real `lastCheck` + `latencyMs` + status. A 30 s probe
  loop in `src/server/heartbeat-monitor.ts` pings the configured
  provider and stamps `updateApiHeartbeat`.
- **Settings → Embedded server** (commit `b7ca5fb4`). New
  `SettingsServer.tsx` lets users configure port, host, websocket,
  and a persistent JWT secret. Apply triggers a stop/start cycle.
- **Cold-start indicator + elapsed counter** (commit `0765e3e9`).
  The "processing" spinner now shows live elapsed seconds and an
  italic sub-line at 5 s+ ("Loading model or generating thinking")
  + a warning at 30 s+ ("Cold start in progress"). Particularly
  useful with Ollama qwen3.6:35b which routinely takes 60–120 s on
  first run.
- **Help icon (?) in titlebar** + keyboard shortcuts dialog rewrite
  (commits `e419862a`, `cbaeada9`). 24 shortcuts across 6 sections
  with autofocus search, filter, and platform-aware glyphs (⌘/⌥/⇧).
- **Power button (⏻) in titlebar** (commit `45c4bb60`). Toggles the
  embedded HTTP server; visual indicator shows running/stopped/error.
- **Tool selector V2 in WorkflowEditor** (commit `4094d60b`).
  Combobox with autofocus search, grouping by category, keyboard
  navigation, and inline descriptions.
- **ApprovalDialog enriched** (commit `59859753`). When a workflow
  approval payload includes the upcoming tool name + JSON input, the
  dialog renders a preview and flags destructive patterns
  (rm -r[Rf], chmod 777, eval, sudo, mkfs, fork bomb, curl|bash,
  `git push --force`, DROP DATABASE, …).
- **Hooks `agent` dry-run** (commit `f5629cdc`). The last mock branch
  in `hooks-bridge.ts:test()` is closed: `agent` handlers now spawn
  a real sub-agent via `dryRunSubAgent()` with a 10 s timeout.

### Added — docs

- `cowork/docs/architecture.md` — mermaid diagram of main/preload/
  renderer + bridges + core, listing every IPC namespace, persistent
  state path, and the dual-mainWindow regression.
- `cowork/docs/dev-linux.md` — iterative dev loop on Linux: skip
  `npm run build`, use `npx vite build` (~30 s), boot Electron with
  `--no-sandbox --disable-gpu`, electron-rebuild instructions, and
  common gotcha table.

### Tests

- 12 hooks dry-run cases (3 command + 5 http + 4 prompt + 3 agent).
- Cowork E2E smoke driven via CDP confirmed all chat + workflow
  paths in real Electron after the mainWindow fix.

---

## [1.0.0-rc.7] — 2026-05-09

**Cowork visual workflows now executable** — closes the gap identified
by the Cowork audit (`journal/ministar-ubuntu-grok-cli.md`). The
WorkflowEditor saved DAGs but the runtime was a noop. Now wraps the
core `Orchestrator` (`src/orchestration/orchestrator.ts`) with a
4-agent pool that fulfils tool/approval steps. Validated end-to-end
through Electron on Linux + DISPLAY=:10.0 + CDP-driven test injection.

### Added — Cowork (workflow execution)

- **WorkflowEditor V1 execution** (`cowork/src/main/workflows/`):
  - `workflow-bridge.ts` (rewrite, ~440 LOC) — replaces the previous
    `WorkflowEngine` wrapper that mapped every tool node to `noop`.
    Now compiles the visual DAG, registers a 4-agent worker pool
    against the core `Orchestrator`, dispatches `task_assigned`
    events to a `CoworkToolAgent`. Two runtime bugs caught by an
    advisor pass and fixed before ship: the `processQueue` deadlock
    after `queueTask` (fixed via `task_created` listener +
    `queueMicrotask`), and the listener-order issue where the
    `workflow_started` global handler fired before the run-scoped
    capture handler had populated the instanceId↔workflowId map
    (fixed via `prependListener`).
  - `dag-compiler.ts` (new, ~280 LOC) — Kahn topo-sort + automatic
    branch detection for `parallel` (≥2 outgoing edges) and
    `condition` (true/false labelled edges).
  - `cowork-tool-agent.ts` (new, ~180 LOC) — fulfils `tool_invoke`
    (delegates to `FormalToolRegistry.execute`) and `approval_wait`
    (suspends until renderer signals via `workflow.approve` IPC,
    with configurable timeout).
  - `ApprovalDialog.tsx` (new, ~95 LOC) — modal driven by
    `pendingApprovals[0]` from the store, with countdown timer +
    Approve/Reject buttons.
  - `WorkflowEditor.tsx` Inspector enriched: per-node-type config
    (tool: dropdown of toolName + JSON input ; condition: expression ;
    approval: message + timeout). Runtime overlay: each node's
    stroke colours by status (running = pulsing blue, completed =
    green, failed = red).

- **WorkflowEditor V0.5 — loop nodes + convergence** (commit
  `2dd2d987`):
  - New `WorkflowNodeType = 'loop'` with `body` + `exit` outgoing
    edges; iteration is delegated to the core engine. Documented
    one-tick lag in the README + integration test.
  - `parallel` and `condition` blocks can now rejoin on a shared
    "join" node before continuing the main chain. The
    `findJoinTarget` helper validates branches all converge on the
    same node (or all flow to `end`); heterogeneous topologies throw
    `CompilationError`.

- **`registerBuiltinTools(registry)` export in
  `src/tools/registry/index.ts`** (commit `6c5e39f6`) — synchronous
  counterpart of `createAllToolsAsync()` that does NOT initialize
  MCP. Called by `WorkflowBridge.ensureOrchestrator()` so visual
  workflow tool nodes find their tools (the registry singleton was
  empty when accessed from outside a CodeBuddyAgent session).

### Added — Cowork (Hooks dry-run)

- **HTTP hook dry-run** (`cowork/src/main/hooks/hooks-bridge.ts`):
  `test()` now POSTs a synthetic body (`{tool:'sample',
  event:'PreToolUse', dryRun:true, cwd}`) with header
  `X-CodeBuddy-Hook-DryRun: 1`, AbortController-driven timeout, body
  capped at 64 KB, user-supplied `handler.headers` forwarded. The
  Test button in `SettingsHooks.tsx` now appears for both `command`
  and `http` types.

### Added — Server (cherry-pick from `feat/face-memory-cowork`)

- **Channel-A2A bridge** (`src/server/channel-a2a-bridge.ts`, 220 LOC,
  cherry-pick `f3b9b984`) — auto-loads channels from
  `.codebuddy/channels.json` and forwards inbound messages to the
  A2A router via HTTP self-call. Replaces the standalone
  `scripts/telegram_a2a_spoke.py` wrapper.

### Added — Cowork (presence)

- **Buffalo_S downloader scripts** (`cowork/scripts/download-buffalo-s.{ps1,sh}`,
  cherry-pick `15e1e9f8`) — idempotent CLI installers for the
  ArcFace ONNX model, complementing the in-app
  `ModelInstallDialog`. README rewritten to document all three
  install paths (in-app dialog, helper scripts, manual file picker).

### Tests

- **34 new Vitest cases** for the workflow pipeline:
  - 15 dag-compiler (linear, parallel, conditional, approval, loop,
    convergence + all rejection paths)
  - 8 cowork-tool-agent (tool_invoke, approval_wait lifecycle)
  - 6 workflow-bridge integration with a real `Orchestrator` core
    (covers the deadlock + listener-order regressions, V0.5 loop
    3-iter, V0.5 parallel-join)
  - 5 hooks-bridge HTTP dry-run (200, 404, timeout, invalid URL,
    custom headers)
- **9 new server/channel-a2a-bridge tests** (cherry-picked).

### Notes

- `rc.7` is **not tagged in this commit** — `release.yml` triggers on
  `v*` and would publish the *root* package (`@phuetz/code-buddy`),
  not Cowork. To release Cowork separately, either narrow the trigger
  in `release.yml` to `v*-cowork` or publish manually from the cowork
  workspace.

---

## [1.0.0-rc.6] — 2026-05-08

**Sixth release candidate** — multi-Claude fleet activation +
embodiment closure + V0.5 multi-agent enforcement. Eleven features
shipped over the May 7-8 session, organised in three stacked branches.

### Added — Cowork (face memory + UX)

- **Presence V0.5 — live titlebar identity** (`cowork/src/renderer/components/PresenceIndicator.tsx`).
  Main-process `PresenceBridge` events (`presence:detected/left/unknown/enrolled`)
  forwarded to the renderer via a new `presence:event` IPC channel. Zustand
  slice `currentPresence` drives a live "🟢 👋 {name} ({pct}%)" badge,
  unknown-face badge, and enrolled-count fallback.

- **Presence V0.6 — proactive greeting toast**. PresenceService tracks
  `lastGreetedPersonId`; first detection of a new person fires
  `addNotification({ title: '👋 Bonjour', body: '{name} est devant la caméra.' })`.
  Reset on `presence:left` so returning persons get re-greeted. Reset on
  service `stop()`.

- **Auto-download Buffalo_S UX** — `EnrollmentDialog` probes
  `presence.hasModel()` at open; if missing, opens `ModelInstallDialog`
  before taking the camera. The reactive fallback at the encode call
  site stays as a safety net.

- **OrchestratorLauncher wiring** (Phase d.17 frontend) — modal trigger
  for the multi-agent orchestrator, surfaced via the Sparkles button
  in Titlebar and Cmd/Ctrl+Shift+M.

### Added — Fleet & multi-AI orchestration (Phases (d).17 → (d).20)

- **Phase (d).17 — `peer_delegate` + `list_peers` LLM tools**. Two new
  tool-registry entries that let the LLM autonomously delegate a
  one-shot question to a connected fleet peer Code Buddy and read the
  response back in its tool result. Wraps `peer.chat` (Phase d.15).
  Anti-loop guards: `CODEBUDDY_PEER_ROLE=leaf` refusal, per-turn cap
  (default 5, env `CODEBUDDY_PEER_DELEGATE_MAX_PER_TURN`), depth cap
  via existing `MAX_DEPTH_EXCEEDED`. `<fleet>` system-prompt nudge
  injected when peer count > 0 (zero tokens otherwise). Refacto:
  `activeListeners` Map promoted to `src/fleet/fleet-registry.ts`
  singleton (17 references migrated, 43/43 fleet-handler regression
  tests intact). 28 new tests.

- **Phase (d).18 — Autonomous Fleet Protocol v0.1 (native TS port)**.
  `src/agent/autonomous/{fleet-task-types,fleet-tick-handler}.ts`
  ports the operational python wrapper
  `claude-et-patrice/tools/heartbeat_tick.py` (proven over 6 cycles
  on 2026-05-02). Pull → FLEET_PAUSE check → pickTask (priority
  cascade, critical SKIPPED for autonomous) → atomic claim → in-process
  agent run → scope guard → worklog → mark completed → push.
  TOML `[autonomous_fleet]` block + boot wiring in `codebuddy-agent.ts` +
  `/fleet autonomous status|tick-now` slash sub-commands. 26 new tests
  covering all outcomes (FLEET_PAUSE, dirty repo, claim_lost,
  out_of_scope rollback, timeout, priority threshold).

- **Phase (d).19 — `peer.chat-stream` V1.1**. Wire-level: new
  `peer:chunk` frame + `emitChunk` in `PeerMethodContext`. Server-side
  `peer.chat-stream` method calls `client.chatStream()` and pushes
  deltas via `ctx.emitChunk` while still returning the aggregated text
  in the final `peer:response`. Client-side
  `FleetListener.requestStream(method, params, onChunk, options)`
  routes per-request `peer:chunk` frames to the callback. Falls back
  to local aggregation when transport doesn't support streaming.
  9 new tests.

- **Phase (d).20 — Autonomous v0.2: Ollama spokes**.
  `resolveProviderFromEnv()` public helper on
  `peer-chat-client-factory.ts` returns `{ provider, apiKey, baseUrl,
  model, isLocal }` for non-`peer.chat` consumers (e.g.
  `CodeBuddyAgent`). New `FleetTask.preferLocal` hint +
  `WorklogFileEntry.{provider, model}` for cost audit. New
  `[autonomous_fleet].llm_provider` TOML field
  (`'cloud'` default V0.1 / `'auto'` / explicit provider id) +
  `resolveTickProvider()` priority cascade
  (`preferLocal` → `llm_provider` → GROK fallback). `/fleet autonomous status`
  shows resolved provider preview. 12 new routing tests.

### Added — Wake dormant code (Phase (d).21, three ships)

- **NotificationManager wake** (Tier D-1).
  `src/agent/proactive/notification-default-sink.ts` exposes
  `notify()` / `notifyQuick()` helpers that apply `shouldSend()` gates
  (channel allowlist, quiet hours, rate limit) and log via
  `logger.info`/`warn`. `wireDefaultNotificationSink()` boot-time
  registration. `agent-executor` fires a notification after every tool
  completion (low priority on success, high on failure). 8 new tests.

- **progress-tracker wake** (Tier D-2).
  `src/agent/planner/progress-default-sink.ts` exposes a process-level
  singleton + log-based default sink that emits at 25/50/75/100
  thresholds (avoids per-tool log spam).
  `agent-executor.runTurnLoop()` calls `progress.start(maxToolRounds)`
  at loop entry and `progress.update()` per tool completion. 8 new
  tests.

- **V0.5 metrics TTL enforcement** (Tier C-3). Replaces the warn-only
  branch in `enhanced-coordination.ts:enablePersistence()` with
  `await clearMetrics()` + `initializeMetrics()` reset when
  `ageDays > metricsTtlDays`. Stale metrics no longer bias allocation
  across process restarts. 5 new tests; existing
  `persistence-integration.test.ts` updated to assert the new
  enforcement behaviour.

### Tests

- 75+ new tests across the three branches; full session test count
  growth is 27,366 / 27,366 + audit follow-ups in V1.0.0 final.
- TypeScript clean (root + cowork); existing fleet/agent regression
  suites (43 + 44 + 18 + …) all green.

---

## [1.0.0-rc.5] — 2026-05-04

**Fifth release candidate** — convergence Manus AI. Two ships post-rc.4
that complete the persistence trilogy (auto-memory + lessons + writing
discipline) and adopt Manus AI's structured prompt blocks pattern. Both
ships followed the now-established "wake dormant code via system
directive + RAG always-include" recipe — 7th and 8th iterations of the
session pattern.

The session as a whole: 4 release candidates (rc.2 = 6 ships, rc.3 = 3
ships, rc.4 = 4 ships, rc.5 = 2 ships) = 15 functional commits + 4
release commits + 2 audit docs. The releases pattern is now an operating
rhythm: ship narrow → bump version → repeat.

### Added
- **`<writing_rules>` system prompt directive** — proactive output
  discipline inspired by Manus AI's structured prompt blocks pattern
  (gist `renschni/4fbc70b...`, May 2026 reverse-engineering of Manus AI).
  Complements `output-sanitizer.ts` (post-hoc strip) by instructing
  the LLM BEFORE generation: never emit control tokens (`<|im_start|>`,
  `<think>`, GLM-5 brackets, etc.), no zero-width chars, markdown
  structure (code fences with language hint, file:line references for
  navigability), no meta-commentary ("As an AI..."), no gratuitous
  emoji, prefer "I don't know" over fabrication. Always-on (no
  memoryEnabled gate — output discipline is universal). 4 new tests in
  `tests/services/prompt-builder.test.ts`. The 7th iteration of the
  "system directive narrow ship" pattern this session — closes the
  Manus AI structured-blocks gap (Option B; Option A = full refactor
  with `<browser_rules>`/`<shell_rules>`/`<system_capability>` blocks
  remains deferred V1.x as it requires extensive validation).

- **Lessons feature activation (Manus AI-inspired)** — system-prompt
  `<lessons_directive>` + RAG always-include for `lessons_add` /
  `lessons_search` + removal of the complexity gate that dropped lessons
  context on trivial multi-round queries. Mirror of the `a2a4f72`
  auto-memory activation pattern. The Manus AI-inspired feature
  (`src/agent/lessons-tracker.ts`, 405 lines) was complete but dormant —
  the LLM never proactively called the tools because no system directive
  told it WHEN. This ship surfaces the 4 categories
  (RULE / PATTERN / CONTEXT / INSIGHT) with explicit triggers ("after
  user correction", "before similar tasks search lessons first"), and
  differentiates `lessons_add` from `remember` (lessons = actionable
  patterns + rules; remember = facts + preferences). 4 new tests in
  `tests/services/prompt-builder.test.ts`. The 6th iteration of the
  "wake dormant code" pattern this session — completes the persistence
  trilogy: auto-memory (facts) + lessons (patterns) + ICM (cross-session
  episodic, managed elsewhere).

---

## [1.0.0-rc.4] — 2026-05-04

**Fourth release candidate**. Four ships post-rc.3 focused on the
**conversational subagent surface**: a fresh audit of Claude Code's
source (now available locally), Phase A+C implementation closing the
audit, two new user-facing slashes (`/subagent` for discovery,
`/swarm` for one-command team-lead spawning inspired by Korben's
article on Claude Code's hidden Swarms mode).

The releases pattern of the session continues: rc.2 (6 ships), rc.3
(3 ships), rc.4 (4 ships). All narrow, all tested, all building on
existing infrastructure rather than inventing new modules.

### Added
- **`/swarm <task>` slash command** — UX wrapper around the existing
  `MultiAgentSystem` (V0.4) that exposes the team-lead pattern in one
  memorable command. Forces strategy=parallel for the run, delegates
  to `/agents run`, restores the user's previous strategy in a finally
  block. Inspired by Korben's article on Claude Code's hidden Swarms
  mode (`tengu_brass_pebble` flag + `claude-sneakpeek` patch) — Code
  Buddy ships the infrastructure built-in (`WorkflowOrchestrator` +
  `ParallelSubagentRunner`, max 10 workers), so no patching needed.
  Sub-actions: `/swarm <task>` (dispatch), `/swarm stop`, `/swarm status`,
  `/swarm help`. Two new internal helpers exported from agents-handler:
  `_peekActiveStrategy` / `_setActiveStrategy` (underscore-prefixed,
  not for user-facing slash). 11 new tests (mocking handleAgents +
  strategy state). Documentation added to `getting-started.md` under
  "Local swarm (no peers needed)" — pointers from Fleet section so
  users discover both options together.

- **`/subagent` slash command + `code-reviewer` hardening** — surfaces
  the `PREDEFINED_SUBAGENTS` registry to users. `/subagent list` shows
  the 7 predefined subagents (Explore, code-reviewer, debugger, etc.)
  with their tools whitelist + disallowedTools blacklist; `/subagent
  info <name>` shows full details including system prompt preview.
  Read-only handler (no spawn — main agent handles spawning via tool).
  Closes the UX gap that left the `Explore` subagent shipped in `4ae5a07`
  invisible to users (`/agent` is for custom agents, `/agents` for
  MultiAgentSystem; `/subagent` is the new third surface for the
  conversational subagents). Bonus: `code-reviewer` now has the same
  `disallowedTools` blacklist treatment as Explore (defense-in-depth
  against custom configs that might extend the whitelist), plus a
  short READ-ONLY MODE statement at the top of its system prompt.
  11 new handler tests + 1 new code-reviewer test.

- **`Explore` subagent (read-only-strict) + `disallowedTools` field on
  `SubagentConfig`** — implements **Phase A + Phase C** of the Claude Code
  subagent audit (`AUDIT-CLAUDE-CODE-SUBAGENT-2026-05-04.md`). Reuses the
  existing `src/agent/subagents.ts` infrastructure (already had
  `SubagentManager`, `ParallelSubagentRunner`, whitelist filtering — turns
  out Code Buddy's subagent infra was more mature than I'd realized).
  Three reinforcements:
  1. New `disallowedTools?: string[]` field on `SubagentConfig` —
     defense-in-depth blacklist applied AFTER the whitelist filter in
     `Subagent.run()`. Pattern from Claude Code's
     `BuiltInAgentDefinition.disallowedTools` (exploreAgent.ts:67-73).
  2. New `"Explore"` (capital-E) entry in `PREDEFINED_SUBAGENTS` with
     a strict READ-ONLY MODE system prompt (adapted from Claude Code's
     `exploreAgent.ts:13-57`), `tools: ["view_file", "search"]` whitelist,
     and `disallowedTools: ["bash", "str_replace_editor", "create_file",
     "apply_patch", "delete_file"]` blacklist.
  3. Legacy `"explorer"` lowercase alias kept for backward compat AND
     gets the same hardening (was a silent loophole pre-rc.4: bash was
     in the whitelist so `mkdir`/`rm` worked on a "read-only" agent).
  10 new tests (`tests/agent/subagents-explore-readonly.test.ts`).
  60/60 existing subagent tests still pass. Phase B (architectural
  enforcement layer) deferred — the whitelist+blacklist combo covers
  enforcement needs for V1.

### Audit shipped
- **Claude Code subagent + plan mode audit**
  (`claude-et-patrice/propositions/AUDIT-CLAUDE-CODE-SUBAGENT-2026-05-04.md`,
  268 lines) — 3rd iteration of the audit-doc pattern, this time with
  direct access to the Claude Code source (`D:\CascadeProjects\claude-code-source-code-main`).
  Audited 4 zones: plan mode workflow phasé (⚠️ partial), structured user
  questions (✅ complete parity), subagent specialization (⚠️ partial — the
  central gap), background scheduling (⚠️ partial). Identifies 3-phase
  adaptation roadmap; **Phase A + Phase C shipped in this release** via
  the Explore subagent + disallowedTools field above. Pattern produced
  5 ships across the 3 audits done this session.

### Notes for V1 final (1.0.0)
Same items as rc.3, narrowed by what shipped here:
- Live smoke test of `peer.chat` with ≥2 providers on ≥2 hosts still
  pending (operator validation, hub-pull blocker on Ministar Linux)
- `withStreamRetry` activation by default deferred until ≥1 week of
  opt-in observation without regressions
- Migration of `agent-executor.ts:636` and `:844` to `getCuratedHistory()`
  deferred (would close the latent compression-without-repair gap)
- Phase B of the subagent audit (architectural enforcement layer)
  deferred — the whitelist+blacklist combo covers V1 needs
- Vue agrégée des 7 sources mémoire deferred
- Mode `buddy init --update` deferred
- `/swarm` shared task board between subagents deferred (TodoWrite is
  main-agent only)

---

## [1.0.0-rc.3] — 2026-05-04

**Third release candidate**. Three follow-up ships after rc.2 closing the
final Gemini CLI audit recommendation, surfacing the auto-memory feature
in `/status`, and turning `getting-started.md` into an actionable
playbook so new users (and other Claudes discovering the project) can
be productive in 5 minutes.

### Added
- **`MessageHistoryManager.getComprehensiveHistory()` /
  `getCuratedHistory()`** (`d7472e1`) — explicit raw-vs-curated
  distinction at the facade layer (`src/agent/facades/message-history-manager.ts`).
  Closes the **third and final** Gemini CLI audit recommendation
  (`AUDIT-GEMINI-CLI-AGENTIC-LOOP-2026-05-04.md` reco #3) — all 3 of 3
  recommendations now shipped (recos #1 + #2 closed in rc.2 via
  `cd653ab`/`2a06864`/`7ec4bc0`). Comprehensive returns raw stored
  history (debug, audit). Curated applies `repairToolCallPairs()` from
  `src/context/transcript-repair.ts` — orphan tool_results removed,
  lost tool_calls get synthetic `[result lost during compaction]` stubs.
  Compression is intentionally NOT applied (model-specific, lives in
  `ContextManagerV2`). Internal state never mutated. **Additive only**:
  no existing callers migrated (deferred V1.0.0 final to limit blast
  radius). Posed the foundation for the T6 test backlog: 9 new tests in
  `tests/agent/facades/message-history-manager.test.ts` — first
  dedicated test file for this facade.
- **`/status` Memory section** (`0afc199`) — extended the existing
  `handleStatus` (`src/commands/handlers/missing-handlers.ts:837`)
  with a one-line Memory dashboard cell showing `N project • N user •
  last update: …`. Surfaces the auto-memory writeback (rc.2 `a2a4f72`)
  without typing `/memory recent`. Silent skip on missing data
  (memory section is best-effort, never blocks the rest of the
  dashboard from rendering). 4 new tests covering empty state,
  populated state with relative time, error fallback, and footer hint.
- **`docs/getting-started.md` extensions** (`dc1f7eb`) — entry doc
  extended from 122 → 244 lines. Three new sections close the
  "Code Buddy utilisable + les Claudes peuvent l'utiliser pour
  dialoguer" gap Patrice explicitly flagged:
  - **Auto-memory** — explains the proactive `remember` writeback
    with concrete examples and inspection commands. Mirrors the
    Claude Code MEMORY.md UX pattern.
  - **Talking to other Claudes (Fleet)** — 30-second quickstart
    (`buddy server` listener side, `/fleet listen ws://...` peer side).
    Calls out the two stated objectives (real-time inter-AI
    collaboration + pilot local LLMs from any peer over Tailscale).
    Points to `fleet-guide.md` for depth.
  - **Troubleshooting** — 9 issues with diagnosis + fix (401, ESM,
    slow startup, stale lock files, permission prompts, memory not
    persisting, fleet AUTH_FAILED, fleet drops, ripgrep, mid-stream
    errors). Plus pointers to `buddy doctor`, `fleet-guide.md`,
    CHANGELOG, GitHub Issues.

### Notes for V1 final (1.0.0)
Same items as rc.2, narrowed by what shipped here:
- Live smoke test of `peer.chat` with ≥2 providers on ≥2 hosts still
  pending (operator validation, hub-pull blocker on Ministar Linux)
- `withStreamRetry` activation by default deferred until ≥1 week of
  opt-in observation without regressions
- Migration of `agent-executor.ts:636` and `:844` to `getCuratedHistory()`
  deferred (would close the latent compression-without-repair gap but
  touches the agentic loop core)
- Vue agrégée des 7 sources mémoire deferred
- Mode `buddy init --update` deferred
- `/memory recent` color polish deferred (small follow-up)

---

## [1.0.0-rc.2] — 2026-05-04

**Second release candidate**. Six narrow ships during a single session
focused on three axes Patrice flagged: agentic loop hardening, memory
management ("très important"), and cross-CLI fleet alignment.

### Added
- **Auto-memory writeback** (`a2a4f72`) — system-prompt directive teaches
  the LLM when to call the `remember` tool; RAG selector force-includes
  it in the always-available list. The LLM now proactively persists user
  preferences, architectural decisions, and non-obvious gotchas to
  `.codebuddy/CODEBUDDY_MEMORY.md` (project) or `~/.codebuddy/memory.md`
  (user) without explicit user intervention. Same UX pattern as Claude
  Code's auto-managed `MEMORY.md`. Gated on `memoryEnabled +
  persistentMemory` being wired (no-op when the markdown backend is
  absent).
- **`/memory recent [N] [scope?]`** (`b2424cc`) — recency view on the
  persistent memory store. Shows the last N entries (default 10, max 50)
  sorted by `updatedAt` desc, with relative timestamps ("2 minutes ago")
  and category. Scope filter (`project` | `user`) optional. UX surface
  for the auto-memory feature: Patrice can see in one command what the
  LLM just persisted and `/memory forget` what is noise.
- **`AGENTS.md` cross-CLI scaffold** (`841bd0b`) — `buddy --init` now
  generates `AGENTS.md` at the project root. This is the emergent
  cross-CLI convention file read by Claude Code, Gemini CLI 0.20+,
  Cursor, Codex, and Code Buddy itself (already wired in
  `jit-context.ts` and `bootstrap-loader.ts`). Minimal "30-second
  first-glance" guide with build/test/lint commands, conventions,
  architecture, and pointers to `.codebuddy/CONTEXT.md` /
  `.codebuddy/CODEBUDDY.md` for detail. Idempotent (skip on re-run,
  `--force` overwrites). Lives at root so it is committed alongside
  the codebase, not gitignored under `.codebuddy/`.
- **`withStreamRetry` helper** (`cd653ab`) — pure async-generator wrapper
  with exponential backoff retry on retryable network errors
  (ECONNRESET, ETIMEDOUT, "socket hang up", undici stream terminated).
  Default predicate covers Node network codes + undici / fetch error
  names; non-retryable errors (auth, validation, 4xx semantic) propagate
  immediately. AbortSignal-aware. Standalone module
  (`src/codebuddy/stream-retry.ts`), 26 tests covering happy path,
  retry-then-succeed, exhaustion, custom predicate, exponential backoff
  timing (with fake timers), abort during retry wait. Derived from the
  comparative audit Gemini CLI vs Code Buddy
  (`AUDIT-GEMINI-CLI-AGENTIC-LOOP-2026-05-04.md`, recommendation #1).
- **`processUserMessageWithStreamingEvents`** (`7ec4bc0`) — new
  collector method on `agent-executor.ts` that returns
  `{ entries, streamingEvents }`, allowing sequential callers to access
  streaming-only events (`ask_user`, `tool_stream`, `token_count`,
  `reasoning`, `steer`) that the existing `processUserMessage` silently
  drops. Backward compat: existing method unchanged. Closes Gemini CLI
  audit recommendation #2.

### Changed
- **`CodeBuddyClient.chatStream`** (`2a06864`) — wraps the dispatch
  (Gemini-native or OpenAI-compat strategy) in a generator factory and
  applies `withStreamRetry` when opt-in is active. Opt-in resolution
  order: per-call `ChatOptions.streamRetry` (boolean or
  `{ maxAttempts, initialDelayMs, maxDelayMs }`) wins when explicitly
  set (including `false`), else env var `CODEBUDDY_STREAM_RETRY=1`,
  else no retry. Default off — full backward compat. Trade-off
  documented: a retried stream restarts from the beginning, so callers
  see duplicated chunks across the retry boundary (matches Gemini CLI
  behavior; true delta-resume requires LLM-level support not available
  today). 6 wirage tests on top of the 26 helper tests.
- **`ChatOptions`** — new optional `streamRetry?: boolean | {…}` field
  documenting the per-call opt-in path and the env var fallback.

### Fixed
- **`alwaysInclude` propagation in tool selector** — `getRelevantTools`
  in `src/codebuddy/tools.ts` accepted the option but silently dropped
  it before reaching `selectRelevantTools` (the convenience function in
  `src/tools/tool-selector.ts:778` only forwarded `maxTools`). Strategy
  callers like `tool-selection-strategy.ts` thought their `alwaysInclude`
  list was honored — silently was not. Fixed by extending the
  `selectRelevantTools` signature with `alwaysInclude?: string[]` and
  propagating through `getRelevantTools`. Latent bug, surfaced while
  shipping auto-memory (`remember` had to be force-included for RAG to
  always show it).

### Audit follow-ups closed
Post-Gemini-CLI-source audit
(`claude-et-patrice/propositions/AUDIT-GEMINI-CLI-AGENTIC-LOOP-2026-05-04.md`):
- Reco #1 (mid-stream retry exponential backoff) — helper `cd653ab` +
  wirage `2a06864`
- Reco #2 (streaming events visibility in sequential mode) — `7ec4bc0`
- Reco #3 (history curation explicit `getComprehensiveHistory` vs
  `getCuratedHistory`) — deferred V1.x

### Notes for V1 final (1.0.0)
- Live smoke test of `peer.chat` with ≥2 providers on ≥2 hosts still
  pending (operator validation, hub-pull blocker on Ministar Linux)
- `withStreamRetry` activation by default deferred until ≥1 week of
  opt-in observation without regressions
- Vue agrégée des 7 sources mémoire deferred (Persistent + Enhanced +
  Lessons + Decision + KG + ICM + Auto-capture)
- Mode `buddy init --update` (preserve user edits via marker comments)
  deferred — needs structural markers in generated files
- Smoke test E2E auto-memory deferred (full agent boot too costly)

---

## [1.0.0-rc.1] — 2026-05-04

**Release candidate**. Signal that Code Buddy is approaching its first
stable major release. The core feature set is now complete:
- Multi-provider AI agent (15 providers via OpenAI-compat routing,
  plus native Gemini, plus Ollama/local)
- Multi-agent orchestration (V0.4.1 with conflict auto-resolve,
  adaptive allocation, WorkflowOrchestrator)
- **Multi-AI fleet hub** (Phases (d).1 → (d).16a) — peers can
  `/fleet listen` to each other's events and `/fleet send peer.chat`
  to invoke each other's LLMs over WebSocket
- Comprehensive test plan T1-T5 closed (CRITIQUE-priority modules
  at ≥93% coverage)
- Two source-comparative audits (OpenClaw v2026.3.x → v5.2 + Claude
  Code source compaction) feeding actionable improvements
- 27 500+ tests passing across the repo

### Added in 1.0.0-rc.1 (V1-readiness phases)
- **V1.1** (`50dd511`): Initial CHANGELOG.md (Keep-a-Changelog format)
  covering 0.4.x → 0.5.0 → 0.5.0-fleet-infrastructure → 0.5.1-fleet
- **V1.2** (`a968695`): `docs/fleet-guide.md` — comprehensive guide for
  the multi-AI hub: 2 stated objectives (real-time inter-AI collaboration
  + pilot local LLMs), all slash commands, all peer-rpc methods, env
  config, lab examples, smoke test recipe, security model, V1.x roadmap
- **V1.3** (`b3fc4e8`): Wire adaptive auto-compact helper as opt-in
  config flag `useAdaptiveBuffer`. Default false (backward compat).
  Closes the loop on audit fix #1.
- **V1.4** (`a74bbb1`): Underscore-prefix 8 pre-existing unused-var
  lint warnings (server/index.ts catch params + smart-compaction.ts
  unused fn args). Mechanical fix, 0 behavior change.
- **V1.5** (this commit): Version bump 0.5.0 → 1.0.0-rc.1.
  README.md mentions the fleet hub in the lead paragraph.
  CLAUDE.md header notes the V1 RC status. CHANGELOG.md adds this
  entry.

### Notes for V1 final (1.0.0)
Going from rc.1 to 1.0.0 requires:
- Live smoke test of `peer.chat` with at least 2 different providers
  on at least 2 different hosts (operator validation)
- Optional: rate cap (d).16b if burn-rate problems are observed live
- Optional: audit Gemini CLI source / Codex source for one more round
  of comparative improvements
- Operator decision (Patrice) on the cut date

The rc.1 ship is intentional: signal the V1 intent without
pre-committing to "stable" before live multi-host validation.

---

### Backlog (not yet shipped)

- **Streaming `peer.chat-stream`** (V1.1) — current `peer.chat` is one-shot
  request/response. Streaming will let consumers see tokens as they arrive.
- **Multi-tour `peer.chat-session`** (V1.2) — `start` / `continue` / `end`
  for stateful conversations between peers.
- **Rate cap `peer.chat`** ((d).16b) — deferred until burn-rate problems
  observed live; the Gemini Ultra quota (~50M tokens/month) is generous
  enough to test without one for now.
- **Audit Gemini CLI source / Codex source** — applies the same
  comparative-audit pattern (used for Claude Code source) to other
  open-sourced agent runtimes.
- **Live smoke tests** for `peer.chat` with real provider keys (manual
  validation by the operator after each release).

---

## [0.5.1-fleet] — 2026-05-04

The fleet inter-Claude shipped its first **business method**: peers
can now ask each other's LLM a one-shot question via
`/fleet send <peer> peer.chat`. Plus two follow-up fixes derived from
a comparative audit against Claude Code source code (publicly released
~one month ago, ~50,000 GitHub forks).

### Added

- **Peer RPC routing — Phase (d).15** (`4876142`):
  - `peer:request` / `peer:response` WS frames with id-correlation map
  - Built-in methods registered at boot: `peer.describe`, `peer.ping`,
    `peer.echo`
  - `FleetListener.request(method, params, options?)` API with
    REQUEST_TIMEOUT (default 30s), AUTH_FAILED, NOT_OPEN, DISCONNECTED
    error codes
  - New `peer:invoke` ApiScope (paired with the existing `fleet:listen`)
- **Env-driven multi-provider peer.chat client wiring — Phase (d).16a**
  (`568ceda`):
  - `createPeerChatClientFromEnv()` factory auto-detects which provider
    keys are present at server boot, in priority order:
    `CODEBUDDY_PEER_PROVIDER` override → `OLLAMA_HOST` → `GROK_API_KEY`
    → `ANTHROPIC_API_KEY` → `GOOGLE_API_KEY`/`GEMINI_API_KEY` →
    `OPENAI_API_KEY`. Local first to spare cloud quotas.
  - `wirePeerChatBridge()` now accepts a `providerInfo` second arg,
    surfaced via `peer.describe.peerChatProvider` so remote Claudes can
    discover which LLM lives behind a given peer.
  - `apiVersion` bumped from `d.15` to `d.16` in `peer.describe`.
- **Adaptive auto-compact threshold helper** (post-audit fix #1,
  `09d47d7`):
  - New `src/context/auto-compact-threshold.ts`. Pure module exposing
    `computeAutoCompactThreshold(maxContextTokens, model?, options?)`
    and `pickBufferTokens(model, options?)`.
  - Per-model buffer table (Claude Opus 16K, Sonnet 13K, Haiku 8K,
    Gemini Pro 13K, Flash 10K, Grok-3 12K, Grok-4 14K, etc.) with
    case-insensitive substring matching.
  - Resolution priority: explicit `bufferTokens` > per-call
    `bufferTokensByModel` > env `CODEBUDDY_AUTOCOMPACT_BUFFER_TOKENS`
    > default table > fallback.
  - Helper not yet wired into `ContextManagerV2.shouldAutoCompact`
    (deferred to V1.3 to stay narrow).

### Fixed

- **Tool pair preservation in truncation** (post-audit fix #3,
  `c05b5ea`): when `SmartCompactionEngine.truncateMessages` cuts the
  conversation between an assistant `tool_use` and its matching
  `tool_result`, downstream `validateToolCallOrder()` would silently
  strip the orphan. New pure helper `preserveToolPairs(kept, original)`
  re-injects the missing parent in original-order position. Pair
  integrity > strict budget compliance.

### Changed

- `peer.describe` payload now includes `peerChatProvider`
  (`{ provider, model, isLocal } | null`) so consumers can probe which
  LLM/model a peer will use before sending `peer.chat`.

### Tests

- 11 new tests for `peer-chat-bridge` ((d).15)
- 18 new tests for `peer-chat-client-factory` ((d).16a)
- 12 new tests for `tool-pair-preserver` (audit fix #3)
- 33 new tests for `auto-compact-threshold` (audit fix #1)

Total **874+ tests across `tests/server/` + `tests/gateway/` +
`tests/fleet/` + `tests/context/`**. Typecheck clean. Lint clean on
all touched files.

### Source audit

The comparative audit Claude Code source vs Code Buddy
SmartCompactionEngine is archived in
[`claude-et-patrice/propositions/AUDIT-COMPACTION-CLAUDE-CODE-2026-05-04.md`](https://github.com/phuetz/claude-et-patrice).
3 actionable improvements identified — #3 and #1 shipped, #2 (preview
mode before apply, M scope) deferred to `1.0.0` final.

---

## [0.5.0-fleet-infrastructure] — 2026-05-03

The day the inter-Claude fleet became real. 16 narrow phases shipped
in a single working day, plus 5 critical-priority test files. The
hardware setup (DARKSTAR PC 3090, MINISTAR G7 PT, Ministar Linux Ryzen
AI 9 HX 470) and Tailscale mesh (`100.x.x.x` private network) became
the first operational multi-AI hub on the lab.

### Added — Fleet inter-Claude (Phases (d).1 → (d).14)

- **Phase (d).1** (`d108d9b`): Server-side `fleet:*` event broadcast
  surface gated on the new `fleet:listen` ApiScope. WS plumbing only.
- **Phase (d).2** (`1fa6798`): `agent-executor` broadcasts tool exec
  events (`tool_started`, `tool_completed`, `tool_error`) to the fleet.
- **Phase (d).3** (`8632314`): `MultiAgentSystem` broadcasts workflow
  lifecycle events (`start`, `event`, `complete`).
- **Phase (d).4** (`1ff86f7`): Subagent session events (`spawn`,
  `message`) added to the fleet bus.
- **Phase (d).5** (`fa7432c`): Receiver side. `FleetListener` client +
  `/fleet listen` slash command.
- **Phase (d).6** (`98664d8`): `FleetListener` auto-reconnect with
  exponential backoff via the shared `ReconnectionManager`.
- **Phase (d).7** (`783157f`): Server-side broadcast backpressure with
  drop-on-overflow. Per-client `bufferedAmount` ceiling.
- **Phase (d).8** (`263dcf1`): Mirror of (d).7 for the Gateway WS
  surface (`src/gateway/ws-transport.ts`).
- **Phase (d).9** (`24f3031`): Peer presence beacon — periodic
  `fleet:peer:heartbeat` + `lastSeen` tracker + `⚠ stale` flag in
  `/fleet status`.
- **Phase (d).10** (`9b623b1`): Compaction lifecycle notices —
  `fleet:peer:compacting:start` / `:complete` bridged from
  `SmartCompactionEngine` events.
- **Phase (d).11** (`acc918a`): In-memory event history ring +
  `/fleet history [N] [--peer <name>]` slash.
- **Phase (d).12** (`f2a7a5a`): Multi-peer fan-in. `/fleet listen` can
  now hold N concurrent peers via a `Map<peerId, ActiveListener>`.
  Replaces the V0.4.1 single-peer singleton. New `--name <id>` arg.
- **Phase (d).13** (`6ede944`): Peer RPC routing. `/fleet send <peer>
  <method>` for active request/response between peers (mirror of
  OpenClaw's `node.invoke`, audited 2026-05-04).
- **Phase (d).14** (`9ca5b7e`): Role taxonomy + spawn depth cap +
  trace propagation. `CODEBUDDY_PEER_ROLE=main|orchestrator|leaf`,
  `CODEBUDDY_PEER_MAX_DEPTH` (default 3), `traceId` propagation
  end-to-end. Closes recursive-spawn risk.

### Added — Test plan T1-T5 (CRITIQUE coverage)

Audit-driven test plan, 5 zones identified as critical-without-coverage:

- **T1 — `permission-modes.ts`** (`9e9cd8f`): 38 tests, **100%
  coverage** all axes (statements / branches / funcs / lines).
- **T2 — `agent-context-facade.ts`** (`f9daa2b`, re-cadré ex-T3): 27
  tests, 100% lines, 91% branches. Lazy-init contract validated.
- **T3 — `model-routing-facade.ts`** (`88e4ea0`): 39 tests, 100% all
  axes. resolveModelForIntent priority cascade fully exercised.
- **T4 — `prompt-builder.ts`** (`a80d0ef`): 22 tests, 93% lines.
  Truncation budget guard validated incl. 32K hard cap edge.
- **T5 — `infrastructure-facade.ts`** (`3f4a224`): 17 tests, 96% lines.
  initializeMCP fire-and-forget paths covered.

Note on T2 re-cadrage: the original test plan T2 was `write-policy.ts`,
but it was already at 100% coverage with 19 existing tests (audit false
negative). Promoted T3 to T2 and shifted the rest.

### Source audits (2026-05-03)

Two comparative audits informed the design choices:

- **OpenClaw `v2026.3.14` → `v2026.5.2`** (general-purpose agent,
  ~25k tokens): identified 3 alignement bricks for inter-AI harmony —
  presence beacon (mirrored in (d).9), compaction notices (mirrored
  in (d).10), role taxonomy (mirrored in (d).14).
- **OpenClaw `node.*` RPC pattern** (Explore agent, ~15k tokens):
  request/response correlation map, `node.invoke` envelope, capabilities
  discovery — all mirrored in (d).13.

---

## [0.5.0] — 2026-04-27 to 2026-05-02

Multi-agent V0.3 → V0.4.1 phases + A2A protocol POC + Ollama spoke
infrastructure. Set the stage for the fleet inter-Claude work that
followed.

### Added — Multi-agent V0.3 → V0.4.1

- **Phase H+I+J+K (V0.3)**: Sessions wake-up, ConfirmationService gates,
  per-task checkpoint resume, persistent workflow state.
- **Phase L (V0.4)** (`647ba58`): Cost tracking + budget cap with
  graceful workflow interrupt.
- **Phase M (V0.4.1)** (`9ae6a65`): Conflict auto-resolve, narrow
  scope (`prefer-reviewer` / `code_overlap`), losing tasks blocked.
- **Phase N (V0.4.1)** (`62c31ef`): Adaptive allocation cross-session
  persistence (`~/.codebuddy/agents/metrics.json` schema v0.4).
- **Phase O (V0.4.1)** (`3bfe829`): `WorkflowOrchestrator` for
  concurrent + queued workflows.

### Added — A2A protocol POC (Niveau 1 → 3)

- POC Niveau 1: Spoke registration via `POST /api/a2a/agents/register`
  + heartbeat. Hub at Ministar Linux `100.98.18.76:3000`.
- POC Niveau 2 (`6bf7349`): Cross-host task router forwarding to remote
  spokes via HTTP.
- POC Niveau 3 (`677a146`): Skill-based routing dispatch on
  `/tasks/send`. Smart skill selection (`074fd3d`).

### Added — Ollama spoke infrastructure

- `world-model/scripts/ollama_a2a_spoke.py` (Python wrapper, ~150 LOC):
  transforms a local Ollama instance into an A2A-compliant spoke that
  registers with the hub and answers task forwards.
- Defensive fixes: cross-platform hostname, `--name`/`--url` overrides,
  nested A2A text payload extraction.

### Added — OpenClaw alignment audit (waves 1-4)

7 phases per wave, each ~3-5 commits, importing the most relevant
patterns from OpenClaw `v2026.3.x` releases — context engine pluggable,
ACPX sessions, browser batch + profiles, Slack Block Kit, Gateway TLS
skip, backup CLI, Docker timezone, env blocklist, transcript repair,
cron session binding, gateway health monitor, plugin describeMessageTool,
Feishu cards + reasoning, output sanitizer, gateway WS origin
hardening (GHSA-5wcw-8jjv-m286), image content pruning, provider
plugin onboarding, `config set` command, per-agent params,
`doctor --fix`, `CODEBUDDY_CLI` env, `update --tag`, `/btw` slash,
`sessions_yield`, Firecrawl, pluggable sandbox backends, extension
relay removal, provider-bundled plugins, `imageGenerationModel`
config, `/plugin` singular, multiple security fixes.

---

## [0.4.x] — 2026-mars

Pre-fleet era. ~1,300 commits worth of refactor work, Cowork desktop
GUI integration, RTK Windows fix, ICM bridge wiring, security audits
(2026-03-07, 2026-03-10, 2026-03-11), 60+ test files fixed. Audit
OpenClaw initial waves identified the path that led to 0.5.0.

Highlights:

- Code Buddy V4 status (V4.1 + V4.3 + V4.4 livrées, V4.2/V4.5+ déférés)
- Heartbeat tick (`tools/heartbeat_tick.py`) for autonomous fleet
- DailyReset reactivation
- 8 built-in agents: PDF, Excel, DataAnalysis, SQL, Archive,
  CodeGuardian, SecurityReview, SWE
- Multi-agent system foundations

The full pre-0.5 history is preserved in git log; this CHANGELOG
starts the structured record at 0.5.0.

---

## Notes for fleet Claudes

When pulling this branch on DARKSTAR / MINISTAR / Ministar Linux:

1. `git pull --rebase` to get the latest fleet phases + post-audit fixes
2. Restart your `codebuddy-a2a.service` (or equivalent) to pick up
   the new server-side handlers (peer-rpc, peer-chat-bridge,
   compaction-bridge, heartbeat-broadcaster)
3. Check the new env vars in `docs/fleet-guide.md` (if you want to
   activate `peer.chat` as a real LLM endpoint, set
   `GOOGLE_API_KEY` / `GROK_API_KEY` / `ANTHROPIC_API_KEY` /
   `OPENAI_API_KEY` or `OLLAMA_HOST`)
4. Smoke test cross-host: from one peer,
   `/fleet listen ws://<other-host>:3000/ws --auto-reconnect --api-key $K`
   then `/fleet send (default) peer.describe` should return the other
   peer's hostname + provider info.

Fleet is the major V1-defining feature. All other infrastructure is
mature and stable.
