# Hermes Agent & OpenClaw — parity and gaps (canonical)

**Date: 2026-07-03** (supersedes 2026-06-09/13/14) · Machine: Ministar Linux (Ryzen AI 9 HX 470, Ollama Vulkan) · Verified
against live installs: Hermes Agent `v0.16.0`, OpenClaw `2026.6.1`.

> **2026-07-03 validation pass — the last `partial` is closed.** The OpenClaw migrator's three unexercised readers
> (MEMORY/MCP/cron) were finally exercised against the live `~/.openclaw` after populating it **through OpenClaw
> itself** (`openclaw mcp set`, `openclaw cron add --disabled`, `MEMORY.md` at the workspace root per OpenClaw's own
> AGENTS.md convention — no hand-crafted mocks). Two real 2026.6.x schema-drift bugs surfaced and were fixed:
> (1) MCP servers live under the nested `mcp.servers.<name>` map and the old root-key reader mis-read the `mcp`
> wrapper as ONE bogus server named "servers"; (2) cron jobs are persisted in the gateway state DB
> (`state/openclaw.sqlite:cron_jobs`), never in `openclaw.json`, so the config-array reader could never see them —
> a read-only sqlite reader was added (fail-soft, disabled flag carried so an imported disabled job is never silently
> activated). Full round-trip proven (dry-run + `--apply` into a throwaway target), regression-locked with sanitized
> real-shape fixtures incl. a real-DDL sqlite fixture. `openclaw-migration` flips `partial` → **`covered-partial`**
> per §4's own flip rule. **Vs Hermes the manifest now reads 15 `covered` + 5 `covered-partial` + 0 `partial` + 0
> `gap` — no open code gap remains; every residual gate is an external account, a product decision, or absent
> source data.**

> **2026-06-13/14 validation pass** — real-instance/real-LLM round-trips, no metric-gaming: (1) Docker hibernate/wake
> exercised against the live daemon with independent `docker inspect` proof; SSH connection lifecycle validated on
> localhost (real `ssh` round-trips). (2) Screenpipe installed WITHOUT sudo (conda OpenBLAS) and recording live — the
> `screen_memory` tool returns real redacted OCR (the Bearer-auth gap is fixed). (3) Channels: real network transports
> added for irc (TCP), nostr (WS/NIP-01), mattermost (WS+REST) and nextcloud-talk (long-poll) — each was a boolean-flip
> stub, now loopback-mock-proven and ReconnectionManager-wired; feishu real-time inbound is honestly SDK-gated (REST
> outbound works); plus a `camera_analyze` tool and desktop-automation exposed over MCP. (4) Camofox: reworked from the
> wrong Chrome-CDP assumption to the correct `camoufox server` + `firefox.connect()` path and now works END-TO-END at the
> repo-pinned Playwright 1.58.2. (5) OpenClaw migrator: 5 reader paths validated against the now-populated `~/.openclaw`
> + a real 0644→0600 secret-archive **security fix** — STAYS `partial` (MEMORY/MCP/cron readers unexercised: no such data
> on this install). (6) Agentic loop + tool execution + the `buddy goal` Ralph loop proven on a real LLM (Ollama `$0`, gpt-5.5).

> **This is the single source of truth** for where Code Buddy stands versus Hermes Agent and OpenClaw. It supersedes the
> dated audit/status/TODO docs now under [`archive/2026-q2-hermes-audits/`](archive/2026-q2-hermes-audits/). Living
> reference docs that remain authoritative for their own topic: [`hermes-memory-providers-selfhost.md`](hermes-memory-providers-selfhost.md)
> (connector how-to), [`hermes-agent-strategy.md`](archive/internal/hermes-agent-strategy.md) (strategy), and the Fleet bus itself in
> [`fleet-guide.md`](fleet-guide.md).

## TL;DR

- **Vs Hermes** — the parity manifest (`src/agent/hermes-parity-manifest.ts`, surfaced by `buddy hermes parity --json`)
  reports **15 `covered` + 5 `covered-partial` + 0 `partial`, 0 `gap`** (total 20); tool parity = **65 exact + 6
  native-equivalent**. *This is the project's own self-assessment.* All 5 `covered-partial` are gated on external
  accounts, product decisions, or genuinely absent source data — **none on missing Code Buddy code**. The former
  `partial` (openclaw-migration) flipped on 2026-07-03 after its last unexercised readers were exercised against the
  populated live install (§4). Nothing was ever flipped on a mock.
- **Vs OpenClaw** — the gateway bridge + CLI `validate-upstream` are **validated against a live OpenClaw 2026.6.1 daemon**
  (`openclaw gateway status --json`, exitCode 0, and raw WS `protocol:4` `connect.challenge` -> signed `req(connect)` ->
  `res` -> `req(status)` -> `res`). **The live `node.pair.list` check now passes too** (2026-07-03: the paired CLI device
  was granted `operator.pairing`; `validate-upstream --apply` reports 8/8 checks passed incl. `pending-node-list`
  returning a redacted summary). Code Buddy's AI-to-AI substrate (`peer.*` + A2A/ACP/MCP) is **richer** than
  OpenClaw's.
- **The OpenClaw migrator's two schema-drift reader bugs are now fixed** (`src/agent/hermes-claw-migrate.ts`, 2026-06-08):
  the default model (`agents.defaults.model.primary`) now **imports** and the custom-provider catalog (`models.providers`)
  is now **detected and archived 0600** — validated against the live 2026.6.1 install (import 1 / archive 5 / skip 30, was
  0 / 4 / 32). The remaining ~30 skips are **correct on this fresh/empty install** (no MCP/persona/agent-overrides/memory
  configured), not bugs; the identity/memory readers stay unverified until an install actually has that data. See
  [§4](#4-the-one-open-code-gap--openclaw-migrator-readers).

## 1. Already shipped — do not re-open

Several older docs list these as "missing" or "to wire". They are **shipped and present in source** (verified 2026-06-08).
The multi-AI comparison doc that called TTL/DAG/swarm "the honest gap" predates commits `9b605f84`/`5cebfd51`.

| Capability | Commit | Code evidence |
|---|---|---|
| Claim TTL/lease (a crashed agent's task auto-reclaims) | `9b605f84` | `src/fleet/colab-store.ts` — `isClaimExpired()` (l.200), `reclaimExpired()` (l.212), default TTL 15 min |
| DAG task dependencies on the fleet queue | `5cebfd51` | `colab-store.ts` — `dependsOn[]` (l.59), `areDependenciesMet()` (l.236), `nextClaimable()` (l.245) |
| Swarm topology (workers→verifier→synthesizer) **persisted on the board** | `5cebfd51` | `src/fleet/colab-swarm.ts` — creates colab tasks linked by `dependsOn` (not in-memory) |
| Event-driven autonomous daemon (wakes on fleet-queue change) | `70eb329b` | `FleetAutonomousDaemon` + `wake()` |
| Always-on systemd/launchd/Task-Scheduler service | `cb707a8d` | `ServiceInstaller` — `buddy autonomy install/uninstall` |
| Free-first model tier (Ollama $0 → Tailscale → paid APIs) | `884f0dc1` | `src/agent/model-tier.ts` — `chooseAutonomousModel()` |
| `/goal` + `/subgoal` Ralph loop (judge-gated auto-continue, 1:1 Hermes port) | 2026-06-11 | `src/goals/` — `applyJudgeOutcome()` decision ladder, `judgeGoal()` (fail-open, 3-strike parse auto-pause, cost-tracked), per-session store `~/.codebuddy/goals/`; turn hook in `src/hooks/use-input-handler.ts` |
| `buddy goal "<text>"` headless Ralph loop | 2026-06-11 | `src/commands/goal-cli.ts` — `runGoalLoop()` drives the full agent in-process until done/paused (exit 0/1); `--max-turns`, `--judge-model` |
| Kanban goal-mode → colab board goal-mode | 2026-06-11 | `ColabTask.goalMode/goalMaxTurns` (`src/fleet/colab-store.ts`), judge gate + block-for-human-review in `FleetAutonomousLoop.evaluateGoalModeTask()` (`src/daemon/autonomous-loop.ts`), continuation nudge in `agent-task-executor.ts`, default judge wired in `createDefaultAutonomousLoop`; CLI `buddy fleet tasks add --goal-mode` |
| Gateway goal parity → peer sessions | 2026-06-11 | `peer.chat-session.goal` (set/status/pause/resume/clear/subgoal-*) in `src/fleet/peer-session-bridge.ts`; server-side judge after `continue`/`continue-stream`, verdict + continuation prompt returned to the caller (caller-driven loop, mid-run new-goal rejected — Hermes `gateway/run.py` semantics); metadata-only `fleet:chat-session:goal` broadcasts |

> Net vs Hermes' kanban: the distinctive "shared, dependency-ordered, lease-claimed task board" combo is **now present**
> on `colab-store`. Remaining nuance is cross-machine *atomicity* — Code Buddy's JSON queue is advisory across machines
> (arbitration = `git push`), by design, vs Hermes' single-machine SQLite atomicity. That is an architectural choice, not a gap.

## 2. Gaps vs Hermes Agent — the 5 `covered-partial` (0 `partial`)

| Feature (manifest id) | Status / gate | Why it isn't `covered` (2026-07-03) | Module |
|---|---|---|---|
| `messaging-gateway` | covered-partial — **External** (accounts) | ~11 adapters now have a real persistent transport (discord/slack/telegram/whatsapp/signal/matrix/imessage + **irc/nostr/mattermost/nextcloud-talk** — real TCP/WS/long-poll clients added 2026-06-14, loopback-mock-proven, ReconnectionManager-wired); ~a dozen are functional REST/webhook adapters (dingtalk/qq/ntfy/line/teams/…, reconnection N/A). **Feishu inbound is now wired to the official Lark SDK** (optional runtime import; live use needs the SDK installed + a real Feishu app — an external-account gate, no longer a code stub). **Nostr publishing works with a configured key** (BIP-340 Schnorr signing via @noble/curves, sign→verify round-trip tested). Live multi-platform delivery still needs ~20 platform tokens. | `src/channels/*` |
| `browser-automation` | covered-partial — **External** (accounts) | Local Playwright/Chromium validated. **Camofox WORKS end-to-end** (`camoufox server` + `firefox.connect()`, real page round-trip at repo-pinned Playwright 1.58.2). **Browser Use now runs locally** (pip browser-use + Ollama + Chromium, validated) in addition to the managed gateway. Only Browserbase/Stagehand still needs a paid account. | `src/agent/hermes-browser-backends.ts`, `src/browser-automation/camofox-runner.ts` |
| `runtime-backends` | covered-partial — **External** (accounts) | **Docker hibernate/wake validated for real** (running→paused→running, `docker inspect` proof). **SSH connection lifecycle validated on localhost** (real `ssh` round-trips; hibernate is a no-op by design). Modal/Daytona need accounts. | `src/agent/hermes-runtime-backends.ts`, `src/agent/hermes-runtime-lifecycle.ts` |
| `mobile-supervision` | covered-partial — **Product** (by design) | Silent remote execution is refused on purpose; local-operator-gated. **Off-device TLS is now supported** (`CODEBUDDY_HTTPS=1` + cert/key, real HTTPS round-trip validated). Polished mobile client UX remains product work. | `src/server/routes/mobile.ts` |
| `openclaw-migration` | **covered-partial** — flipped 2026-07-03 (see §4) | The full reader set is now exercised against the populated live install: identity/model/providers (2026-06-13) **+ MEMORY/MCP/cron (2026-07-03**, after populating the install through OpenClaw itself; two real 2026.6.x schema-drift bugs found and fixed — nested `mcp.servers`, cron in the gateway state DB**)**. Not `covered` because two long-tail readers stay honestly unverified for lack of source data: the legacy pre-sqlite `cron/jobs.json` file store and a migratable memory-backend config (no such concept in 2026.6.x — that skip is correct, legacy-only). | `src/agent/hermes-claw-migrate.ts` |

Local/free is covered wherever possible (Playwright/Chromium, Docker/WSL/SSH, Honcho/ByteRover via CLI). What pins these
at `covered-partial` is **paid accounts, a product decision, or genuinely absent source data** — not missing code. Flipping
any to `covered` without a real round-trip would be metric-gaming (refused). Where a local round-trip was possible it
was run for real (Docker, the migrator dry-run + apply, Camoufox install, the agentic loop on a real LLM).

**Intentional product decisions** (not gaps): direct background skill writes (Code Buddy keeps review gates), RPC
code→tools in subagents (closed-by-default for security), live mobile execution, Nous Portal live OAuth. These remain
`partial`/guarded on purpose.

## 3. Gaps vs OpenClaw

Code Buddy absorbed OpenClaw patterns rather than forking it. AI-to-AI, it **exceeds** OpenClaw.

| Capability | Status | Module |
|---|---|---|
| Gateway discovery (real 2026.6.x `openclaw.json` + `devices/paired.json` layout) | **Covered / validated 2026-06-08** | `src/openclaw/gateway-bridge.ts::discoverOpenClawGateway` |
| CLI `validate-upstream` interop (`openclaw gateway status --json`, exitCode 0) | **Covered / validated** | `gateway-bridge.ts::validateOpenClawUpstreamCompatibility` |
| Raw WS `protocol:4` handshake + signed paired-device auth | **Covered / live-validated 2026-06-09** — `connect.challenge`, signed device-token connect, and `status` pass against OpenClaw 2026.6.1 | `gateway-bridge.ts` |
| Node pairing RPCs (`node.pair.list|approve|reject`) | **Covered / live-validated 2026-07-03** — current method names, safe summaries; live `node.pair.list` passes now that the paired device holds `operator.pairing` (redacted summary returned) | `gateway-bridge.ts` |
| Companion gateway inbox + Fleet handoff + approved reply (Telegram/Slack…) | **Covered, supervised** (local draft, never auto-dispatch) | `src/companion/gateway.ts`, `gateway-inbox.ts` |
| Per-skill `SKILL.md` Ed25519 signatures | **Covered** (2026-06-07) | `src/skills/hub-signing.ts` |
| Signed registry **index** + seeded official publisher key | **Covered** (2026-06-09) — well-known indexes verify `signature`/`indexSignature` over canonical JSON; official key is seed-read-only | `src/skills/hub-signing.ts`, `src/skills/hub.ts` |

AI-to-AI substrate Code Buddy has that OpenClaw lacks: `peer.chat` / `peer.chat-session.*` / `peer.tool.invoke` /
`peer_delegate` / `route_peer`, plus A2A + ACP + MCP. OpenClaw routes via a gateway hub (ACP, human↔agent / agent↔node);
it has **no shared peer task board**. OpenClaw "enterprise" modules (policy/hooks/compaction/retry/semantic-memory) are
**deliberately deferred** in `src/config/toml-config.ts` — they conflict with active Code Buddy systems; do not enable globally.

### Multi-AI collaboration model, at a glance
- **Hermes**: durable SQLite **kanban** shared across profiles — atomic claim+TTL, DAG `link`, swarm decompose. Agent↔agent board.
- **OpenClaw**: central **gateway hub** — isolated agents behind one gateway, routing bindings, node pairing, ACP bridge, channels. Human↔agent / agent↔node routing.
- **Code Buddy**: richer **peer.* fleet** (A2A/ACP/MCP) + `colab-store` queue **now with TTL/lease + DAG + swarm** + event-driven autonomous daemon + free-first model tier. Cross-machine arbitration via git.

## 4. OpenClaw migrator readers — CLOSED, flipped to `covered-partial` (2026-07-03)

> **Status: `covered-partial` since 2026-07-03.** The flip condition below ("flip only after a populated install
> exercises **the rest**") is now met. The last three unexercised readers were exercised against the live
> `~/.openclaw` after populating it **through OpenClaw itself** — `openclaw mcp set filesystem '{...}'`, `openclaw
> cron add --name parity-probe --cron "0 9 * * 1" --disabled`, and `MEMORY.md` at the workspace root (the
> convention OpenClaw's own AGENTS.md documents). Results, per reader:
>
> - **memory** — worked as written: `MEMORY.md` resolved from the workspace dir and imports (append under a
>   "Migrated from OpenClaw" heading). No code change needed, now exercised.
> - **mcp_servers** — **real bug found & fixed**: 2026.6.x nests the map under `mcp.servers.<name>`, and the old
>   root-key reader (`mcpServers`/`mcp_servers`/`mcp`) matched the bare `mcp` wrapper and imported ONE bogus server
>   named `servers`. New `clawMcpServers()` resolves nested-then-legacy and never mis-reads the wrapper; the live
>   dry-run now says `Merged servers: filesystem`.
> - **cron** — **real bug found & fixed**: 2026.6.x persists cron jobs in the gateway state DB
>   (`state/openclaw.sqlite`, table `cron_jobs`, column `job_json`), never in `openclaw.json`, so the config-array
>   reader could never see them. New `readClawStateCronJobs()` reads the DB **read-only** via better-sqlite3
>   (fail-soft `null` when absent/unavailable; one malformed row never poisons the rest);
>   `mapClawStateCronJob()` maps the verified job shape (5-field `kind:'cron'` schedules with an `agentTurn`
>   message; `every`/`at` one-shots and `systemEvent` payloads honestly dropped), and the `enabled` flag is
>   carried — **a job disabled in OpenClaw is imported disabled, never silently activated** (the old apply path
>   hard-coded `enabled: true`).
>
> Full real round-trip proven: dry-run plan + `--apply` into a throwaway target landed `mcpServers.filesystem`,
> a disabled `cronJobs` entry, and the appended memory block in `.codebuddy/settings.json` /
> `CODEBUDDY_MEMORY.md`. Regression-locked in `tests/agent/hermes-claw-migrate-real.test.ts` (58 tests) with
> sanitized real-shape fixtures, including a real-DDL sqlite fixture.
>
> **Addendum (same day):** the legacy pre-sqlite `cron/jobs.json` file reader is now written too — not blind: its
> shape (`{version: 1, jobs: [...]}`, the same job objects as the sqlite `job_json`) was **verified against
> OpenClaw's own migration reader** (`loadLegacyCronStoreForMigration`/`saveCronJobsStore` in the installed
> 2026.6.1 package's doctor-cron module — the product's doctor migrates that file into sqlite and archives it).
> `collectClawCronJobs` now covers all three cron storage generations: config arrays → state DB (authoritative
> once populated) → legacy file. Still not `covered`: a migratable memory-backend config has no source data
> anywhere (legacy-clawdbot-only concept, fixture-tested, never seen on a real install) — that reader's
> real-install verification stays honestly open, per this section's own rule.

> **Historical (2026-06-14): the state before the flip.** The `~/.openclaw` install is now **populated** (the
> 2026-06-08 audit ran against an empty one), so the identity/persona/skill readers could finally be exercised against
> real data. Live dry-run: **import 1 → 5** (the nested default model, SOUL/USER/AGENTS persona resolved from
> `agents.defaults.workspace`, and a symlinked plugin-skill). A real **security bug** was found and fixed in the process:
> the `gateway.auth.token` archive was written `0644` and is now `0600` (and all archive slices are now written `0600`
> unconditionally + the backup root is `0700`). Regression-locked by `tests/agent/hermes-claw-migrate-real.test.ts` with
> sanitized real-shape fixtures. It **stays `partial` (not flipped to covered-partial)** because MEMORY/MCP/cron readers
> remain **unexercised** — this install genuinely has no such data, so per §4's own rule ("flip only after a populated
> install exercises **the rest**") the flip condition is not yet met, and writing those readers blind is refused. The
> 2026-06-08 tables below are kept as the record of the original schema-drift fix.

**Original empirical finding (dry-run against the live `~/.openclaw`, 2026-06-08, before the fix):**
`detected: true`, but of **36 categories: 32 → `skip`, 4 → `archive`, 0 → `import`**. The migrator loads `openclaw.json`
(it is in `CONFIG_NAMES`, `hermes-claw-migrate.ts:94`). The "0 imported" splits into **two distinct causes** — verified
per-row by checking whether the source data actually exists:

Real top-level keys of `~/.openclaw/openclaw.json`: `agents`, `gateway`, `meta`, `models`, `plugins`, `session`, `tools`, `wizard`.

**(a) Proven reader bugs — 2026.6.x schema drift (source present, reader misses it):**

| Category | Migrator reads | Source IS present at | Result |
|---|---|---|---|
| model | config **root** `model`/`defaultModel`/`default_model` (l.457) | **`agents.defaults.model.primary`** = `ollama/qwen2.5:7b-instruct` | skip "No model in config" ❌ |
| custom_providers | config **root** `providers`/`customProviders`/`custom_providers` (l.519) | **`models.providers.ollama`** (`baseUrl`/`api`/`apiKey`/`models`) | skip "Not present" ❌ |

These two are real bugs: the value is configured, but 2026.6.x nests it under `models`/`agents.defaults` while the reader
only looks at the config root. (The bridge `gateway-bridge.ts` was fixed for the 2026.6.x layout in commit `6e70d612`;
the **migrator** is a separate module and was not.)

**(b) Correct skips on this fresh/empty install — NOT reader bugs (no source data exists):**

| Category | Migrator reads | Why the skip is correct here |
|---|---|---|
| mcp_servers | `mcpServers`/`mcp_servers` (l.472) | `grep -i mcp openclaw.json` is empty — no MCP server configured |
| agent_settings | `agents.defaults.timeoutSeconds`/`compaction.mode`/`approvals.*` (l.242-250) | `agents.defaults` holds only `workspace` + `model.primary` — nothing to map |
| persona / user / agents | `SOUL.md`/`USER.md`/`AGENTS.md` at home root (l.369) | `identity/*.json` are crypto device creds, not persona; no SOUL/USER content anywhere |
| memory | `MEMORY.md` at home root (l.392) | no MEMORY.md-equivalent; `state/openclaw.sqlite` is operational state (auth/diag/pairing/cron…); transcripts live in `agents/main/sessions/*.jsonl` |

> The honest gap is **narrower than "imports nothing"**: the migrator drops the configured **default model** and
> **custom provider** due to schema drift. Most other skips are an empty install behaving correctly. The identity/memory
> readers are *unverifiable as bugs here* — they would only surface if/when an install actually accumulates persona or a
> migratable memory store; their 2026.6.x shapes should be confirmed before claiming a bug.

### Fix outline
1. ✅ **DONE (2026-06-08)**: the model reader now reads `agents.defaults.model.primary` (via a new `firstStringPath`
   dotted-path helper + `CLAW_MODEL_PATHS`), and the `custom_providers` archive spec now detects the nested
   `models.providers` (new optional `paths` on `ArchiveCategorySpec`, dotted-path-aware matcher + `sliceForArchive`,
   marked sensitive → 0600). `model` → **import**, `custom_providers` → **archive** (not import — the shape differs from
   Code Buddy's provider config and the block carries an apiKey). Legacy `clawdbot`/`moltbot` root keys kept as fallback.
2. ✅ Regression-locked: `tests/agent/hermes-claw-migrate-real.test.ts` (legacy `clawdbot.json` asserts `settings.model ===
   'claude-sonnet-4-6'`; new 2026.6.x `openclaw.json` asserts model→import of `ollama/qwen2.5:7b-instruct` + custom_providers
   archived 0600 from `models.providers`).
3. ✅ **DONE (2026-07-03)**: MCP (`clawMcpServers`, nested `mcp.servers`), cron (`readClawStateCronJobs` +
   `mapClawStateCronJob`, gateway state DB; plus `readClawCronJobsFile` for the legacy `cron/jobs.json` store,
   source-verified against the product's own migration reader) and MEMORY.md readers verified (see the resolution
   note at the top of this section). Only a migratable memory-backend config remains unverified on a real install —
   no source data exists anywhere (legacy-clawdbot-only concept).
4. ✅ **Manifest flipped `partial` → `covered-partial` (2026-07-03)**, per this section's own flip rule — a populated
   install now exercises the full practically-verifiable reader set.
- Files: `src/agent/hermes-claw-migrate.ts` (readers), `src/agent/hermes-parity-manifest.ts` (note),
  `tests/agent/hermes-claw-migrate-real.test.ts` (2026.6.x + sqlite fixtures).

## 5. Verification

```bash
# Hermes parity (counts come from the manifest itself)
npx tsx src/index.ts hermes parity --json            # expect 15 covered / 5 covered-partial / 0 partial / 0 gap

# Already-shipped fleet primitives (sanity — these are NOT gaps)
grep -nE "isClaimExpired|areDependenciesMet|nextClaimable" src/fleet/colab-store.ts

# OpenClaw bridge interop against the live 2026.6.1 daemon
npx tsx src/index.ts hermes claw bridge validate-upstream --openclaw-bin "$(command -v openclaw)"

# The migrator against the populated live install — memory/mcp/cron all import
# (7 imports on this machine; cron sourced from state:openclaw.sqlite#cron_jobs)
npx tsx src/index.ts hermes claw status --json | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print('imported:', sum(1 for e in d['entries'] if e['action']=='import'), '/', len(d['entries']))"

# The migrator regression suite (incl. the real-DDL sqlite cron fixture)
npm test -- tests/agent/hermes-claw-migrate-real.test.ts --run
```
