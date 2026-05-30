# Hermes Agent in Code Buddy — implementation status

Date: 2026-05-23
Upstream reference: <https://github.com/nousresearch/hermes-agent> (MIT, Nous Research)

Latest official parity audit: [`hermes-agent-official-parity-audit-2026-05-30.md`](hermes-agent-official-parity-audit-2026-05-30.md).
Prioritized implementation backlog: [`hermes-agent-next-todo.md`](hermes-agent-next-todo.md).
That audit was refreshed against upstream `NousResearch/hermes-agent` at `5921d667` and
concludes that Code Buddy has substantial Hermes-inspired coverage but **not**
full feature-for-feature official Hermes parity.

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
| CLI surface | `src/commands/cli/hermes-commands.ts` (registered `src/index.ts` ~L2389) | `buddy hermes plan / profile / doctor / hooks / prompt-size / parity / tools` |
| Diagnostics | `src/agent/hermes-agent-diagnostics.ts` | `buddy hermes doctor <profile>` |
| Lifecycle hooks | `src/hooks/hermes-lifecycle-hooks.ts` | canonical manifest across Code Buddy hook systems |
| Tests | `tests/agent/custom-agent-loader-hermes.test.ts`, `tests/agent/hermes-agent-profile.test.ts`, `tests/commands/hermes-commands.test.ts`, `tests/hooks/hermes-lifecycle-hooks.test.ts`, `tests/agent/hermes-agent-diagnostics.test.ts` | 20 specs, green |

## Hermes capability → Code Buddy implementation

Capabilities below follow the upstream README's headline table.

### Closed learning loop (Hermes' defining feature)

| Sub-capability | Where | Status |
|---|---|---|
| Persistent lessons | `src/agent/lessons-tracker.ts`, `src/tools/registry/lessons-tools.ts` (`lessons_add/_search/_list/_graph`) | done |
| Lesson provenance ("created by" / "used by") | `src/agent/lesson-provenance.ts`; CLI `buddy lessons provenance/use` | done |
| **Agent proposes, human approves (no silent write)** | `src/agent/lesson-candidate-queue.ts` + `lessons_propose` tool + `buddy lessons candidate propose/list/show/approve/discard` | **done (this change)** |
| Retrospective / Learning Agent | `src/agent/learning-agent.ts`; auto hook from `RunStore.endRun`; CLI `buddy run retrospective <run-id>` | done — analyzes real redacted trajectories, writes retrospective artifacts, proposes lessons, materializes review-gated skill candidates |
| Skill creation from experience | `src/agent/research-script-skill-candidate.ts`; `buddy tools skill-candidate`; `skill_manage` prompt tool; Cowork Skill Package Manager strip | partial — installs reviewed research-script and Learning Agent candidates; `skill_manage` now covers real installed-skill list/view/history, direct create/discover, review-gated enable/disable/deprecate/delete/patch/rollback/update, and review-gated candidate list/view/install with immediate lockfile visibility; `skill_manage candidate_list/view` and Cowork report not-installed/current/different/missing state plus a bounded diff preview against the real workspace SkillsHub lockfile; `skills_list`/`buddy skills list --json` expose stale-file integrity state; `buddy skills doctor --json` reports missing/tampered packages with review-gated remediation commands; Cowork now shows installed package state, candidate install state/diff, integrity, usage, lifecycle reviewer/reason, rollback counts, current SKILL.md preview, review-safe commands, reviewer-gated candidate install/overwrite, and reviewer-gated enable/disable/deprecate/rollback/delete/update/patch for installed skills through real main-process bridges; a larger side-by-side diff panel remains future UX work |
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
operator action visible in both CLI and Cowork.

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
| Tool parity catalog | `buddy hermes tools --json`; Cowork Fleet Hermes tool catalog strip | done — CLI and Cowork share the same local manifest and show exact/native/partial/gap counts plus prioritized gaps |

### Scheduled automations

| Sub-capability | Where | Status |
|---|---|---|
| Cron jobs as agent tasks | `src/daemon/cron-agent-bridge.ts`; `buddy cron add/list/show/update/pause/resume/run/remove` | done |
| Pre-check scripts (skip expensive LLM work) | `src/scheduler/pre-check-runner.ts` | done |
| No-agent watchdog jobs | `src/scheduler/watchdog-handlers.ts` | done |
| Multi-target delivery + mobile-safe summaries | `src/scheduler/scheduled-delivery.ts` | done |
| Scheduled runs create durable run records/artifacts | `RunStore` wired into the cron loop | done |

### Delegation and parallelism

| Sub-capability | Where | Status |
|---|---|---|
| Peer delegation / routing | `route_peer`, `peer_delegate`, `src/fleet/task-router.ts` | done |
| Ordered multi-peer chain (Draft→Review→Safe) | `src/tools/peer-chain-tool.ts` (`peer_chain`) | done |
| Read-only peer tool invoke (gated) | `src/fleet/peer-tool-bridge.ts`, `src/fleet/permissions.ts` | done |
| Hermes `execute_code` subprocess boundary | `src/tools/execute-code-runner.ts`, `src/tools/registry/execute-code-tools.ts`, `tests/tools/execute-code-real.test.ts` | done — exact prompt tool name, real local subprocess, timeout, and `.codebuddy/execute-code/<run-id>` artifacts; generated-code-to-tool RPC remains intentionally separate |
| Subagents / swarm | `/agents`, `/swarm`, `/team` | done |

### Voice and media generation

| Sub-capability | Where | Status |
|---|---|---|
| Hermes `text_to_speech` audio generation | `src/tools/text-to-speech-tool.ts`, `src/tools/registry/multimodal-tools.ts`, `tests/tools/text-to-speech-real.test.ts` | done — exact prompt tool name, real local speech audio file, `MEDIA:<path>` result, provider detection for Windows SAPI/macOS `say`/`edge-tts`/`espeak`, plus explicit Kokoro/AudioReader paths |

### Vision and browser inspection

| Sub-capability | Where | Status |
|---|---|---|
| Hermes `vision_analyze` local image inspection | `src/tools/vision/vision-analysis.ts`, `src/tools/registry/vision-tools.ts`, `tests/tools/vision-analyze-real.test.ts` | done — exact prompt tool name, real image metadata via `sharp`, dominant color/labels, optional local OCR attempt, durable `.codebuddy/vision-analysis/*.json` report |
| Hermes `browser_vision` page screenshot analysis | `src/tools/registry/vision-tools.ts`, `src/codebuddy/tool-definitions/browser-tools.ts`, `tests/tools/vision-analyze-real.test.ts` | done — exact prompt tool name, real Playwright screenshot under `.codebuddy/browser-vision`, local analysis, optional accessibility snapshot context; remote semantic vision remains opt-in/future provider work |

### Runs everywhere / gateway / mobile

| Sub-capability | Where | Status |
|---|---|---|
| HTTP + Gateway WS server | `src/server/` (`buddy server`) | done |
| Messaging channels (Telegram/Discord/Slack/…) | channel layer + `delivery.targets`; `buddy channels status --json` | partial — delivery + machine-readable readiness done; full inbound gateway parity is future work |
| Mobile-safe remote supervision | `buddy run mobile-snapshot / mobile-gateway-*` | contract/preview only; no live listener yet (parity TODO #15/#34) |
| Terminal backends (Docker/SSH/sandbox) | `src/security/` sandbox registry, `SandboxBackendInterface` | local + Docker/OS; Daytona/Modal/Vercel not ported |

### Research evidence

| Sub-capability | Where | Status |
|---|---|---|
| Trajectory export (redacted) | `buddy run trajectory-export` | done |
| Golden + policy evals | `buddy run golden-evals / policy-evals` | done |
| Run lineage / fork family tree | `RunStore.getRunLineage`; `buddy run lineage` | done |

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

# Run it (needs a configured provider):
buddy --agent hermes

# Closed learning loop (propose → review → approve, no silent write):
buddy lessons candidate propose "Run tsc before marking done" -c RULE
buddy lessons candidate list --status pending
buddy lessons candidate approve <id> --by "<your name>"
```

## Known gaps (tracked in the parity TODO)

- LLM dialectic inference over the user model (Honcho-style); the local
  observation store + review queue now exist, the inference layer does not.
- Stronger automatic promotion/deprecation scoring for generated skills.
- Live mobile remote-supervision listener (only contracts/snapshots exist).
- Deeper Cowork skill package management. Cowork now exposes lesson-candidate
  approval, the shared SKILL candidate review queue, Learning Agent
  skill-usage telemetry, and read-only installed skill package state, but it
  still needs SKILL.md preview/diff plus reviewer-gated install/disable/
  deprecate/rollback controls.
- Serverless terminal backends (Daytona/Modal/Vercel Sandbox).
