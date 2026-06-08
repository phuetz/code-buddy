# Code Buddy → Hermes Gap Analysis — Implementation Audit & Next Steps

Date: 2026-05-24 · Audited working tree on `tmp-self-improve-default` (base `3b3bd18d`, uncommitted)
Source brief: `docs/code-buddy-hermes-gap-analysis.md` (12 gaps, GAP-1…GAP-12)
Verification: core typecheck PASS · Cowork typecheck PASS · 8 new/changed test files = 96 tests PASS

## Verdict at a glance

| Gap | Brief | Verdict | One-line reason |
|---|---|---|---|
| GAP-1 per-session user-model injection | OPEN | ✅ **DONE** | `<user_model_context>` injected next to lessons, flag-gated default-on, empty→nothing |
| GAP-2 auto-record lesson usage | OPEN | ✅ **DONE** | `recordUsage` fired off-hot-path in `buildContextBlock`, idempotent, 5s cache |
| GAP-3 compaction → fork-run lineage | OPEN | ✅ **DONE** | `forkRun(runId,'compaction')` on real token reduction |
| GAP-4 Cowork skills panel + enforcement | PARTIAL | ✅ **DONE** | IPC + mounted panel + **selection-time** filter in skill-manager & registry |
| GAP-5 mobile remote-supervision listener | OPEN | ✅ **DONE** | loopback guard + randomized code (P0); gated approve/cancel/submit-prompt (P2) |
| GAP-6 Browser Operator runtime | PARTIAL | ✅ **DONE** | executor drives backend, consent gate, action log, stop, proof artifact |
| GAP-7 inbound two-way messaging | PARTIAL | ✅ **DONE** | E2E roundtrip test (P1) + server-startup intake `startConfiguredChannels` (P2) |
| GAP-8 Cowork lessons cockpit | PARTIAL | ✅ **DONE** | `LessonsVaultGraph` mounted via Browse trigger in FleetCommandCenter |
| GAP-9 recall FTS5 trigram + snippets | PARTIAL | ✅ **DONE** | trigram tokenizer + rebuild + `snippet()` highlight + renderer `<mark>` |
| GAP-10 memory provider adapters + selector | OPEN | ✅ **DONE** | 3 network adapters w/ local fallback, registry, env, Cowork selector |
| GAP-11 LLM dialectic over user model | OPEN | ✅ **DONE** | `runUserDialecticInference` proposes *pending*, privacy-screened, `user-model analyze` |
| GAP-12 remote terminal / research-script backends | OPEN | 🟡 **DONE (core scope)** | local/docker/wsl + guards + artifact folder; true *remote* provider unimplemented |

**Score: 11 fully done · GAP-12 done minus the remote backend.**
Every durable mutation reviewed keeps the review-gate (user-model proposals → `accept --by`,
lessons provenance). Typecheck + the touched tests are green.

> **Update 2026-05-24 (backlog implemented).** P0 + P1 + P2 of the backlog below are now
> done; GAP-5/7/8 flipped to ✅. See **"Backlog resolution"** at the bottom for the
> per-item changes and new tests. Remaining open work is P3 only (external-dependency
> lifts: GAP-12 remote backend, GAP-10 live-API integration tests, optional GAP-11
> session-end hook).

## Per-gap detail

**GAP-1 ✅** — `src/agent/execution/context-pipeline.ts:94-104` (round 0) + `:220-230` (round ≥1)
inject `getUserModel(cwd).summarize()` as `<user_model_context>`, behind `USER_MODEL_INJECTION`
(`src/config/feature-flags.ts`, default on); `summarize()` returns `null` when empty so nothing is
injected. `src/memory/user-model.ts:301`. *Hole:* no executor-level test asserting the block
appears once per turn (only `summarize()` unit tests).

**GAP-2 ✅** — `src/agent/lessons-tracker.ts:632-655`: on `buildContextBlock()` a non-blocking
Promise records `recordUsage(lessonId, getCurrentRunId())` per injected lesson; 5s cache prevents
re-recording. Run id from `RunStore.getInstance().getCurrentRunId()`. *Hole:* no test asserting the
auto-call/idempotency (the +57 lines test `getConceptDetails`, not usage).

**GAP-3 ✅** — `src/context/context-manager-v2.ts:235-245`: when compaction reduces tokens, calls
`runStore.forkRun(activeRunId, 'compaction')`; `run-store.ts:365` sets `parentRolloutId` +
`forkReason`. *Hole:* no test simulating compaction → asserting the fork.

**GAP-4 ✅** — `cowork/src/main/ipc/skills-ipc.ts` (list/listEnabled/setEnabled), preload exposed,
`SkillsBrowser.tsx` **mounted** in `SettingsPanel.tsx`. Critically, disabled packages are filtered
at **selection time**: `src/skills/skill-manager.ts` (`matchSkills`, `getSkillPromptEnhancement`)
and `src/skills/registry.ts` (`list`, `search`). Core tests assert disabled skills never reach the
prompt. Fully wired.

**GAP-5 ⚠️ PARTIAL + HIGH-severity security** — `src/server/routes/mobile.ts` mounts `/api/mobile/*`
(pair, snapshot, artifact read with traversal guard, recall-pack, followup-draft) and token-gates the
read/draft routes; 8 tests pass. **But:**
- `GET /pairing-status` (`:46`) returns the **active pairing code unauthenticated**, and
  `POST /pairing-code` (`:55`) lets **anyone rotate it unauthenticated**. There is **no loopback
  binding** (`req.ip`/`remoteAddress` never checked). The brief's own contract
  (`mobile-supervision-gateway-listener-shell.ts:39-41`) specifies `host:'127.0.0.1'` /
  `networkExposure:'loopback_only'`. So any host on the LAN can GET the code → `POST /pair` → obtain a
  15-min `mobile:read`+`mobile:draft` token (artifact reads). **Contract violation, fix before ship.**
- `approve/cancel` and `submit prompt` routes from the brief are **not implemented** (only a
  draft-only `followup-draft`). This is the safe-by-default subset; remaining routes are deferred.
- Token expiry *is* enforced (`isValidToken`, `:23`). Default pairing code is the literal `'123456'`.

**GAP-6 ✅** — `src/browser-automation/browser-operator-executor.ts` (new) drives a real backend via
`getBrowserManager()`: consent gate throws `BrowserOperatorConsentRequired` until granted, iterates
the action log with status transitions + evidence, screenshots in visible mode, `stop()` halts mid-run,
writes a `browser-operator.json` proof artifact. Exported from `index.ts`. 4 tests cover
consent/run/stop/proof.

**GAP-7 ⚠️ PARTIAL** — `src/commands/handlers/channel-handlers.ts:168-246` registers a
`ChannelManager.onMessage` handler: DM-pairing gate → `resolveRoute` → instantiate agent →
`processUserMessage` → reply via `channel.send`. The agent loop is untouched. So a real
inbound→agent→reply receiver loop **does exist** (fed by adapter polling, started via `buddy channels`).
*Gap:* it is **not embedded in `buddy server`** as a webhook/WS intake route (the brief's
`src/server/` anchor; the server only has the A2A-forwarding `channel-a2a-bridge`), and there is **no
E2E test** of the full roundtrip or session resumption.

**GAP-8 ⚠️ PARTIAL (dead UI)** — Backend is real: `LessonsTracker.getConceptDetails()`
(`src/agent/lessons-tracker.ts:569-628`) returns concept node + lessons + provenance backlinks; IPC
`tools.lessonsVault.getConceptDetails` and preload are wired; `cowork/.../LessonsVaultGraph.tsx`
(+220) renders concept pages, backlinks, related runs. **But the component is imported nowhere**
(grep = only self-reference) — it is **not mounted**, so the cockpit is unreachable from the UI. The
feature is one wiring step from done.

**GAP-9 ✅** — `src/database/schema.ts` bumps to v3 and builds `messages_fts` with `tokenize='trigram'`
(substring/CJK fall out naturally); `cowork/.../db/database.ts` rebuilds the table if the tokenizer is
missing; `global-search-service.ts` NFKC-normalizes, builds the FTS query, and uses `snippet(...
'<mark>','</mark>'...)`; `GlobalSearchDialog.tsx` renders `<mark>` highlights. Wired end-to-end with a
LIKE fallback.

**GAP-10 ✅** — `src/memory/adapters/network-memory-adapters.ts` (new) implements `Mem0`/`Honcho`/
`Supermemory` providers against the existing `MemoryProvider` interface, each falling back to
`LocalMemoryProvider` without an API key; registered in `memory-provider.ts`; selectable via
`CODEBUDDY_MEMORY_PROVIDER` and a Cowork dropdown (`SettingsGeneral.tsx` → config-store → env). Local
stays default; the agent loop is untouched. Tests cover the fallback path. *Hole:* only the no-key
fallback is tested, not live API round-trips.

**GAP-11 ✅** — `src/memory/user-model.ts:423-541` `runUserDialecticInference()` runs an LLM pass that
proposes higher-order observations, each privacy-screened (`screenUserModelContent`) and written as
**pending** via `observe()` (never auto-accepted); surfaced by `buddy user-model analyze`
(`src/commands/user-model.ts`). Review-gate intact. By design this is CLI/tool-triggered, not an
automatic per-turn pass.

**GAP-12 🟡 DONE (core scope)** — `src/agent/research-script-job-runner.ts` now accepts
`local|docker|wsl`: Docker maps language→image, mounts `-v cwd:/workspace`, applies `--network none`
when sandbox network is disabled, injects env; WSL translates paths via `toWslPath()`. Allowlist /
network-refusal guards and the run artifact folder are preserved. 5 tests assert the spawn-arg
translation. *Gap:* the declared **remote** provider (Daytona/Modal/Vercel) is **not implemented**, and
Docker/WSL are tested only at the spawn-arg level (no live execution).

---

## La suite — prioritized backlog

### P0 — Blockers (do before committing/merging this work)
1. **GAP-5 security:** bind the mobile listener to `127.0.0.1` and enforce `loopback_only` per the
   contract; stop returning the pairing code over the network — make `pairing-status`/`pairing-code`
   local-operator-only (no remote read/rotate). Add allow/deny tests for non-loopback origins.
2. **GAP-8 mount:** import & mount `LessonsVaultGraph` (nav entry/route + a trigger from the existing
   `LessonsVaultStrip`), turning the already-built backend into a reachable cockpit. Add a Cowork test.

### P1 — Definition-of-Done test holes (implementations exist, tests don't)
3. Executor test: `<user_model_context>` appears once per turn when the model has accepted obs, and
   not at all when empty (GAP-1).
4. Compaction-fork test: simulate a token-reducing compaction → assert a fork run with
   `forkReason:'compaction'` + parent link (GAP-3).
5. Lesson-usage test: injecting lesson X during run R records `usage(X,R)` once, even if injected twice
   (GAP-2).
6. Inbound E2E test: channel message → route → agent → reply, plus same-session follow-up reuse (GAP-7).

### P2 — Feature completion
7. **GAP-5 routes:** add the gated `approve`/`cancel`/`submit-prompt` endpoints (follow-ups require
   explicit local approval; dangerous ops blocked), per the pairing-acceptance plan.
8. **GAP-7 server intake:** add a webhook/WS receiver in `buddy server` so inbound messaging works
   without a separately-started `buddy channels` process; per-channel enablement + auth.

### P3 — Larger / external-dependency lifts
9. **GAP-12 remote backend:** implement a real remote `ResearchScriptSandboxProvider`
   (Daytona/Modal/Vercel) behind the same guards; add a live (or recorded) Docker execution test.
10. **GAP-10 live adapters:** integration tests against real Mem0/Honcho/Supermemory APIs (gated by
    keys); keep local default.
11. **GAP-11 closer to runtime (optional):** an opt-in hook that triggers dialectic inference at
    session end — still propose→accept, never auto-applied.

## Definition of Done reminders (from the brief, Part 6)
- New durable mutations stay review-gated (`accept --by <reviewer>`); preserve lineage links.
- `npm run validate` (core) + `cd cowork && npm run typecheck` green; no `console.*` in production;
  ESM `.js` import extensions; Conventional Commits.
- The work is currently **uncommitted** — once P0 is closed it should land as a focused series of
  Conventional commits (one per gap cluster).

## Verification of this audit
This audit doc requires no build. To re-confirm the evidence:

```bash
npm run typecheck
cd cowork && npm run typecheck
npm test -- tests/agent/lessons-tracker-gaps.test.ts tests/agent/research-script-job-runner.test.ts \
  tests/commands/user-model-command.test.ts tests/memory/memory-provider.test.ts \
  tests/memory/user-model.test.ts tests/skills/skill-manager.test.ts \
  tests/server/mobile.test.ts tests/browser-automation/browser-operator-executor.test.ts
```

---

## Backlog resolution (2026-05-24)

Implemented P0 + P1 + P2 of the backlog above. Core + Cowork typecheck green; all touched
tests pass (82 new/changed core tests + 21 Cowork tests across the files below).

### P0 — Blockers ✅
1. **GAP-5 security** — `src/server/routes/mobile.ts`: `loopbackOnlyMiddleware` reads the raw
   socket address (`req.socket.remoteAddress`, never `X-Forwarded-For`), accepts
   `127.0.0.1` / `::1` / `::ffff:127.0.0.1`, and 403s everything else. Applied to
   `/pairing-status` + `/pairing-code` only (`/pair` stays device-reachable). Default code
   `'123456'` replaced with a CSPRNG 6-digit code minted at module load. Tests:
   `tests/server/mobile.test.ts` (loopback allow/deny + X-Forwarded-For spoof).
2. **GAP-8 mount** — `LessonsVaultStrip` gains an `onBrowse` "Browse vault" trigger;
   `FleetCommandCenter` owns `showLessonsGraph` state and renders the (previously dead)
   `LessonsVaultGraph` modal. Tests: `cowork/tests/lessons-vault-strip.test.ts`,
   `cowork/tests/lessons-vault-graph.test.ts`, `cowork/tests/fleet-command-center-board.test.ts`.

### P1 — Definition-of-Done test holes ✅
3. **GAP-1** — `tests/agent/execution/context-pipeline-user-model.test.ts`: `<user_model_context>`
   appears exactly once per turn (round 0 and round ≥1) when the model summarizes to non-null,
   not at all when empty or when the flag is off.
4. **GAP-3** — `tests/context/context-manager-v2-gaps.test.ts`: a token-reducing compaction forks
   the active run with `forkReason:'compaction'`; no fork when there is no active run or no
   compaction.
5. **GAP-2** — `tests/agent/lessons-tracker-gaps.test.ts`: injecting a lesson records
   `usage(id, runId)` once; a second injection inside the 5s cache window does **not** re-record;
   nothing recorded when there is no active run.
6. **GAP-7** — `tests/commands/channel-ai-handler.test.ts`: inbound message → pairing gate →
   route → agent → reply roundtrip; unpaired sender gets the pairing prompt and the agent never
   runs; same-session follow-up reuses the persisted session; prior history is restored on resume.

### P2 — Feature completion ✅
7. **GAP-5 routes** — `src/server/routes/mobile.ts`: device-facing `POST /submit-prompt`
   (token-gated) enqueues a `needs_local_operator` draft — never executes. Local-operator
   (loopback) `POST /followup-draft/:id/approve` and `/cancel` plus `GET /followup-drafts`,
   mounted **before** the bearer auth. Approval is a review-gate marker (records `approvedBy`/
   `approvedAt`) and dispatches nothing; non-pending transitions return 409. Tests in
   `tests/server/mobile.test.ts`.
8. **GAP-7 server intake** — `startConfiguredChannels()` (`src/commands/handlers/channel-handlers.ts`)
   starts enabled channels and wires `registerAIMessageHandler` at boot; `buddy server` calls it
   when `CODEBUDDY_SERVER_CHANNEL_INTAKE=true` (`src/server/index.ts`, `ServerConfig.channelIntakeEnabled`).
   Per-channel enablement from `channels.json`; inbound auth is the DM-pairing gate. Tests:
   `tests/server/channel-intake.test.ts`.

### Still open — P3 (external-dependency lifts, deferred)
- **GAP-12 remote backend** (Daytona/Modal/Vercel `ResearchScriptSandboxProvider`) + live Docker test.
- **GAP-10 live adapters** integration tests against real Mem0/Honcho/Supermemory APIs.
- **GAP-11** optional opt-in session-end dialectic hook (still propose→accept, never auto-applied).

The push-based webhook variant of GAP-7 (`POST /api/channels/webhook/:type` with per-adapter
signature verification) is deferred as a follow-up; the startup intake covers polling adapters.
