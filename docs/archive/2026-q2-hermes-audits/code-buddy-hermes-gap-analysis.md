# Code Buddy → Hermes Agent — Complete Build Brief for Antigravity

Date: 2026-05-24 · Verified against working tree `3b3bd18d` · `@phuetz/code-buddy@1.0.0-rc.5` · Node ≥ 18
Reference: Hermes Agent (Nous Research) — <https://github.com/nousresearch/hermes-agent>

> **Mission for Antigravity:** finalize Code Buddy to Hermes-agent capability parity by
> closing the verified gaps in Part 5, following the architecture and conventions in
> Parts 1–4, respecting the non-goals in Part 7, and meeting the Definition of Done in
> Part 6. This document is **self-contained**: everything you need to work safely is here.
> When in doubt, also read `CLAUDE.md` (root) and `docs/hermes-agent-power-todo.md`.

---

## Part 0 — TL;DR

Code Buddy is a **terminal-first, multi-provider AI coding agent** (TypeScript/ESM) with a
desktop GUI (**Cowork**, Electron) and a multi-agent mesh (**Fleet**). It already implements
most of Hermes' "agent operating system" surface: closed learning loop (lessons + user
model, **review-gated**), enforced tool profiles, scheduled autonomy, peer delegation,
durable runs, recall, evals, and a brand-new **BMAD spec pipeline**. The remaining gaps are
**12 items** (Part 5), mostly "wire the runtime to specs that already exist" and a few
larger/external lifts. Build them in the order in Part 6.5.

**Golden rule:** anything the agent learns or mutates durably is **proposed → human
approves → then written** — never silent. Mirror `src/agent/lesson-candidate-queue.ts`.

---

## Part 1 — Build, run, test, environment

```bash
npm install              # installs deps (incl. optionalDependencies: tar, sharp, baileys, …)
npm run dev              # Bun dev mode
npm run dev:node         # tsx dev mode (use this on Windows if Bun misbehaves)
npm run build            # tsc -> dist/
npm run typecheck        # tsc --noEmit  (MUST be 0 errors)
npm run lint             # eslint
npm run validate         # lint + typecheck + test — run before committing
npm test                 # Vitest, ~27K tests, slow. ALWAYS use a path filter:
npm test -- tests/spec/spec-store.test.ts
npm run build:gui        # Cowork build (cd cowork && npm run build)
npm run dev:gui          # Cowork dev (Vite + Electron)
# Cowork has its own toolchain:
cd cowork && npm run typecheck   # MUST be 0 errors
cd cowork && npm test            # Vitest (cowork/tests)
```

**Environment / gotchas**
- ESM project (`"type": "module"`). **Source imports need `.js` extensions even for `.ts`**
  (`import { x } from './foo.js'`). Use `import.meta.url` + `fileURLToPath` for `__dirname`.
- TypeScript strict; avoid `any`. `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes`
  are NOT on yet (don't rely on them).
- Use `logger` (`src/utils/logger.js`), never `console.*` in production — tests spy on it.
- Tests live in **`tests/`** only (never `src/**/*.test.ts`). Cowork tests in `cowork/tests/`.
  Vitest uses `pool: 'forks'`; a Jest-compat shim maps `jest.fn()`→`vi` and rewrites
  `jest.mock`→`vi.mock` + resolves `.js`→source `.ts` in specs.
- Files kebab-case; React components PascalCase. **Conventional Commits** (`feat(scope): …`),
  enforced by commitlint (`commit-msg` hook). `pre-commit` runs `lint-staged`
  (prettier `--write` + eslint `--fix` on staged files only — no full build).
- `better-sqlite3` is native; three DB-loading test files are skipped where Electron headers
  aren't available.

---

## Part 2 — Repository map

```
src/                      core (the CLI + agent + server + all tool backends)
  index.ts                CLI entry (Commander, lazy-loaded command groups, --profile)
  agent/                  the agentic loop, facades, middleware, reasoning, autonomous runner,
                          custom agents (incl. hermes), lessons, flow, multi-agent, repair
  codebuddy/              LLM client dispatcher + provider strategies + tool definitions
  commands/               CLI command implementations (one file/group per command)
  config/                 model-tools.ts, constants.ts, toml-config.ts, advanced-config.ts
  context/                ContextManagerV2 (compression), transcript-repair, context-engine
  fleet/                  multi-AI mesh: peer bridges, task-router, sagas, result-aggregator
  memory/                 persistent memory, memory-provider boundary, user-model
  observability/          RunStore (durable runs), trajectory/eval/mobile-supervision contracts
  scheduler/ daemon/      cron-as-agent-task, pre-checks, watchdog, delivery
  security/               sandbox registry, permission modes, write policy, env blocklist
  server/                 HTTP (3000) + Gateway WS (3001); routes incl. A2A
  services/               prompt-builder.ts (the REAL system-prompt builder)
  skills/                 SKILL.md packages (SkillsHub), skill candidates
  spec/                   BMAD spec pipeline (store, planner, plan-runner) — NEW this cycle
  tools/                  ~110 tool classes + registry + metadata (RAG/BM25) + aliases
  ui/                     Ink/React terminal UI (ChatInterface.tsx)
  channels/               messaging adapters (Telegram/Discord/Slack/…) + ChannelManager
  browser-automation/     browser backends + operator-session draft + proof loop
cowork/                   Electron desktop GUI (separate package.json, Node ≥ 22)
  src/main/               main process: ipc/, fleet/, utils/core-loader.ts, window-management
  src/preload/index.ts    contextBridge — exposes window.electronAPI.*
  src/renderer/           React UI (components/, types/, store)
tests/                    Vitest specs for src/
docs/                     this file, hermes-agent-status.md, hermes-agent-power-todo.md, …
.github/workflows/        ci.yml, security.yml, sonar.yml, release*.yml
.codebuddy/               per-project runtime state (lessons, user-model, specs, runs, skills)
```

---

## Part 3 — Architecture you must understand

### 3.1 The agentic loop
```
User → ChatInterface (Ink/React) → CodeBuddyAgent → LLM provider
                                         │
                                Tool calls (max 50 rounds, YOLO 400)
                                         │
                              Execute + confirm → results → loop
```
- **`src/agent/codebuddy-agent.ts`** — main agent; delegates to facades; `executeTool()` is the
  big switch that dispatches tool calls; `executePlan()`.
- **`src/agent/execution/agent-executor.ts`** — the middleware pipeline + the **single source of
  truth `runTurnLoop` async generator**. `processUserMessageStream` is a thin `yield*` wrapper;
  `processUserMessage` is a sequential collector. **Per-turn injections, transcript repair,
  output sanitization, and the `__SESSIONS_YIELD__` signal all live in `runTurnLoop`** — change
  per-turn behavior in ONE place. Streaming-only events (`ask_user`, `tool_stream`,
  `token_count`, `reasoning`, `steer`) are dropped in the sequential collector.
- **Per-turn context injection:** each turn appends `<lessons_context>` (before) and
  `<todo_context>` (after). New per-turn context (e.g. user model — GAP-1) goes here.

### 3.2 Facades (`src/agent/facades/`)
`CodeBuddyAgent` delegates to: `AgentContextFacade` (token counting, ContextManagerV2
compression, memory retrieval), `SessionFacade` (save/load/checkpoint/rewind),
`ModelRoutingFacade` (model selection, cost), `InfrastructureFacade` (MCP, sandbox, hooks,
plugins), `MessageHistoryManager` (history/export).

### 3.3 Providers
15 providers via OpenAI-compatible routing (Grok, Claude, GPT, Gemini, Ollama, LM Studio, AWS
Bedrock, Azure, Groq, Together, Fireworks, OpenRouter, vLLM, Copilot, Mistral) + a separate
Gemini native path. **`src/codebuddy/client.ts`** is a thin dispatcher that picks a `Provider`
strategy (`GeminiNativeProvider` for `generativelanguage.googleapis.com`, else
`OpenAICompatProvider`). Adding a provider = one strategy file + a constructor branch.
One-shot call pattern: `new CodeBuddyClient(apiKey, model, baseURL).chat([{role,content},…])`.

### 3.4 Middleware pipeline (`src/agent/middleware/`) — priorities matter
| Middleware | Priority | Purpose |
|---|---|---|
| `ReasoningMiddleware` | 42 | detect complex queries, inject `<reasoning_guidance>` |
| `WorkflowGuardMiddleware` | 45 | suggest plan init for complex first messages |
| `AutoRepairMiddleware` | 150 | detect errors, invoke fault localizer, suggest repairs |
| `QualityGateMiddleware` | 200 | auto-delegate to CodeGuardian + SecurityReview agents |
Registered in `codebuddy-agent.ts` constructor.

### 3.5 Model-aware limits & config (start here for model behavior)
- **`src/config/model-tools.ts`** — per-model caps (contextWindow, maxOutputTokens, patchFormat)
  with glob matching (`grok-3*`, `claude-*`). System prompt truncated to
  `(contextWindow − maxOutputTokens) × 50%`.
- `src/config/constants.ts` (`SUPPORTED_MODELS`, `TOKEN_LIMITS`), `toml-config.ts` (profiles,
  `[model_pairs]` architect/editor), `advanced-config.ts` (effort levels), `.codebuddy/settings.json`.

### 3.6 Cross-cutting systems (don't break these)
- **RAG tool selection** (`src/codebuddy/tools.ts`): filters ~110 tools per query via embeddings;
  BM25 fallback via `tool_search` + metadata in `src/tools/metadata.ts`. Set `fleetSafe: true`
  only for read-only tools exposable via `peer.tool.invoke`.
- **Context compression** `ContextManagerV2` (`src/context/context-manager-v2.ts`): sliding window
  + summarization; budget from `getModelToolConfig(model).contextWindow`.
- **Transcript repair** (`src/context/transcript-repair.ts`): runs at all 3 `prepareMessages()`
  sites; removes orphaned tool results, injects synthetic ones for lost tool-call pairs.
- **Output sanitizer** (`src/utils/output-sanitizer.ts`): strips model-leakage tokens; tests assert
  sanitized output — don't bypass.
- **Pluggable ContextEngine** (`src/context/context-engine.ts`): plugins can own the context
  pipeline (`registerContextEngine`, `ownsCompaction`). Trust check blocks untrusted plugins.
- **ConfirmationService** (singleton) check order: permission mode → declarative rules → session
  flags → Guardian Agent.
- **JIT context:** when a tool touches a path, the system walks up loading
  `CODEBUDDY.md`/`CONTEXT.md`/`AGENTS.md`/`README.md` (≤4KB each; `@path` imports).
- **Auto-memory writeback:** `.codebuddy/CODEBUDDY_MEMORY.md` (project) + `~/.codebuddy/memory.md`
  (user) via `src/memory/persistent-memory.ts`.

### 3.7 Special modes
YOLO (400 rounds, $100 cap, `src/utils/autonomy-manager.ts`); agent modes (`plan`/`code`/`ask`/
`architect`); permission modes (`default`/`plan`/`acceptEdits`/`dontAsk`/`bypassPermissions`,
`src/security/permission-modes.ts`); security modes (`suggest`/`auto-edit`/`full-auto`); write
policy (`strict`/`confirm`/`off`, `src/security/write-policy.ts`); plan mode (read-only research).

### 3.8 Reasoning
Extended Thinking (`src/agent/thinking/`, provider `budget_tokens`, levels off→xhigh) and
ToT+MCTS (`src/agent/reasoning/`, modes shallow→exhaustive; entry `reasoning-facade.ts`; `/think`,
`reason` tool). Reasoning middleware auto-detects complex queries.

### 3.9 Adding a tool (the canonical 5 steps)
1. Class in `src/tools/` returning `Promise<ToolResult>` (`{ success, output?, error? }`).
2. OpenAI function definition in `src/codebuddy/tools.ts`.
3. Execution case in `CodeBuddyAgent.executeTool()`.
4. Register in `src/tools/registry/` via the right factory.
5. Metadata in `src/tools/metadata.ts` (keywords + priority for RAG/BM25); `fleetSafe: true`
   only for read-only tools. Codex-style aliases live in `tool-aliases.ts`.

### 3.10 Edit tool matching
`str_replace` cascade: exact → flexible (trim-normalized) → regex (tokenized) → fuzzy
(Levenshtein 10%) → LCS (90%). Writes are blocked if `new_string` contains omission placeholders
(`// ... rest of code`) absent from `old_string`.

---

## Part 4 — Concepts glossary & the review-gate pattern

- **Fleet** (`src/fleet/`): stateful WebSocket mesh of Code Buddy peers. `peer.chat` (one-shot),
  `peer.chat-session.*` (multi-turn), `peer.tool.invoke` (read-only remote tool, **three gates**:
  allowlist → registry `fleetSafe` → workspace root, fails closed). `route_peer`/`TaskRouter`
  classify+route; `peer_delegate`/`peer_chain` autonomous delegation. **Sagas** (`saga-store.ts`)
  persist multi-step dispatch; the **Council** aggregates N peers' answers with deterministic
  consensus + optional LLM arbitration (`result-aggregator.ts`).
- **Cowork** (`cowork/`): the human cockpit (Electron). See Part 4.2.
- **RunStore** (`src/observability/run-store.ts`): durable "agent run" records — id, source surface,
  profile, prompt, plan id, parent run, tool policy, cwd, artifacts, memory inputs, outcome id.
  `searchRuns`, `buildRunRecallPack`, `forkRun`, `getRunLineage`. **Lineage intent→plan→run→tools→
  artifacts→memory→next run is the product spine** — preserve it.
- **Lessons** (`src/agent/lessons-tracker.ts` + `lesson-provenance.ts`): procedural memory with
  "created by"/"used by" provenance, concept graph, Obsidian vault export.
- **User model** (`src/memory/user-model.ts`): typed, review-gated observations about the user's
  working preferences (`preference`/`trait`/`expertise`/`working-style`), privacy-screened.
- **Tool profiles** (`src/fleet/dispatch-profile.ts`): safe/research/code/review/balanced →
  `ToolFilterConfig`, **enforced at execution** by `ToolHandler` (not just labels). Dynamic schema
  patching hides disabled tools from the model.
- **Spec pipeline** (`src/spec/`, NEW): BMAD-inspired review-gated delivery. `buddy spec plan`
  (multi-agent PRD→architecture→sharded stories, phased human gates via `SpecProject.phase`),
  `buddy spec next` (feed an approved story to the autonomous runner `runAgenticCodingCell`,
  lineage story→run→outcome). Core runner `src/spec/spec-plan-runner.ts` is shared by CLI + Cowork.

### 4.1 The review-gate pattern (copy this for any durable mutation)
```
agent proposes → writes to a `pending` store (e.g. .codebuddy/<thing>.json), NEVER the live store
human reviews → `buddy <thing> accept <id> --by <reviewer>`  (CLI) and/or a Cowork panel
on accept   → write to the live store, record provenance/lineage
```
Reference implementations: `src/agent/lesson-candidate-queue.ts`, `src/memory/user-model.ts`,
`src/spec/spec-store.ts` (transition machine with gates: approve needs reviewer, complete needs
evidence, block needs reason).

### 4.2 Cowork architecture & extension recipe
- Main process loads **core modules** via `loadCoreModule('relative/from/dist.js')`
  (`cowork/src/main/utils/core-loader.ts`) and **shells out to the core CLI** via
  `resolveCoreEntry()` + `spawn(process.execPath, [entry, …], { env:{ELECTRON_RUN_AS_NODE:'1'}, cwd })`
  for long/risky work (so the GUI never blocks). Pattern example just added:
  `cowork/src/main/ipc/spec-next-ipc.ts`.
- **To add a Cowork feature:** (1) IPC handler in `cowork/src/main/ipc/<x>-ipc.ts` (wrap errors as
  `{ ok:false, error }`); (2) expose channel(s) in `cowork/src/preload/index.ts`; (3) type the API
  in `cowork/src/renderer/types/*`; (4) build the panel in `cowork/src/renderer/components/*` and
  mount it; (5) test in `cowork/tests/` (mock `electron` ipcMain + `loadCoreModule`).
- Main→renderer push uses `sendToRenderer({ type, payload })` (a `server-event` envelope the
  renderer routes by `type`). **Gotcha (rc.8):** there must be ONE `mainWindow`; use
  `setMainWindow()` from `window-management.ts`, never redeclare the variable, or main→renderer
  IPC silently drops.
- `JWT_SECRET`: auth throws at module-load under `NODE_ENV=production` if missing; `ServerBridge`
  mints one at boot if none persisted.
- The renderer keeps standalone **mirror types** (`cowork/src/renderer/types/hermes.ts`) that are
  NOT imported from core — when you add a core field you want shown, sync the mirror.

---

## Part 5 — THE GAP LIST (verified against `3b3bd18d`)

Status legend: **OPEN** (nothing) · **PARTIAL** (scaffolding/contract exists, runtime missing).
Each gap: what's missing → start-from anchors → acceptance → tests.

### P1 — Close the learning loop's hot paths (small, high-leverage, low-risk)

#### GAP-1 · Automatic per-session user-model injection — OPEN
The user model is surfaced only on demand via the `user_model_recall` tool; Hermes injects "who
you are" into the prompt lifecycle.
- **Do:** inject `getUserModel(cwd).summarize()` (accepted observations only) as a
  `<user_model_context>` block, budget-aware, behind a config flag (default on), in the SAME place
  `<lessons_context>` is appended.
- **Anchors:** `src/memory/user-model.ts` (`summarize()`, `getAccepted()`), the per-turn injection
  in `src/agent/execution/agent-executor.ts` `runTurnLoop`, `src/services/prompt-builder.ts`.
- **Accept:** a session with accepted observations shows them without a tool call; empty model
  injects nothing; flag toggles it; token budget respected.
- **Tests:** unit on the injection helper (fake user model → expected block / empty); executor test
  that the block appears once per turn.

#### GAP-2 · Auto-record lesson usage at injection time — OPEN
`recordUsage(lessonId, runId)` exists but only `buddy lessons use` calls it; the "used by" side of
provenance is never auto-populated.
- **Do:** when lessons are injected into a turn, record usage against the active run id
  (idempotent per run+lesson, best-effort/non-blocking, off the hot path).
- **Anchors:** `src/agent/lesson-provenance.ts` (`recordUsage`), `LessonsTracker.buildContextBlock()`
  callers, active run from `RunStore`.
- **Accept:** `buddy lessons provenance <id>` lists a run that loaded it; no per-turn latency regression.
- **Tests:** unit that injecting lesson X during run R records usage(X,R) once even if injected twice.

#### GAP-3 · Session compaction → fork-run lineage — OPEN
`RunStore.forkRun()` + `getRunLineage()` exist but `forkRun` is never called in production; the
thread family tree is empty for real sessions.
- **Do:** on compaction/fork, emit `forkRun(parentRunId, 'compaction', …)`.
- **Anchors:** `src/context/context-manager-v2.ts` (compaction), `src/observability/run-store.ts`
  (`forkRun`, `getRunLineage`).
- **Accept:** after a compaction, `buddy run lineage <runId>` shows the parent→child link.
- **Tests:** simulate a compaction → assert a fork run with `forkReason:'compaction'` + parent link.

#### GAP-4 · Cowork skill package manager panel + disabled-skill enforcement — PARTIAL
CLI `buddy skills list/usage/enable/disable` is done; `cowork/src/renderer/components/SkillsBrowser.tsx`
exists but is NOT mounted, and **disabled skills are not excluded from prompt injection**.
- **Do:** (a) `skills-ipc.ts` IPC → `SkillsHub.listEnabled()`/usage/enable/disable; mount a Skills
  panel; (b) **selection-time enforcement**: exclude disabled packages from skill prompt injection;
  (c) optional per-profile scoping.
- **Anchors:** `SkillsBrowser.tsx`, `src/skills/*` (`SkillsHub`, `listEnabled()`), the skill
  selection/injection path, the Cowork IPC recipe (Part 4.2; copy `spec-ipc.ts`).
- **Accept:** browse/toggle skills from Cowork; a disabled skill never appears in the model-facing prompt.
- **Tests:** cowork IPC test (mock `loadCoreModule`); core test that disabled skills are filtered out of injection.

### P2 — Operator surface & execution reach (medium)

#### GAP-5 · Mobile remote-supervision live listener — OPEN
Rich contracts/snapshots/shells exist (`buddy run mobile-snapshot / mobile-gateway-contract /
mobile-pairing-state / mobile-pairing-acceptance-plan / mobile-approval-queue /
mobile-gateway-listener-shell`) but **no running listener** — no `/api/mobile/*` routes.
- **Do:** implement the already-specified loopback-first authenticated listener: pairing accept,
  list runs, open artifact, approve/cancel, submit prompt. Read-only routes ready; follow-ups need
  explicit local approval; dangerous ops blocked; secrets never leave.
- **Anchors:** `src/observability/mobile-supervision-*.ts` (contracts + the listener-shell plan that
  enumerates routes/auth/acceptance), `src/server/index.ts` (route registration), gateway auth.
- **Accept:** a local client pairs, lists runs, opens an artifact, approves a follow-up and submits a
  prompt over the authenticated local API; no silent risky execution.
- **Tests:** route allow/deny against the contract; pairing accept mutates session/token only after
  approval; blocked ops return denied.

#### GAP-6 · Browser Operator runtime execution — PARTIAL
`buildBrowserOperatorSessionDraft()` (`src/browser-automation/browser-operator-session.ts`) builds a
consent/visible-tab/stop/action-log **draft**; no executor drives a real browser from it.
- **Do:** wire the draft to a browser backend — per-session consent gate, visible/dedicated tab,
  logged actions, working stop control; local-logged-in vs isolated-cloud split (Manus-style).
- **Anchors:** `browser-operator-session.ts`, existing `src/browser-automation/` backends + proof loop
  (`observe`/`extract`/`assert_text`).
- **Accept:** local browser use requires consent, runs visibly, logs each action, stoppable mid-run;
  nothing runs without consent.
- **Tests:** consent gate blocks execution until granted; actions are logged; stop halts the session.

#### GAP-7 · Inbound two-way messaging gateway — PARTIAL
Outbound `delivery.targets` fanout is done; inbound is only types + helpers
(`MessageDirection`, `resolveBestRouteForInboundMessage` in `src/channels/core.ts`) with no receiver loop.
- **Do:** an inbound gateway that receives Telegram/Discord/Slack messages, routes to a session via the
  existing identity/route helpers, runs the agent, replies via the same delivery interface — without
  changing the agent loop.
- **Anchors:** `src/channels/core.ts` (`ChannelManager`, inbound helpers, adapters), `src/server/` for
  webhook/WS intake.
- **Accept:** a message to a configured channel reaches the agent and the reply is delivered back; auth
  + per-channel enablement; agent loop untouched.
- **Tests:** inbound message → session routing → agent invocation (mock channel + agent).

#### GAP-8 · Lessons cockpit: full backlink/outcome browsing — PARTIAL
Cowork shows a read-only `LessonsVaultStrip` (counts + top concepts). Missing: concept pages,
backlinks, related runs/outcomes.
- **Anchors:** `tools.lessonsVault.preview` IPC, `LessonsTracker.buildConceptGraph`, `getRunLineage`,
  lesson-provenance index.
- **Accept:** from Cowork, open a concept, see backlinks + the runs/outcomes that created/used each lesson.

#### GAP-9 · Hermes-level recall (FTS5 trigram/substring/CJK + highlighted snippets) — PARTIAL
Run/artifact search + recall packs + source filters exist; parity gap is trigram/substring/CJK FTS and
consistent match-highlighted snippets across all sources.
- **Anchors:** `RunStore.searchRuns`, `artifact-index.sqlite` FTS index, session message FTS.
- **Accept:** substring + CJK queries return ranked, highlighted snippets across CLI/Cowork/scheduled/
  Fleet/mobile sources.

### P3 — Bigger / external-dependency lifts (do last; keep review-gated + local-default)

#### GAP-10 · Memory provider network adapters + Cowork selector — OPEN
`MemoryProvider` interface + `LocalMemoryProvider` + registry exist (`src/memory/memory-provider.ts`);
no Mem0/Honcho/Supermemory adapters, no Cowork selector.
- **Accept:** activating an adapter swaps memory backends WITHOUT touching the agent loop; local stays
  default; Cowork can select the active provider. **Honor the non-goal: local SQLite/files stay coherent.**

#### GAP-11 · LLM dialectic inference over the user model (Honcho-style) — OPEN
The local user model is a file-backed observation store by design (its header says so). Add an LLM pass
that proposes higher-order user-model observations — still **review-gated** (propose → accept), never auto-applied.
- **Anchors:** `src/memory/user-model.ts`, the user-model candidate flow.

#### GAP-12 · Serverless/remote terminal & research-script backends — OPEN
Sandbox supports local + Docker + OS (`src/security/sandbox.ts`, `method: none|firejail|docker|native`);
the research-script runner is local-spawn only. `ResearchScriptSandboxProvider` declares `remote`/`wsl`
(unimplemented); Daytona/Modal/Vercel not ported.
- **Anchors:** `src/security/` sandbox registry (`SandboxBackendInterface`), `src/agent/autonomous/`
  research-script runner (`runMaterializedResearchScriptJob`, `research-script-job-artifact.ts`).
- **Accept:** a research-script job runs in Docker/WSL (and a remote provider) writing into the
  run-specific artifact folder, behind the same allowlist/network-refusal guards.

---

## Part 6 — Definition of Done, verification, and build order

### 6.1 Definition of Done (every gap)
- New durable mutation is **review-gated** (propose → `accept --by <reviewer>`); add the CLI surface
  and, where relevant, a Cowork panel.
- Lineage preserved: new runs/actions link `parentRunId`/`outcomeId` where applicable.
- Vitest coverage in `tests/` (and `cowork/tests/`), matching existing patterns:
  - Core logic: inject collaborators (e.g. an LLM call `(system,user)=>Promise<string>`), test with fakes.
  - Cowork IPC: `vi.mock('electron', …)` capturing `ipcMain.handle`, and `vi.mock(core-loader)`.
- `npm run validate` green for core; `cd cowork && npm run typecheck` green for Cowork.
- No `console.*` in production; ESM `.js` import extensions; Conventional Commit messages.

### 6.2 Suggested build order
GAP-1 → GAP-2 → GAP-3 → GAP-4 → GAP-9 → GAP-8 → GAP-5 → GAP-6 → GAP-7 → GAP-10 → GAP-11 → GAP-12.
(P1 small wins first; mobile/browser/inbound next; external-dep lifts last.)

---

## Part 7 — Non-goals (hard constraints — do NOT violate)
- Do **not** port Hermes Python code; map the pattern onto Code Buddy's TypeScript primitives.
- Do **not** add a memory SaaS before the local SQLite/file layer is coherent (local is default).
- The agent must **never** send email or contact leads automatically.
- Do **not** collect private personal data; public professional data must keep source URLs + purpose limitation.
- Do **not** hide generated scripts inside chat — scripts are artifacts (inputs/outputs/assertions).
- The user-model privacy screen (refuses health/finance/relationship/credential content) must stay.

---

## Part 8 — Known CI / infra state (so you don't trip)
CI workflows: `ci.yml` (test matrix Node 18/20 × {ubuntu,windows,macos} → typecheck/lint/test/build),
`security.yml`, `sonar.yml`. Recent fixes already landed on the branch:
- `src/types/optional-deps.d.ts` now declares `tar`/`sharp`/`@whiskeysockets/baileys` fallbacks
  (CI's `npm ci` omits optional deps → typecheck would TS2307 without them). **If you import a new
  optional dependency, add a fallback declaration here.**
- `ci.yml` install steps pass `GITHUB_TOKEN` so `@vscode/ripgrep`'s prebuilt download isn't rate-limited (403).

**Pre-existing red (NOT introduced by recent work; address separately):**
- `npm audit --audit-level=moderate` fails on transitive advisories (`@xmldom/xmldom`,
  `@opentelemetry/exporter-prometheus`, `@tootallnate/once`, `@hono/node-server`, `qs`…); some need
  breaking major bumps. See `PLAN-NPM-AUDIT-2026-05.md`.
- A couple of env-sensitive tests in `tests/agent/autonomous/agentic-coding-runner.test.ts`
  ("runs verification only when requested…") can fail on CI runners (they spawn verification commands).
- The matrix is `fail-fast: true`, so one failing job cancels the siblings — read the FIRST failing job.

---

## Part 9 — Source-of-truth index
- `CLAUDE.md` (root) — condensed architecture + conventions (authoritative).
- `docs/hermes-agent-status.md` — capability → implementation map.
- `docs/hermes-agent-power-todo.md` — the full 38-item parity backlog with detailed per-item status.
- `docs/spec-pipeline.md` — the BMAD spec pipeline (newest feature).
- `CHANGELOG.md` (`[Unreleased]`) — most recent shipped work.
