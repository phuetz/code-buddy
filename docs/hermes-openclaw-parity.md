# Hermes Agent & OpenClaw — parity and gaps (canonical)

**Date: 2026-06-08** · Machine: Ministar Linux (Ryzen AI 9 HX 470, Ollama Vulkan) · Verified against live installs:
Hermes Agent `v0.16.0`, OpenClaw `2026.6.1`.

> **This is the single source of truth** for where Code Buddy stands versus Hermes Agent and OpenClaw. It supersedes the
> dated audit/status/TODO docs now under [`archive/2026-q2-hermes-audits/`](archive/2026-q2-hermes-audits/). Living
> reference docs that remain authoritative for their own topic: [`hermes-memory-providers-selfhost.md`](hermes-memory-providers-selfhost.md)
> (connector how-to), [`hermes-agent-strategy.md`](hermes-agent-strategy.md) (strategy), and the Fleet bus itself in
> [`fleet-guide.md`](fleet-guide.md).

## TL;DR

- **Vs Hermes** — the parity manifest (`src/agent/hermes-parity-manifest.ts`, surfaced by `buddy hermes parity --json`)
  reports **15 `covered-partial` + 5 `partial`, 0 `gap`**; tool parity = **65 exact + 6 native-equivalent**. *This is the
  project's own self-assessment.* The 15 `covered-partial` each carry a documented partial residual that has **not been
  independently re-audited** — that bucket is where an undocumented gap would hide. The 5 `partial` are all gated (table below).
- **Vs OpenClaw** — the gateway bridge + CLI `validate-upstream` are **validated against a live OpenClaw 2026.6.1 daemon**
  (`openclaw gateway status --json`, exitCode 0). One known limitation: the raw WS `protocol:4` handshake (deferred; the
  CLI path is canonical). Code Buddy's AI-to-AI substrate (`peer.*` + A2A/ACP/MCP) is **richer** than OpenClaw's.
- **The one open in-repo code gap** is the OpenClaw **migrator** (`src/agent/hermes-claw-migrate.ts`): against the real
  2026.6.1 install it imports **0 of 36 categories**. Two of those are **proven reader bugs** from 2026.6.x schema drift
  — the configured default model and the custom-provider catalog moved under `models`/`agents.defaults`, while the readers
  still look at the config root. The other ~30 skips are **correct on this fresh/empty install** (no MCP servers, persona,
  agent-behavior overrides or memory store are configured), **not** reader bugs. See [§4](#4-the-one-open-code-gap--openclaw-migrator-readers).

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

> Net vs Hermes' kanban: the distinctive "shared, dependency-ordered, lease-claimed task board" combo is **now present**
> on `colab-store`. Remaining nuance is cross-machine *atomicity* — Code Buddy's JSON queue is advisory across machines
> (arbitration = `git push`), by design, vs Hermes' single-machine SQLite atomicity. That is an architectural choice, not a gap.

## 2. Gaps vs Hermes Agent — the 5 `partial`

| Feature (manifest id) | Gate type | Why | Module |
|---|---|---|---|
| `messaging-gateway` | **External** (accounts) | needs 20 platform tokens (Telegram/Discord/Slack/WhatsApp…) | `src/channels/*` |
| `browser-automation` | **External** (accounts) | local Playwright+CDP+hybrid routing done; only **managed** Browserbase/Browser Use backends need paid keys | `src/agent/hermes-browser-backends.ts` |
| `runtime-backends` | **External** (accounts) | local/Docker/WSL/SSH validated; Modal/Daytona serverless need accounts | `src/agent/hermes-runtime-backends.ts` |
| `mobile-supervision` | **Product** (by design) | silent remote execution is refused on purpose; local-operator-gated | `src/server/routes/mobile.ts` |
| `openclaw-migration` | **Actionable** (see §4) | external gate (no real install) lifted; now blocked by stale readers, not by accounts | `src/agent/hermes-claw-migrate.ts` |

Local/free is already covered wherever possible (Playwright+CDP, Docker/WSL/SSH, Honcho/ByteRover via CLI). What pins the
first three at `partial` is **paid accounts**, not code. Flipping them without a real round-trip would be metric-gaming (refused).

**Intentional product decisions** (not gaps): direct background skill writes (Code Buddy keeps review gates), RPC
code→tools in subagents (closed-by-default for security), live mobile execution, Nous Portal live OAuth. These remain
`partial`/guarded on purpose.

## 3. Gaps vs OpenClaw

Code Buddy absorbed OpenClaw patterns rather than forking it. AI-to-AI, it **exceeds** OpenClaw.

| Capability | Status | Module |
|---|---|---|
| Gateway discovery (real 2026.6.x `openclaw.json` + `devices/paired.json` layout) | **Covered / validated 2026-06-08** | `src/openclaw/gateway-bridge.ts::discoverOpenClawGateway` |
| CLI `validate-upstream` interop (`openclaw gateway status --json`, exitCode 0) | **Covered / validated** | `gateway-bridge.ts::validateOpenClawUpstreamCompatibility` |
| Raw WS `protocol:4` handshake (`nodes.pending`/attach) | **Known limitation** (2/8 checks) — deferred; CLI path canonical | `gateway-bridge.ts` |
| Companion gateway inbox + Fleet handoff + approved reply (Telegram/Slack…) | **Covered, supervised** (local draft, never auto-dispatch) | `src/companion/gateway.ts`, `gateway-inbox.ts` |
| Per-skill `SKILL.md` Ed25519 signatures | **Covered** (2026-06-07) | `src/skills/hub-signing.ts` |
| Signed registry **index** + seeded official publisher key | **Missing** — actionable, minor | `src/skills/hub.ts` |

AI-to-AI substrate Code Buddy has that OpenClaw lacks: `peer.chat` / `peer.chat-session.*` / `peer.tool.invoke` /
`peer_delegate` / `route_peer`, plus A2A + ACP + MCP. OpenClaw routes via a gateway hub (ACP, human↔agent / agent↔node);
it has **no shared peer task board**. OpenClaw "enterprise" modules (policy/hooks/compaction/retry/semantic-memory) are
**deliberately deferred** in `src/config/toml-config.ts` — they conflict with active Code Buddy systems; do not enable globally.

### Multi-AI collaboration model, at a glance
- **Hermes**: durable SQLite **kanban** shared across profiles — atomic claim+TTL, DAG `link`, swarm decompose. Agent↔agent board.
- **OpenClaw**: central **gateway hub** — isolated agents behind one gateway, routing bindings, node pairing, ACP bridge, channels. Human↔agent / agent↔node routing.
- **Code Buddy**: richer **peer.* fleet** (A2A/ACP/MCP) + `colab-store` queue **now with TTL/lease + DAG + swarm** + event-driven autonomous daemon + free-first model tier. Cross-machine arbitration via git.

## 4. The one open code gap — OpenClaw migrator readers

**Empirical finding (dry-run of `buddy hermes claw status --json` against the live `~/.openclaw`, 2026-06-08):**
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

### Fix outline (not done here — documented gap)
1. **Proven, do first**: extend the model reader to also read `agents.defaults.model.primary`, and the provider reader to
   read `models.providers.*` (the code already tries multiple field names — add the nested paths). This alone moves
   `model` + `custom_providers` to `import` against a real install.
2. Keep legacy readers as fallback for older `clawdbot`/`moltbot` installs.
3. **Pending source data**: only when an install has them, verify and add 2026.6.x readers for MCP, agent-behavior
   overrides, identity and a migratable memory store — don't add them blind.
4. **Only after** high-value categories resolve to `import`/`archive`: flip the manifest entry `openclaw-migration`
   (`hermes-parity-manifest.ts:592`) `partial → covered-partial`, correct the "no real OpenClaw install validated" note,
   and consider removing `openclaw-migration` from `isDeferredHermesTodo` (`hermes-parity-manifest.ts:654`).
- Files: `src/agent/hermes-claw-migrate.ts` (readers), `src/agent/hermes-parity-manifest.ts` (status),
  `tests/agent/hermes-claw-migrate-real.test.ts` (add a fixture derived from the real 2026.6.1 install, secrets redacted).

## 5. Verification

```bash
# Hermes parity (counts come from the manifest itself)
npx tsx src/index.ts hermes parity --json            # expect 15 covered-partial / 5 partial / 0 gap

# Already-shipped fleet primitives (sanity — these are NOT gaps)
grep -nE "isClaimExpired|areDependenciesMet|nextClaimable" src/fleet/colab-store.ts

# OpenClaw bridge interop against the live 2026.6.1 daemon
npx tsx src/index.ts hermes claw bridge validate-upstream --openclaw-bin "$(command -v openclaw)"

# The migrator gap — reproduces 0 imports against the real install
npx tsx src/index.ts hermes claw status --json | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print('imported:', sum(1 for e in d['entries'] if e['action']=='import'), '/', len(d['entries']))"
```
