# Hermes Agent in Code Buddy — implementation status

Date: 2026-05-23
Upstream reference: <https://github.com/nousresearch/hermes-agent> (MIT, Nous Research)

Latest official parity audit: [`hermes-agent-official-parity-audit-2026-05-30.md`](hermes-agent-official-parity-audit-2026-05-30.md).
Prioritized implementation backlog: [`hermes-agent-next-todo.md`](hermes-agent-next-todo.md).
That audit was refreshed against upstream `NousResearch/hermes-agent` at `5921d667` and
concludes that Code Buddy has substantial Hermes-inspired coverage but **not**
full feature-for-feature official Hermes parity.
Cowork's Fleet Command Center now exposes the same feature-level parity summary
through `tools.hermesFeatureParity.get`, so operators can see the current
feature count, active prioritized partials, and the deliberately deferred
OpenClaw gap without leaving the cockpit.
For CLI triage, `buddy hermes todo --json` now gives the compact active Hermes
TODO list from the same manifest and keeps OpenClaw out of active work by
default.
The local proof path is now one command in CLI and one card in Cowork:
`buddy hermes status`, `buddy hermes smoke`, and the Cowork Fleet "Hermes local
smoke" strip all report aggregate readiness without publishing raw traces,
credential values, or account details.

This is the "what implements what" map for the Hermes agent inside Code Buddy.
Code Buddy does **not** vendor Hermes' Python; it maps the Hermes product
pattern onto Code Buddy's TypeScript/Fleet primitives (see the non-goals in
[`hermes-agent-power-todo.md`](hermes-agent-power-todo.md)). The granular
38-item parity backlog lives in that TODO; this page is the high-level status
and entry-point index.

## The agent itself

The Hermes agent is a **built-in custom agent** — run it with `buddy --agent hermes`.

| Piece | Where | Notes |
|---|---|---|
| Built-in agent registration | `src/agent/custom/custom-agent-loader.ts` (`BUILT_IN_AGENTS`, ~L132) | `id: hermes`, `disabledTools: [git_push, delete_file]`, `fleetDispatchProfile: balanced`, `requireExplicitDispatchProfile: true`; a user `hermes.toml` overrides it |
| Profile + system prompt | `src/agent/hermes-agent-profile.ts` | `buildHermesAgentProfile`, `buildHermesAgentSystemPrompt`, `buildHermesIntegrationPlan` |
| CLI surface | `src/commands/cli/hermes-commands.ts` (registered `src/index.ts` ~L2389) | `buddy hermes plan / profile / doctor / hooks / prompt-size / parity / tools / portal` |
| Diagnostics | `src/agent/hermes-agent-diagnostics.ts` | `buddy hermes doctor <profile>`; includes provider/model readiness, credential source names, model capabilities, context/output limits, and Nous Portal status |
| Lifecycle hooks | `src/hooks/hermes-lifecycle-hooks.ts` | canonical manifest across Code Buddy hook systems |
| Tests | `tests/agent/custom-agent-loader-hermes.test.ts`, `tests/agent/hermes-agent-profile.test.ts`, `tests/commands/hermes-commands.test.ts`, `tests/hooks/hermes-lifecycle-hooks.test.ts`, `tests/agent/hermes-agent-diagnostics.test.ts` | focused Hermes command/diagnostic coverage includes 23 specs across the doctor/command tests, green |

## Hermes capability → Code Buddy implementation

Capabilities below follow the upstream README's headline table.

### Closed learning loop (Hermes' defining feature)

| Sub-capability | Where | Status |
|---|---|---|
| Persistent lessons | `src/agent/lessons-tracker.ts`, `src/tools/registry/lessons-tools.ts` (`lessons_add/_search/_list/_graph`) | done |
| Lesson provenance ("created by" / "used by") | `src/agent/lesson-provenance.ts`; CLI `buddy lessons provenance/use` | done |
| **Agent proposes, human approves (no silent write)** | `src/agent/lesson-candidate-queue.ts` + `lessons_propose` tool + `buddy lessons candidate propose/list/show/approve/discard` | **done (this change)** |
| Retrospective / Learning Agent | `src/agent/learning-agent.ts`; auto hook from `RunStore.endRun`; CLI `buddy run retrospective <run-id>` | done — analyzes real redacted trajectories, writes retrospective artifacts, proposes lessons, materializes review-gated skill candidates |
| Skill creation from experience | `src/agent/research-script-skill-candidate.ts`; `buddy tools skill-candidate`; `skill_manage` prompt tool; Cowork Skill Package Manager strip | partial — installs reviewed research-script and Learning Agent candidates; `skill_manage` now covers real installed-skill list/view/history, direct create/discover, official Hermes `create(content)`/`edit(content)`/`patch(old_string,new_string,file_path,replace_all)`/`write_file`/`remove_file` actions, review-gated enable/disable/deprecate/delete/patch/rollback/reset/update, and review-gated candidate list/view/install with immediate lockfile visibility; `skill_manage candidate_list/view` and Cowork report not-installed/current/different/missing state plus bounded unified and expandable side-by-side diffs against the real workspace SkillsHub lockfile; `skills_list`/`buddy skills list --json` expose stale-file integrity state; `buddy skills doctor --json` reports missing/tampered packages with review-gated remediation commands including reset; `buddy skills reset` and `skill_manage action=reset` restore installed skills from the real hub/cache path after reviewer approval; `buddy skills tap list/add/remove/trust/refresh` now persists Hermes-style repository taps with path/trust metadata and discovers tap skills through real GitHub Contents API paths; `buddy skills well-known <url>` discovers `.well-known/skills/index.json` skill catalogs into the same cache; `buddy skills update-preview` and `skill_manage action=preview_update` show bounded update diffs before reviewer-gated writes; Cowork now shows installed package state, candidate install state/diff, integrity, usage, lifecycle reviewer/reason, rollback counts, current SKILL.md preview, review-safe commands, reviewer-gated candidate install/overwrite, and reviewer-gated enable/disable/deprecate/rollback/reset/delete/update/patch for installed skills through real main-process bridges |
| Skill outcome telemetry | `src/agent/learning-agent.ts`; `buddy skills learning-usage`; Cowork Learning skill usage strip | done — selected skills are recorded against completed/failed runs, scored with bounded history, and surfaced with recommendation, reason, evidence run, and next action |
| Concept graph / Obsidian vault export | `LessonsTracker.buildConceptGraph` / `buddy lessons graph --vault` | done |
| Cross-session recall | `RunStore.searchRuns`, `buildRunRecallPack`; `buddy run search / recall-pack` | done |
| **Structured user model ("deepening model of who you are")** | `src/memory/user-model.ts` + `user_model_observe`/`user_model_recall` tools + `buddy user-model` + shared context pipeline | done — local file-backed, propose/review, privacy-scoped; accepted observations are injected per turn behind `USER_MODEL_INJECTION` and counted by `buddy hermes prompt-size`; LLM dialectic inference remains review-gated |

The user model is the paired half of the learning loop. The agent proposes
observations about the user's *working preferences* via `user_model_observe`
(or `buddy user-model observe`); they persist to `.codebuddy/user-model.json`
as **pending** and never enter the active model until a human runs
`buddy user-model accept <id> --by <reviewer>`. A conservative privacy screen
refuses health/finance/relationship/credential content at both propose and
accept time. Accepted observations are injected automatically as
`<user_model_context>` through the shared per-turn context pipeline when
`USER_MODEL_INJECTION` is enabled; pending/rejected observations are not
injected. `user_model_recall` remains available for on-demand inspection. This
is a local observation store, **not** Honcho's auto-applied dialectic inference.

The candidate queue is the new piece. Proposing a lesson — via the agent's
`lessons_propose` tool or `buddy lessons candidate propose` — writes only to
`.codebuddy/lesson-candidates.json`. Nothing reaches `lessons.md` until a human
runs `buddy lessons candidate approve <id> --by <reviewer>` (inline edits
supported). This satisfies parity TODO item 7's "no silent procedural memory
mutation" acceptance.

The Retrospective/Learning Agent now closes the hot path after complex runs:
`RunStore.endRun` invokes it automatically (disable with
`CODEBUDDY_LEARNING_AGENT=off`, force manually with
`buddy run retrospective <run-id> --force`). It consumes real run events through
the redacted trajectory export, identifies tool order, failures, redundancy and
repeatable sequences, then writes only artifacts/candidates. Skill installation
and lesson persistence remain review-gated. Skill outcome telemetry now keeps a
bounded score history and produces explicit recommendations (`observe`,
`reinforce`, `improve`, `deprecate`) with the evidence run, reason, and next
operator action visible in both CLI and Cowork. Cowork Test Runner now exposes a
safe `Hermes / learning loop real smoke` entry that relaunches the persisted-run
and CLI retrospective proofs.

Research-trajectory batches are now also native: `buddy run trajectory-batch`
collects matching stored runs or explicit `--run-id` values, exports each run
through the redacted trajectory boundary, and emits a bounded compressed context
block for future agents/evals without replaying tools.

Official Hermes' `agent/background_review.py` forks a background review agent
after turns and may write memory/skills directly through a restricted tool
whitelist. Code Buddy intentionally keeps the equivalent skill/lesson writes as
reviewable candidates because this project treats procedural memory as a
change-control surface.

### Toolsets and policy enforcement

| Sub-capability | Where | Status |
|---|---|---|
| Named dispatch profiles (safe/research/code/review/balanced) | `src/fleet/dispatch-profile.ts` | done |
| Enforced tool filters per profile | custom-agent `fleetDispatchProfile` → `ToolFilterConfig`; `ToolHandler` enforces at execution; `buddy hermes doctor <profile>` | done |
| Dynamic schema patching (hide disabled tools from the model) | prompt + RAG + skill-augmentation re-filter | done (parity TODO #9/#32) |
| Profile inspector | `buddy tools profile <id> --json` | done |
| Tool parity catalog | `buddy hermes tools --json`; Cowork Fleet Hermes tool catalog strip | done — CLI and Cowork share the same local manifest and show exact/native/partial/gap counts plus prioritized gaps; current measured tool parity is 65 exact, 6 native-equivalent, 0 partial, 0 gaps |
| Native Fleet/Hermes toolset catalog | `buddy hermes toolsets [profile] --json`; Fleet dispatch profile descriptors | done — shows all five `fleet.hermes.*` toolsets, the active profile, policy group boundaries, and representative allow/confirm/deny decisions without requiring the wider doctor payload |
| Aggregate readiness and local smoke | `buddy hermes status [profile]`; `buddy hermes smoke --json`; Cowork Fleet Hermes local smoke strip via `tools.hermesLocalSmoke.run` | done — combines feature/tool/provider/runtime/browser/protocol/memory/learning/skills readiness and the safe local-first runtime/browser/protocol smoke; Cowork shows pass/fail counts and route totals without raw stdout, trace paths, credential values, or account details |
| Provider/model readiness | `src/agent/hermes-agent-diagnostics.ts`; `buddy hermes providers status --json`; `buddy hermes doctor --json`; `cowork/src/main/tools/hermes-provider-readiness-bridge.ts`; `cowork/src/renderer/components/hermes-provider-readiness-strip.tsx` | covered/partial — active model source, inferred provider, env/OAuth credential source names, tool-call/reasoning/vision flags, context/output limits, Nous Portal status, remediation hints, and Cowork rendering in Settings -> API plus Fleet Command Center |
| Nous Portal readiness | `src/agent/hermes-portal-status.ts`; `buddy hermes portal status|tools|open`; embedded in `buddy hermes doctor --json` | covered/partial — local auth/source readiness, subscription/docs links, Tool Gateway URL/flag detection, managed-vs-direct routing for Firecrawl/FAL/TTS/Browser Use/Modal, and no secret-value output; no live OAuth device-code or Nous proxy runtime yet |
| Memory provider readiness | `src/agent/hermes-memory-providers.ts`; `src/memory/adapters/network-memory-adapters.ts`; `src/memory/adapters/cli-memory-adapters.ts`; `buddy hermes memory status\|probe --json`; `cowork/.../hermes-memory-providers-*` | covered/partial — **6 of 8 providers adapted** with real upstream contracts: Mem0 (self-host REST + cloud), Honcho (v3), OpenViking (`/api/v1`), RetainDB (cloud), Supermemory (v3 cloud), ByteRover (`brv` CLI); all registered, falling back to `local` until configured. `buddy hermes memory probe` runs a live write→read round-trip against a configured instance. Hindsight (Python SDK/daemon) and Holographic (in-process Python SQLite+HRR) are **deliberately out of native-TS scope** (no network/CLI boundary; faking them would be parity-by-label). Self-host guide: `docs/hermes-memory-providers-selfhost.md`. Cloud providers (Supermemory/RetainDB) implemented but not live-validated (no account). |
| Runtime backend inventory | `src/agent/hermes-runtime-backends.ts`; `buddy hermes runtime status --json`; embedded in `buddy hermes doctor --json`; `cowork/src/main/tools/hermes-runtime-backends-bridge.ts`; `cowork/src/renderer/components/hermes-runtime-backends-strip.tsx` | partial — real non-destructive probes for local Node, native OS sandbox, Docker, WSL, SSH, Singularity/Apptainer, Modal, Daytona, and Vercel Sandbox, with version/status, credential source names only, smoke commands, dedicated CLI status, Cowork rendering in Settings -> API plus Fleet Command Center, and opt-in live smoke execution from `buddy hermes runtime-smoke local --json`, `buddy hermes runtime-smoke wsl --json`, or Cowork through real subprocesses; first-class managed remote runners remain future work |
| Browser backend inventory | `src/agent/hermes-browser-backends.ts`; embedded in `buddy hermes doctor --json`; `buddy hermes browser status --json`; `buddy hermes browser-smoke local-playwright --json`; `cowork/src/main/tools/hermes-browser-backends-bridge.ts`; `cowork/src/renderer/components/hermes-browser-backends-strip.tsx` | partial — real non-destructive readiness for local Playwright, remote CDP, Browserbase/Stagehand, Browser Use gateway, Firecrawl, Camofox/Camoufox, and session recording, with credential source names only; local Playwright smoke launches a real Chromium page; Cowork renders the same status in Settings -> API plus Fleet Command Center and can trigger the local smoke; managed backend runners and full session recording remain future work |
| Messaging gateway readiness | `buddy hermes messaging status --json`; `buddy channels status --json`; `cowork/src/main/tools/channel-gateway-readiness-bridge.ts`; `cowork/src/renderer/components/hermes-messaging-gateway-strip.tsx`; `cowork/src/renderer/components/ChannelsPanel.tsx` | partial — Hermes CLI, generic channels CLI, and Cowork now share the same safe channel status report for configured/enabled/runtime/auth counts and the first operator recommendation, without exposing token or webhook values. Exact Hermes per-platform slash parity and gateway lifecycle controls remain future work. |

Cowork Test Runner exposes a safe `Cowork / knowledge Hermes presence bundle`
that now relaunches the Fleet cockpit readiness bridges/strips for provider,
memory, runtime, browser, messaging, mobile supervision, feature parity, tool
catalog, toolsets, learning usage, lessons, skills, and presence from one
operator-visible entry.

### Scheduled automations

| Sub-capability | Where | Status |
|---|---|---|
| Cron jobs as agent tasks | `src/daemon/cron-agent-bridge.ts`; `buddy cron add/list/show/update/pause/resume/run/remove` | done |
| Pre-check scripts (skip expensive LLM work) | `src/scheduler/pre-check-runner.ts` | done |
| No-agent watchdog jobs | `src/scheduler/watchdog-handlers.ts` | done |
| Multi-target delivery + mobile-safe summaries | `src/scheduler/scheduled-delivery.ts` | done |
| Scheduled runs create durable run records/artifacts | `RunStore` wired into the cron loop | done |

Cowork Test Runner now exposes a safe `Hermes / persistence skills real smoke`
entry that relaunches persisted cron, saved-session search, SkillsHub
inspection, skills CLI, and Hermes package summary proofs.

### Delegation and parallelism

| Sub-capability | Where | Status |
|---|---|---|
| Peer delegation / routing | `route_peer`, `peer_delegate`, `src/fleet/task-router.ts` | done |
| Ordered multi-peer chain (Draft→Review→Safe) | `src/tools/peer-chain-tool.ts` (`peer_chain`) | done |
| Read-only peer tool invoke (gated) | `src/fleet/peer-tool-bridge.ts`, `src/fleet/permissions.ts` | done |
| Hermes `execute_code` subprocess boundary | `src/tools/execute-code-runner.ts`, `src/tools/registry/execute-code-tools.ts`, `tests/tools/execute-code-real.test.ts` | done — exact prompt tool name, real local subprocess, timeout, and `.codebuddy/execute-code/<run-id>` artifacts; generated-code-to-tool RPC remains intentionally separate |
| Subagents / swarm | `/agents`, `/swarm`, `/team` | done |

Cowork Test Runner now exposes a safe `Hermes / execute_code real smoke` entry for the same subprocess/artifact/timeout parity proof.

### Voice and media generation

| Sub-capability | Where | Status |
|---|---|---|
| Hermes `text_to_speech` audio generation | `src/tools/text-to-speech-tool.ts`, `src/tools/registry/multimodal-tools.ts`, `tests/tools/text-to-speech-real.test.ts` | done — exact prompt tool name, real local speech audio file, `MEDIA:<path>` result, provider detection for Windows SAPI/macOS `say`/`edge-tts`/`espeak`, plus explicit Kokoro/AudioReader paths |
| Hermes `image_generate` | `src/tools/media-generation-tool.ts`, `src/tools/registry/multimodal-tools.ts`, `tests/tools/media-generation-real.test.ts` | done — exact prompt tool name, configured OpenAI/xAI-compatible HTTP endpoint, b64/URL result handling, and local media cache under `.codebuddy/media-generation/images` |
| Hermes `video_analyze` | `src/tools/video-analysis-tool.ts`, `src/tools/registry/multimodal-tools.ts`, `tests/tools/media-generation-real.test.ts` | done — exact prompt tool name, local/remote video normalization, format and 50 MB caps, base64 `video_url` payload, and configured video-capable model dispatch |
| Hermes `video_generate` | `src/tools/media-generation-tool.ts`, `src/tools/registry/multimodal-tools.ts`, `tests/tools/media-generation-real.test.ts` | done — exact prompt tool name, text-to-video and image-to-video over configured xAI or FAL-compatible HTTP backends, returned video cache under `.codebuddy/media-generation/videos` |

Cowork Test Runner now exposes a safe `Hermes / media vision real smoke` catalog item that relaunches the local TTS, Playwright browser vision, image analysis, and media-generation provider-path smoke tests without requiring paid provider credentials.

### Vision and browser inspection

| Sub-capability | Where | Status |
|---|---|---|
| Hermes `vision_analyze` local image inspection | `src/tools/vision/vision-analysis.ts`, `src/tools/registry/vision-tools.ts`, `tests/tools/vision-analyze-real.test.ts` | done — exact prompt tool name, real image metadata via `sharp`, dominant color/labels, optional local OCR attempt, durable `.codebuddy/vision-analysis/*.json` report |
| Hermes `browser_vision` page screenshot analysis | `src/tools/registry/vision-tools.ts`, `src/codebuddy/tool-definitions/browser-tools.ts`, `tests/tools/vision-analyze-real.test.ts` | done — exact prompt tool name, real Playwright screenshot under `.codebuddy/browser-vision`, local analysis, optional accessibility snapshot context; remote semantic vision remains opt-in/future provider work |

Cowork Test Runner now exposes a safe `Hermes / browser real smoke` entry that
reruns the real Playwright browser action, snapshot, console, dialog, and image
discovery proofs.

### Runs everywhere / gateway / mobile

| Sub-capability | Where | Status |
|---|---|---|
| HTTP + Gateway WS server | `src/server/` (`buddy server`) | done |
| Messaging channels (Telegram/Discord/Slack/…) | channel layer + `delivery.targets`; `buddy hermes messaging status --json`; `buddy channels status --json` | partial — delivery + machine-readable readiness done; full inbound gateway parity is future work |
| Hermes `discord` core REST tool | `src/tools/discord-platform-tool.ts`, `src/tools/registry/discord-tools.ts`, `tests/tools/discord-tool-real.test.ts` | done — exact prompt tool name for `fetch_messages`, `search_members`, and `create_thread`; real HTTP path tested |
| Hermes `discord_admin` REST tool | `src/tools/discord-platform-tool.ts`, `src/tools/registry/discord-tools.ts`, `tests/tools/discord-tool-real.test.ts` | done — exact prompt tool name for guild/channel/role/member/pin inspection plus approval-gated pin, unpin, delete-message, add-role, and remove-role actions; real HTTP path tested |
| Hermes Home Assistant REST tools | `src/tools/homeassistant-tool.ts`, `src/tools/registry/homeassistant-tools.ts`, `tests/tools/homeassistant-tool-real.test.ts` | done — exact `ha_list_entities`, `ha_get_state`, `ha_list_services`, and `ha_call_service`; real HTTP path tested; dangerous service domains blocked before network calls |
| Hermes `mixture_of_agents` | `src/tools/mixture-of-agents-tool.ts`, `src/tools/registry/moa-tools.ts`, `tests/tools/mixture-of-agents-real.test.ts` | done — exact prompt tool name, OpenRouter-compatible real HTTP path, parallel reference calls, failure tolerance, and aggregator synthesis |
| Hermes Spotify tools | `src/tools/spotify-tool.ts`, `src/tools/registry/spotify-tools.ts`, `tests/tools/spotify-tool-real.test.ts` | done — exact `spotify_playback`, `spotify_devices`, `spotify_queue`, `spotify_search`, `spotify_playlists`, `spotify_albums`, and `spotify_library`; real HTTP Web API path tested |
| Hermes `x_search` | `src/tools/x-search-tool.ts`, `src/tools/registry/x-search-tools.ts`, `tests/tools/x-search-tool-real.test.ts` | done — exact xAI Responses `x_search` prompt tool; real HTTP path tested; handle/date validation and citation/degraded-result handling included |
| Hermes Feishu document/comment tools | `src/tools/feishu-tool.ts`, `src/tools/registry/feishu-tools.ts`, `tests/tools/feishu-tool-real.test.ts` | done — exact `feishu_doc_read`, `feishu_drive_list_comments`, `feishu_drive_list_comment_replies`, `feishu_drive_reply_comment`, and `feishu_drive_add_comment`; real Feishu/Lark Open API HTTP paths tested |
| Hermes Yuanbao group/DM/sticker tools | `src/tools/yuanbao-tool.ts`, `src/tools/registry/yuanbao-tools.ts`, `tests/tools/yuanbao-tool-real.test.ts` | done — exact `yb_query_group_info`, `yb_query_group_members`, `yb_send_dm`, `yb_search_sticker`, and `yb_send_sticker`; real HTTP gateway path tested; external sends approval-gated |
| Mobile-safe remote supervision | `buddy hermes mobile status --json`; Cowork Fleet mobile supervision strip; `buddy run mobile-snapshot / mobile-gateway-*`; `/api/mobile/*` routes under `buddy server` | partial — local server routes exist for pairing, read-only snapshots, recall packs, artifact reads, and draft-only follow-up prompts; CLI and Cowork expose the route mount, auth policy, approval queue, blocked operations, and safe next commands. Remote execution and auto-dispatch stay disabled; polished off-device TLS/client UX remains future work. |
| Terminal backends (Docker/SSH/sandbox) | `src/security/` sandbox registry, `SandboxBackendInterface`, `src/agent/hermes-runtime-backends.ts`, Cowork runtime readiness strip | local + Docker/OS/WSL/SSH inventory now visible in Hermes doctor and Cowork; local + WSL live smokes are available when runnable; Daytona/Modal/Vercel are detected/configuration-reported but not first-class managed runners |

Cowork Test Runner now exposes a safe `Hermes / platform connectors real smoke`
entry that reruns the localhost HTTP connector proofs for Discord, Home
Assistant, MoA, Spotify, Feishu, Yuanbao, and X search.

Cowork Test Runner now exposes a safe `Hermes / core workspace real smoke`
entry for the local core alias, `send_message` outbox, and Kanban workspace
persistence proofs.

Cowork Test Runner now exposes a safe `Server / cron status real HTTP` entry
for persisted cron job list/trigger plus daemon and heartbeat report endpoints.

### Research evidence

| Sub-capability | Where | Status |
|---|---|---|
| Trajectory export (redacted) | `buddy run trajectory-export` | done |
| Trajectory compatibility report | `buddy hermes trajectories status --json` | partial: proves native export/recall/evals, not upstream batch compression |
| Golden + policy evals | `buddy run golden-evals / policy-evals` | done |
| Run lineage / fork family tree | `RunStore.getRunLineage`; `buddy run lineage` | done |

### Protocol gateways

| Sub-capability | Where | Status |
|---|---|---|
| MCP client/server | `src/mcp/`; `buddy hermes protocols status --json`; Cowork Hermes protocol gateways strip | done |
| A2A HTTP gateway | `/api/a2a/*`; `buddy hermes protocols-smoke local --json`; Cowork opt-in protocol smoke | done |
| ACP HTTP gateway | `/api/acp/*`; `buddy hermes protocols-smoke local --json`; Cowork opt-in protocol smoke | done |
| ACP editor packaging parity | `buddy hermes protocols status --json` | partial: protocol routes exist, packaged editor workflow not claimed |

Cowork Fleet Command Center now renders the same protocol readiness through
`tools.hermesProtocolGateways.get` and can launch the local smoke through
`tools.hermesProtocolGateways.smoke`. The smoke remains local-only and
non-mutating: it starts a temporary MCP stdio server and loopback A2A/ACP HTTP
routes, then reports the MCP echo and route statuses.

## How to verify

The agent **definition** (system prompt + tool filter + disabled tools) is
verified via vitest; the live `buddy --agent hermes` run below exercises the
same definition through the normal agentic loop and needs a configured provider.

```bash
# The agent loads as a built-in custom agent (verified in CI):
npx vitest run tests/agent/custom-agent-loader-hermes.test.ts

# Inspect the effective profile / tool policy before running:
buddy hermes profile balanced --json
buddy hermes doctor balanced --json
buddy hermes parity --json
buddy hermes tools --json
buddy hermes portal status --json
buddy hermes portal tools --json
buddy hermes mobile status --json
buddy hermes runtime status --json
buddy hermes runtime-smoke local --json
buddy hermes runtime-smoke wsl --json
node scripts/hermes-built-cli-smoke.mjs
npm test -- tests/agent/hermes-cli-status-real.test.ts --run

# Run it (needs a configured provider):
buddy --agent hermes

# Closed learning loop (propose → review → approve, no silent write):
buddy lessons candidate propose "Run tsc before marking done" -c RULE
buddy lessons candidate list --status pending
buddy lessons candidate approve <id> --by "<your name>"
```

## Known gaps (tracked in the parity TODO)

- Auto-applied, provider-backed Honcho-style remote inference over the user
  model. The **local** review-gated LLM dialectic inference layer now exists and
  is wired: `runUserDialecticInference` (`src/memory/user-model.ts`) runs behind
  the default-off `USER_MODEL_DIALECTIC_ON_SESSION_END` flag at session end and
  via `buddy user-model analyze` (use `--local` for the deterministic,
  credential-free path). It proposes **pending-only**, privacy-screened
  observations — nothing enters the active model without `buddy user-model
  accept <id> --by <reviewer>`. Tested by `tests/memory/user-model.test.ts`,
  `tests/agent/user-model-dialectic-hook.test.ts`, and
  `tests/commands/user-model-command.test.ts`. What remains is the *auto-applied*
  Honcho-style variant that mutates the model from a hosted provider, which needs
  external credentials and an operator workflow and is deliberately deferred.
- Stronger automatic promotion/deprecation scoring for generated skills.
- Polished mobile remote-supervision client/off-device TLS packaging. The local
  `/api/mobile` routes and `buddy hermes mobile status --json` readiness surface
  exist, but execution and file mutation remain deliberately local-operator gated.
- Deeper Cowork skill package management is mostly covered in the Fleet
  cockpit. Remaining polish is an optional dedicated full-page space if daily
  skill operations need more room.
- Serverless terminal backends (Daytona/Modal/Vercel Sandbox) are now inventoried by `buddy hermes doctor --json` and Cowork, but not first-class managed runners.
- Exact `skill_manage` prompt-tool parity is closed; repository tap/trust management, direct GitHub/`.well-known` discovery, remote update diff previews, and review-gated reset-from-hub/cache repair are now real persisted CLI/tool surfaces.
- Nous Portal status/catalog parity is covered locally; live OAuth/device-code login
  and actual Nous-managed Tool Gateway proxying remain product/credential work.
- Provider/model readiness is now present in `buddy hermes providers status --json`,
  `buddy hermes doctor --json`, and
  rendered in Cowork's Settings -> API and Fleet Command Center surfaces.
- OpenClaw migration is intentionally last, after the Hermes core and Cowork
  cockpit work are stable.
