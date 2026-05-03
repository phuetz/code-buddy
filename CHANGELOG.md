# Changelog

All notable changes to Code Buddy are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once it reaches `1.0.0`.

---

## [Unreleased]

Heading toward `1.0.0` final. Backlog tracked under `## [Unreleased]`'s
"Backlog" section below; pending work tracked in
[`docs/fleet-guide.md`](docs/fleet-guide.md) (V1.x roadmap section)
and the audit follow-ups noted under `## [0.5.1-fleet]`.

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
