# Hermes Agent power parity TODO

Date: 2026-05-18
Workspace: `D:\CascadeProjects\grok-cli-weekend`
Goal: make Code Buddy approach the useful power of Hermes Agent without
becoming a Hermes fork.

## Sources studied

- Public docs: https://hermes-agent.nousresearch.com/docs/
- Public architecture: https://hermes-agent.nousresearch.com/docs/developer-guide/architecture/
- Public session storage: https://hermes-agent.nousresearch.com/docs/developer-guide/session-storage/
- Public tools/runtime docs: https://hermes-agent.nousresearch.com/docs/developer-guide/tools-runtime/
- Competitor parity audit:
  [`docs/cowork-competitor-audit.md`](cowork-competitor-audit.md)
- Claude Code subagents: https://code.claude.com/docs/en/sub-agents
- Claude Agent SDK overview: https://code.claude.com/docs/en/agent-sdk/overview
- OpenAI Codex CLI: https://developers.openai.com/codex/cli
- Codex ChatGPT plan / remote-control controls:
  https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- Manus Browser Operator: https://manus.im/docs/features/browser-operator
- Local reference clone: `D:\CascadeProjects\_external\hermes-agent`
- Local reviewed commit: `d725407`

## Architecture read

Hermes is powerful because it is not only a chat loop. It is a durable
agent operating system:

1. One central agent core
   - Entry points: CLI, gateway, ACP/editor adapter, API server, batch
     runner, Python library and cron.
   - All routes converge into `AIAgent` / `run_agent.py`.
   - Platform-specific code stays near the entry point; the agent loop
     stays shared.

2. Durable state
   - SQLite database with WAL.
   - Full message history.
   - FTS5 search, including tool names/tool calls and a trigram table for
     substring/CJK search.
   - Session lineage through parent/child session ids.
   - Platform/source tags for CLI, gateway and scheduled runs.

3. Learning loop
   - Memory is part of the prompt lifecycle.
   - Skills are procedural memory, not just commands.
   - The agent is nudged to persist useful knowledge.
   - User modeling is a first-class direction, with pluggable memory
     providers.

4. Tool and toolset boundary
   - Tools self-register into a central registry.
   - Toolsets explicitly decide which tools are visible.
   - Dynamic schema patching avoids asking the model to use unavailable
     tools.
   - Terminal, browser, web, MCP, file, vision, code execution and
     delegation are all tool backends.

5. Execution environments
   - Terminal work can run local, Docker, SSH, Daytona, Singularity,
     Modal or Vercel Sandbox.
   - Browser and web tools are separate backends.
   - `execute_code` lets the agent collapse multi-step scripted work into
     one controlled execution boundary.

6. Gateway and cron
   - The gateway keeps the same agent reachable from many platforms.
   - Cron jobs are agent tasks, not simple shell commands.
   - Scheduled jobs can attach skills, scripts and delivery targets.
   - The gateway handles auth, pairing, delivery, hooks, session routing
     and background maintenance.

7. Subagents and trajectories
   - `delegate_task` creates isolated child agents with restricted tools.
   - Batch/trajectory export makes the system useful for testing and
     training data generation.

## Code Buddy translation

Code Buddy already has strong pieces:

- TypeScript agent loop, provider routing, tools and middleware.
- Cowork as the human cockpit.
- Fleet sagas for multi-agent dispatch.
- Lessons graph and Obsidian-style vault export.
- Scheduled tasks, Activity Feed and Fleet outcome reuse.
- Browser proof loop (`observe` / `extract` / `assert_text`) direction.
- Hermes custom-agent profile and `buddy hermes plan`.

## Competitor parity audit summary

The 2026-05-18 competitor audit adds four product benchmarks:

- **Hermes Agent**: closed learning loop, FTS recall, skills, scheduled
  automations, gateway channels, subagents and script/RPC compression.
- **Claude Code / Claude Cowork style**: durable file-backed skills,
  memory, slash commands, plugins and subagent definitions with explicit
  tools, permissions, MCP, hooks, isolation and background settings.
- **OpenAI Codex / Codex Windows**: controlled local editing/running in a
  selected directory, native Windows/PowerShell surface, subagents, web
  search, scripting, MCP, approval modes, cloud handoff and remote
  supervision controls.
- **Manus Browser Operator**: permissioned browser sessions, local
  logged-in tabs when useful, isolated cloud browser for broader work,
  dedicated action tab, stop control and logged actions.

Main conclusion: Code Buddy's pieces are strong, especially for a
Windows-first Cowork/Fleet stack, but the missing product layer is the
unified operator loop: every plan, run, artifact, memory, lesson and next
action should be visible and resumable from CLI and Cowork.

The gap is mainly product integration and durability:

- Code Buddy has many pieces, but Hermes makes the pieces feel like one
  operating system.
- Code Buddy needs stronger lineage from intent -> plan -> run -> tools
  -> artifacts -> memory -> next run.
- Code Buddy needs script/sandbox jobs to become first-class artifacts,
  especially for web research and lead discovery.
- Code Buddy needs tool profiles to become actual enforcement, not only
  labels and prompt posture.

## TODO list

### P0 - Operating spine

1. Define the canonical Code Buddy "agent run" contract.
   - Fields: run id, source surface, profile, prompt, plan id, parent run,
     tool policy, cwd, artifact paths, memory inputs, outcome id.
   - Surfaces: CLI, Cowork, scheduled task, Fleet saga, future mobile.
   - Acceptance: one JSON shape can explain a run in CLI and Cowork.
   - Status: first pass implemented in `src/agent/agent-run-contract.ts`.
     Cowork scheduled Fleet dispatch drafts now embed the canonical
     `agentRun` metadata plus flat `agentRunId` / `agentRunSchemaVersion`
     fields for list/search surfaces.

2. Add run lineage across existing systems.
   - Link Hermes plan -> Fleet saga -> scheduled task -> Activity Feed ->
     outcome memory -> lessons entry.
   - Acceptance: Cowork can answer "what created this result?" and
     "what should continue next?"
   - Status: first execution path implemented. Scheduled Fleet tasks now
     preserve `agentRun`, `agentRunId`, `agentRunSchemaVersion`,
     `parentRunId`, `outcomeId`, source session, delivery channel,
     target peers, memory count and Hermes plan metadata in Activity
     Feed entries. Scheduled Fleet executions pass the compact lineage
     into `dispatchFleetSaga`, saga records keep it, terminal Fleet
     activity re-emits it, and Cowork renders compact run/parent/outcome
     chips.

3. Make Fleet outcome reuse fully deterministic.
   - Current status: outcome action labels and dispatch preset helper
     exist.
   - Next: reuse should create an explicit follow-up run draft with
     inherited profile/privacy/proof/memory metadata.
   - Acceptance: no implicit metadata mutation; the draft shows exactly
     what it inherited.
   - Status: first pass implemented. `FleetOutcomeDetail` now builds a
     canonical draft `AgentRun` when "Use as next goal" is clicked. If the
     follow-up is scheduled, Cowork carries `parentRunId`, `outcomeId`,
     saga, Hermes plan and source-session lineage into the scheduled
     dispatch draft. The active dispatch form now also shows a compact
     follow-up run draft preview before immediate dispatch, including
     inherited run, parent, outcome, Hermes, privacy, targets, memory,
     proof and toolset context.

### P1 - Learning loop

4. Split memory and lesson promotion.
   - Memory: short project facts and reusable context.
   - Lesson: procedural pattern, with prerequisites, steps, traps and
     verification.
   - Acceptance: Cowork has two separate actions: "Save memory" and
     "Save lesson".
   - Status: first pass implemented for Fleet outcomes. Outcome details
     now keep the existing operator-triggered "Save as memory" action and
     add a separate operator-triggered "Save as lesson" action that writes
     procedural Markdown through the lessons tracker.

5. Add lesson provenance.
   - Record which run/outcome created each lesson.
   - Record which future runs loaded that lesson.
   - Acceptance: a lesson page can show "created by" and "used by".
   - Status: implemented via a side-car index. Fleet outcome lessons already
     embed outcome/saga/AgentRun context in the lesson body.
     `src/agent/lesson-provenance.ts` now adds a formal index
     (`.codebuddy/lessons-provenance.json`) that keeps each lesson's "created
     by" (run/outcome/saga) and "used by" (runs that loaded it) links without
     touching the `lessons.md` format or the per-turn injection hot path.
     `LessonsTracker.add()` accepts optional provenance and records "created
     by"; `recordUsage(lessonId, runId)` is idempotent per pair. CLI:
     `buddy lessons provenance <lessonId> [--json]` shows both sides, and
     `buddy lessons use <lessonId> --run <runId>` records a usage link.
     Auto-recording usage at lesson-injection time is the remaining optional
     hot-path wire.

6. Add a lessons cockpit in Cowork.
   - Load `buddy lessons graph --vault`.
   - Show concepts, backlinks, related runs and related outcomes.
   - Acceptance: user can browse the mini-Obsidian vault from Cowork.
   - Status: first read-only Cowork pass implemented. The Fleet Command
     Center now renders a `LessonsVaultStrip` for the active workspace,
     backed by a `tools.lessonsVault.preview` IPC bridge that loads the
     existing lessons graph/vault manifest without writing files. It shows
     lesson/concept/relation/file counts, top concept pages, CLI export
     commands and a review-profile Fleet goal draft. Full backlink/outcome
     browsing remains future work.

7. Add automatic lesson candidates, not automatic lesson writes.
   - Agent proposes a lesson after complex successful runs.
   - Human approves, edits or discards.
   - Acceptance: no silent procedural memory mutation.
   - Status: implemented. Cowork can save a generated lesson from a
     selected Fleet outcome, but only after an explicit operator click. The
     general lesson candidate-review queue now exists in
     `src/agent/lesson-candidate-queue.ts`: the agent proposes lessons via the
     `lessons_propose` tool (or `buddy lessons candidate propose`), candidates
     persist to `.codebuddy/lesson-candidates.json` and are **never** written to
     `lessons.md` until a human approves one. `buddy lessons candidate
     list/show/approve/discard` is the CLI review surface; `approve` requires an
     explicit `--by <reviewer>`, supports inline edits, routes the write through
     `LessonsTracker.add` with provenance, and links the created lesson id back
     onto the candidate. The shared SKILL candidate queue (`buddy tools
     skill-candidate`) now covers research-script promotion and Learning Agent
     Hermes-style SKILL.md candidates. Cowork exposes that review-gated queue
     from the Fleet Command Center, including candidate kind, source run and
     tool-sequence context.

### P1 - Toolsets and policy enforcement

8. Turn `fleet.hermes.<profile>` into enforced tool filters.
   - Safe: read/search/browser proof, no filesystem mutation unless
     approved.
   - Research: web/search/read/extract/proof, limited writes to artifacts.
   - Code: file edit/test/build with write policy.
   - Review: read-only plus report.
   - Acceptance: the tool registry denies out-of-profile calls.
   - Status: first pass implemented. Dispatch profile policy decisions can
     now become a `ToolFilterConfig`, custom agents with
     `fleetDispatchProfile` apply that filter against real Code Buddy tool
     names, and `buddy hermes doctor <profile> --json` shows the effective
     allowed/denied tool patterns for the requested Hermes profile. Direct
     runtime calls to `route_peer` and `peer_delegate` now also reject unknown
     explicit `dispatchProfile` values before peer discovery/delegation, so
     invalid profiles cannot silently fall back to `balanced`. Runtime schema
     tests now prove the `safe` and `review` profile filters remove mutation
     and execution tools such as `create_file`, `bash` and `git_push` from the
     model-facing tool schemas. Peer-side `peer.dispatch` now also returns the
     resolved profile, tool policy, per-tool decisions, toolset descriptor and
     trace id in the immediate acceptance payload, so asynchronous Fleet work is
     auditable before the first status poll. Cowork saga execution now persists
     that acceptance snapshot immediately and carries the resolved toolset id
     into terminal Activity Feed metadata for follow-up runs. The shared
     `ToolHandler` now enforces the same active filter at execution time, so a
     stale or malformed call to a hidden tool is blocked before registry
     dispatch, checkpoints, hooks or streaming command launch. Blocked filter
     attempts now emit `decision` + failed `tool_result` telemetry without
     emitting `tool_call`, which keeps policy evals honest: blocked mutation
     attempts remain visible but are not counted as executed tools. Cowork's
     Audit Log policy eval summary now also surfaces those filter blocks as
     `toolFilterBlocks` with count and tool names, so the operator can see
     "requested but blocked" directly in the cockpit instead of opening raw
     trajectory JSON. Run recall packs now include the same deduplicated
     active-filter policy blocks under each matching run, making blocked
     attempts searchable and portable into Fleet follow-up drafts.

9. Add dynamic schema patching like Hermes.
   - Tool descriptions should not reference unavailable tools.
   - Acceptance: when a profile disables a tool, model-facing schemas stop
     mentioning it.
   - Status: prompt + runtime first pass implemented. Global
     CLI/custom-agent/Fleet filters already prune `getAllCodeBuddyTools()`
     and RAG selections; skill augmentation now re-applies the active filter
     after adding required tools, so skills cannot reintroduce a hidden tool.
     PromptManager tool lists are filtered through the same contract, memory
     and lessons directives are suppressed when their tools are hidden, and
     workflow guidance omits browser/web/task verification tool names that
     are not present in the model-facing schema. Custom-agent Fleet profile
     tests now exercise the actual `filterTools()` runtime path so safe/review
     schema patching is protected as behavior, not only a descriptor diff.

10. Add a profile inspector.
    - CLI: `buddy tools profile hermes-safe --json`.
    - Cowork: profile panel with allowed/blocked tool groups.
    - Acceptance: user can see exactly what an agent can do before run.
    - Status: CLI and Cowork first pass implemented. `buddy tools profile` accepts
      profile ids such as `hermes-safe`, `fleet.hermes.review` or `code`,
      inspects either the real built-in tool list or a provided subset, and
      prints JSON/text with effective allow/deny filters plus per-tool
      decisions. Cowork's Fleet Command Center now renders a
      `ToolProfileInspectorStrip` beside the dispatch controls, using the
      same Hermes/Fleet descriptor to show `fleet.hermes.<profile>`,
      allow/confirm/deny counts, the policy summary and per-tool decisions
      before the run starts.

### P1 - Script sandbox pipeline

11. Make generated scripts first-class job artifacts.
    - Store script, inputs, allowed domains, command, output files,
      assertions and cleanup policy.
    - Acceptance: a script is never just hidden inside chat.
    - Status: first pass implemented. `ResearchScriptJobArtifact` now
      defines the script job envelope with manifest/script/input/output/log
      paths, command, sandbox policy, allowed/ignored domains, assertions
      and an `AgentRun` script artifact pointer. Lead Scout enrichment plans
      now embed this artifact shape next to the protected generated script.

12. Add sandboxed "research script" runner.
    - Use current Node/PowerShell/Python environment as a controlled local
      executor first.
    - Later add Docker/WSL/remote sandbox providers.
    - Acceptance: script runs write into a run-specific artifact folder.
    - Status: first local pass implemented. `materializeResearchScriptJobArtifact`
      creates the run-specific artifact folder without executing network
      code, writes manifest/README/script/input/output/stdout/stderr/summary
      files, marks output as `not_run`, refuses path traversal, and protects
      existing artifacts unless overwrite is explicitly requested.
      `runMaterializedResearchScriptJob` can then execute local materialized
      jobs with spawn-without-shell, executable allowlist, minimal inherited
      environment, output/log/summary capture, timeout handling, and a
      default refusal for network-enabled policies unless the caller opts in.
      Docker/WSL/remote isolation remains future work.

13. Add OSINT/lead discovery workflow template.
    - Inputs: public search query, region, target role, allowed sources,
      fields to extract, contact policy.
    - Steps: search -> site discovery -> page extraction -> contact field
      extraction -> dedupe -> evidence -> export.
    - Guardrails: public data only, no login bypass, no spam/send action.
    - Status: first pass implemented. `LeadDiscoveryWorkflowTemplate`
      now captures public-only inputs, the seven-stage search/site/page/
      contact/dedupe/evidence/export workflow, review-only contact policy,
      expected artifacts and a linked `ResearchScriptJobArtifact`. Regular
      `lead_scout_plan` results embed the template for CLI/Cowork/tool
      consumers. Cowork's Fleet Command Center now also shows a compact
      public-data workflow preview when the dispatch profile is `research`;
      it can seed a Fleet goal or scheduled task with review-only metadata.
    - Acceptance: produces CSV/JSON with source URLs and proof notes.

14. Promote working scripts into skills.
    - If a research script succeeds twice, propose a SKILL.md package.
    - Acceptance: script pattern becomes reusable procedural memory.
    - Status: review/install first pass implemented.
      `buildResearchScriptSkillCandidate` converts a
      `ResearchScriptJobArtifact` plus successful run results into a
      review-only `SKILL.md` candidate under
      `.codebuddy/skill-candidates/...`, and keeps the candidate ineligible
      until the success threshold is met. Candidates can now be
      materialized with a `candidate-review.json`, inspected from the CLI
      with `buddy tools skill-candidate inspect`, listed as a review queue
      with `buddy tools skill-candidate list`, and installed into
      `.codebuddy/skills/...` only with explicit `--approved-by` review.
      The installer preserves reviewer edits and refuses ineligible or
      unapproved candidates. Automatic install/promotion remains out of
      scope by design. Cowork's Fleet research profile now also loads this
      queue through the read-only `tools.skillCandidate.list` bridge and
      shows a compact `SkillCandidateReviewQueueStrip` with eligible
      candidates, CLI review commands and a "review queue as goal" handoff.

### P2 - Gateway and mobile control

15. Design a narrow remote-control gateway for mobile.
    - Start with authenticated local/network API, not 20 platforms.
    - Actions: inspect runs, approve/cancel, send prompt, view artifacts.
    - Acceptance: phone can supervise, not silently execute dangerous work.
    - Status: contract seed + Cowork copy surface implemented. `buddy run
      mobile-snapshot <query>` builds a redacted, review-only supervision
      payload from recall-pack evidence. `buddy run mobile-gateway-contract
      <query>` now describes the narrow local-first API shape for a future
      phone/Cowork bridge: snapshot, artifact open, recall-pack copy and
      follow-up draft. Each route carries auth, side-effect and action-policy
      metadata, while blocked operations explicitly deny tool execution, file
      mutation, email/outreach, secret reads and pushes. Cowork's Audit Log can
      request the snapshot and the gateway contract through read-only bridges
      and copy either as JSON from the current search. It still does not expose
      a network listener or approval endpoint yet.
      `buddy run mobile-gateway-check <query> --action <action> --method
      GET|POST --path <path> [--local-operator]` now evaluates one hypothetical
      route against that contract, so the future listener has a tested
      allow/deny boundary before it exists.
      `buddy run mobile-gateway-review-draft <query> --action <action>
      --method GET|POST --path <path>` now wraps the same decision into a
      local-only operator review draft with approve/cancel/reject actions but
      no automatic dispatch. Cowork's Audit Log can now copy that follow-up
      review draft from the same current-search context, giving the future
      phone surface a tested local approval envelope before any listener or
      mutation endpoint exists. `buddy run mobile-gateway-listener-shell
      <query>` now adds the next implementation artifact: a disabled loopback
      listener plan with route handlers, auth posture, acceptance checks and
      blocked-operation stubs, but still no started server or mutation route.
      Cowork's Audit Log now mirrors that shell through a copy-only action,
      keeping CLI and cockpit supervision artifacts aligned.
      `buddy run mobile-pairing-state <query>` adds the next no-network
      pairing artifact: a preview-only local code, fingerprint, TTL, scopes and
      operator checklist. It keeps `tokenIssued=false`, `persisted=false`,
      `serverStarted=false` and `notAcceptedByAnyServer=true`, so pairing
      semantics can be tested before any real listener accepts codes. Cowork's
      Audit Log mirrors the same artifact through a copy-only "Copy pairing
      state" action.
      `buddy run mobile-pairing-acceptance-plan <query>` now defines the next
      no-network mutation boundary for pairing acceptance: the future
      `/api/mobile/pairing/accept` route, required evidence, session/token
      mutations and approval-enablement steps are visible, but every mutation
      remains `enabled=false` until a real loopback listener and local operator
      flow are implemented. Cowork's Audit Log mirrors that same envelope with
      a "Review acceptance" panel and copy-only "Copy acceptance plan" action
      from the current search.
      `buddy run mobile-approval-queue <query>` adds the local approval queue
      layer: read-only routes are marked ready, draft-only follow-ups are
      pending local operator approval, and dangerous operations remain blocked
      with reject-only actions. Cowork mirrors it with a copy-only "Copy
      approval queue" action and a visible local review panel that renders
      ready/pending/blocked counts plus the no-mutation/no-dispatch guardrails;
      pending items can be copied as their own local operator review draft, and
      approval mutation endpoints remain disabled.

16. Add delivery channels after Cowork is stable.
    - Telegram/Discord/email can come later through one delivery interface.
    - Acceptance: scheduled runs can deliver summaries without changing
      the agent loop.
    - Status: implemented over the existing channel layer. `CronJob.delivery`
      now supports multiple `type:id` `targets` (e.g. `telegram:123`,
      `discord:456`, `email:ops@x.com`) in addition to the legacy single
      `channel`, and `CronAgentBridge.deliverResult` fans out to all targets in
      one pass through the existing `getChannelManager().send()`, surviving a
      single channel failure and reporting the delivered `channels[]`.
      `src/scheduler/scheduled-delivery.ts` holds the pure helpers
      (`collectDeliveryTargets`, `resolveDeliveryBody`, `formatScheduledSummary`).
      Delivery happens in the bridge, never in the agent loop, so the acceptance
      holds. Webhook delivery is unchanged. The full set of platform channels
      remains gated behind their own configuration/onboarding.

17. Add mobile-safe notification payloads.
    - Include run title, status, risk level, requested approval and links.
    - Acceptance: no secrets or full prompts in push payloads.
    - Status: first payload shape implemented via the mobile snapshot:
      secrets are redacted before CLI JSON/text output, and the payload only
      carries review summaries, artifact paths and recall context. Scheduled
      deliveries now also support a `delivery.format: 'summary'` mobile-safe
      body via `formatScheduledSummary`: a compact header (job name, status,
      optional risk) plus a secrets-redacted, length-capped excerpt of the
      output — never the original prompt.

### P2 - Cron and scheduled autonomy

18. Make scheduled tasks agent-native.
    - Current scheduler is useful; next step is a structured agent-run
      contract for each scheduled execution.
    - Acceptance: a schedule creates run records and artifacts, not only a
      chat/session side effect.
    - Status: implemented for cron execution. Scheduled Fleet dispatches
      already carry canonical run identity and follow-up lineage into
      execution and Activity Feed records. `CronAgentBridge` now also accepts a
      `runStore` and, when wired (the `buddy daemon` cron loop passes
      `RunStore.getInstance()`), each scheduled execution creates a durable run
      record: a `Cron: <name>` run with `channel:'scheduled'` + `cron`/task-type
      tags, a `cron_job_start` decision event, the output persisted as an
      `output.md` artifact (plus a `delivery.json` artifact when delivered),
      and a `completed`/`failed` close. Pre-check skips and watchdog runs are
      recorded the same way, so a schedule produces inspectable runs/artifacts
      (`buddy run list`/`show`/`search`/`lineage`) rather than only a
      chat/session side effect. Recording is opt-in and fully guarded, so it
      can never break job execution.

19. Add pre-check scripts for scheduled tasks.
    - Similar to Hermes cron pre-checks.
    - Example: only run lead discovery if the seed source changed.
    - Acceptance: cron can skip expensive LLM work with evidence.
    - Status: implemented. `src/scheduler/pre-check-runner.ts` evaluates a
      non-LLM pre-check before a scheduled job. Two kinds: `file_changed`
      (fingerprints one or more paths/dirs; runs only when the content
      fingerprint differs from the previous run, first run always runs) and
      `command` (spawns a bounded local guard without a shell, gating on
      `exit_zero` / `exit_nonzero` / `stdout_changed`). `CronJob.preCheck`
      carries the config plus a persisted `lastFingerprint`. `CronAgentBridge`
      evaluates the pre-check before the task switch: when `shouldRun` is false
      it returns a `skipped` result with evidence and never instantiates the
      agent, and it always persists the new fingerprint back onto the job. The
      runner fails open (runs the job) if the pre-check itself errors, so a
      broken guard can never silently disable a schedule. Note: a skipped run
      still counts toward the job's `runCount`/`maxRuns`, since the scheduler
      treats a pre-check skip as a successful (cheap) evaluation rather than a
      no-op. A persist->reload roundtrip test proves the recorded fingerprint
      survives a scheduler restart and drives the next skip.

20. Add no-agent watchdog jobs.
    - Disk checks, server pings, repo status, build status.
    - Acceptance: simple monitors do not burn LLM calls.
    - Status: implemented. `src/scheduler/watchdog-handlers.ts` adds a
      `watchdog` `CronJob.task.type` whose checks run directly — no
      `CodeBuddyAgent`, no provider call. Four check kinds: `disk` (free
      bytes/percent threshold via `fs.statfsSync`), `http` (GET probe with
      timeout, alert on status >= threshold or unreachable), `repo`
      (`git status --porcelain`, alert on dirty when `expectClean`), and
      `build` (spawn an allowlisted build command, alert on non-zero exit).
      Each check resolves to `ok` / `alert` / `error`; the aggregate
      `watchdogOk` is false when any check alerts or errors. `CronAgentBridge`
      dispatches the new `watchdog` case without touching the LLM paths.
      Authoring surface: `buddy cron add <name> --cron <expr> --watchdog
      <json|@file>` (and `--pre-check` for item 19) — see `buddy cron
      list/show/remove`.

### P2 - Context and session search

21. Upgrade session search to Hermes-level recall.
    - FTS over messages, tool names, tool calls and artifacts.
    - Snippets with match highlighting.
    - Source filters: CLI, Cowork, scheduled, Fleet, mobile.
    - Acceptance: "find when we built architect scraper" returns the
      relevant run, files and outcome.
    - Status: partial first pass. SQLite session message FTS already
      covers chat recall; `RunStore.searchRuns()` and `buddy run search`
      now search run summaries, event payloads and capped text artifacts
      with ranked snippets. `buddy run search --source` filters by
      channel/tag/source aliases such as `cli`, `cowork`, `fleet`,
      `scheduled` and `mobile`, and `buddy run search --json` exposes the
      same ranked recall surface for future Cowork/Manus UI consumers with
      `schemaVersion`, `generatedAt` and effective `filters` metadata. Cowork's
      Audit Log now uses a read-only `audit.searchRuns` bridge and search input
      to show matching run/artifact/event snippets in the cockpit, with a source
      filter for CLI/Cowork/Fleet/scheduled/mobile recall that also applies to
      the normal run list and CSV export. Run artifacts now also write into a
      durable local SQLite FTS5 index (`artifact-index.sqlite`) when saved, and
      `RunStore.searchRuns()` consults that index before falling back to the
      file scan. A regression proves artifact recall survives a store restart
      even when the original artifact file is no longer present. Historical
      run folders can now be backfilled with
      `buddy run index-artifacts [--source ...] [--json]`, so copied or
      pre-index runs become searchable without replaying the original work.

22. Add context compression lineage.
    - When a session compresses or forks, record parent/child links.
    - Acceptance: Cowork can show a thread family tree.
    - Status: implemented for runs. `RunStore.forkRun` already records
      `metadata.parentRolloutId` + `forkReason` when a run is forked (retry,
      checkpoint-rollback, A/B variant). `RunStore.getRunLineage(runId)` now
      reconstructs the full fork family: the ancestor chain upward (cycle- and
      depth-guarded, with pruned parents flagged) and the descendant subtree
      downward. `buddy run lineage <runId> [--json]` renders the family tree;
      the JSON is the shape a Cowork "thread family tree" view consumes. Wiring
      session compaction itself to emit a fork run is the remaining step.

23. Add "recall pack" generation.
    - Summarize relevant sessions, lessons, memories and artifacts for a
      new run.
    - Acceptance: long-term memory enters the run as a cited bundle.
    - Status: first run/artifact pass implemented. `buildRunRecallPack()`
      groups ranked `RunStore.searchRuns()` matches by run, preserves snippets,
      artifacts/events, source, tags and run metadata, and emits a compact
      `promptContext`. CLI access is available as
      `buddy run recall-pack <query> [--source ...] [--json]`, and Cowork can
      retrieve the same envelope through the read-only `audit.buildRecallPack`
      IPC bridge. The Audit Log can now copy the current search's agent-ready
      recall pack to the clipboard and passes the active workspace in read-only
      mode so matching `lessons.md` entries can join the handoff. CLI recall
      packs can also include matching lessons with `--lessons --max-lessons <n>`.
      Session recall is now available through `--sessions --max-sessions <n>`
      and through Cowork's copy action, so saved conversation snippets can join
      run/artifact/lesson evidence in the same bundle. Memory recall is now
      available with `--memories --max-memories <n>` and through Cowork's copy
      action. It reads existing `CODEBUDDY_MEMORY.md`, project `MEMORY.md` and
      user memory files without creating or modifying memory state. CLI users
      can also use `--all-context` to include lessons, memories and sessions in
      one handoff command. Cowork's Audit Log now also has a "Send to Fleet"
      action that builds the same recall pack, opens Fleet Command Center with
      a prefilled `research` / `public` draft goal, and keeps outreach disabled
      unless an operator explicitly approves it. This is a handoff only; it
      does not dispatch or contact anyone automatically.

### P3 - Plugins and extensibility

24. Add plugin boundaries for memory providers and context engines.
    - Keep SQLite/local files as default.
    - Optional adapters later: Mem0, Honcho-like user modeling,
      Supermemory-style external memory.
    - Acceptance: changing provider does not affect the agent loop.
    - Status: memory-provider boundary implemented (context-engine boundary
      already exists via `ContextEngine`/`registerContextEngine`).
      `src/memory/memory-provider.ts` defines an async-friendly `MemoryProvider`
      interface, a `LocalMemoryProvider` that wraps the existing
      `PersistentMemoryManager` (so SQLite/markdown stays the default and source
      of truth), and a `MemoryProviderRegistry` (`getMemoryProviderRegistry` /
      `getActiveMemoryProvider`). The default active provider is `local`, so the
      agent loop is unaffected until a caller explicitly registers and activates
      an adapter (Mem0/Honcho/Supermemory). Those network adapters and the
      Cowork selector remain future work. A *structured local user model* now
      also exists as a sibling system (`src/memory/user-model.ts`): typed,
      review-gated observations (preference/trait/expertise/working-style) about
      the user's working preferences, proposed via the `user_model_observe` tool
      (or `buddy user-model observe`) and folded into the active model only on
      explicit `buddy user-model accept --by <reviewer>`. A privacy screen
      refuses health/finance/relationship/credential content. This is the
      file-backed half of "a deepening model of who you are"; LLM dialectic
      inference (Honcho-style) over it remains future work.

25. Add hook lifecycle.
    - Hooks: before tool call, after tool call, before memory write, after
      run complete, before scheduled delivery.
    - Acceptance: observability and guardrails do not require editing core.
    - Status: first pass implemented. `buddy hermes hooks --json` now emits
      a canonical lifecycle manifest across existing Code Buddy hook systems.
      The runtime has explicit user-hook events for `BeforeMemoryWrite`,
      `AfterRunComplete`, and `BeforeScheduledDelivery`; `remember` can be
      blocked or rewritten before durable memory storage, `RunStore.endRun`
      emits a non-blocking completion hook, and cron delivery checks the
      scheduled-delivery hook before webhook/channel sends.

26. Add skill/package manager in Cowork.
    - Browse SKILL.md packages.
    - See usage telemetry.
    - Enable/disable per profile.
    - Acceptance: skills feel like installed capabilities, not loose files.
    - Status: CLI management surface implemented. `buddy skills list/usage/
      enable/disable` browses installed packages, shows local usage telemetry
      (invocations, success/fail, average duration) and toggles an `enabled`
      flag on the SkillsHub lockfile (backward compatible — absent = enabled).
      `SkillsHub.listEnabled()` is the set selection should consult. The Cowork
      UI panel, per-profile scoping and selection-time enforcement (excluding
      disabled packages from prompt injection) remain future work.

### P3 - Testing and training evidence

27. Add run trajectory export.
    - Export prompt, selected context, tool calls, results and final answer
      with privacy redaction.
    - Acceptance: useful for debugging and future training/eval.
    - Status: first pass implemented. `buddy run trajectory-export <run-id>`
      exports a redacted review trajectory with run metadata, prompt sources,
      selected context, tool calls, tool results, artifact metadata, optional
      capped artifact previews and final answer detection. Cowork's Audit Log
      can copy the same redacted JSON from an expanded run, keeping trajectory
      review inside the cockpit without replaying tools or mutating state.
      `buddy run trajectory-batch [query]` now adds the Hermes-style batch
      surface: matching stored runs or explicit `--run-id` values are exported
      through the same redaction boundary and bundled with a bounded compressed
      agent context.

28. Add golden workflow evals.
    - Lead discovery, code fix, doc workshop, Fleet review, recall handoff,
      scheduled run.
    - Acceptance: each has a repeatable test fixture and expected
      artifacts.
    - Status: recall handoff coverage added. The `recall-handoff` golden
      fixture proves an Audit Log/Fleet continuation preserves the recall
      pack `Policy blocks:` section with active tool-filter evidence, keeps a
      reviewable handoff artifact, and does not perform outreach while
      preparing follow-up context.

29. Add policy evals.
    - Ensure safe/review profiles cannot mutate files.
    - Ensure public-data workflows keep source URLs.
    - Acceptance: safety is tested as behavior, not only docs.
    - Status: first CLI/contract pass implemented. `buddy run policy-evals
      --json` exposes safe-profile, review-profile and public-data safety
      policies, and `buddy run policy-evals <policy-id> <run-id> --json`
      evaluates a redacted trajectory export without replaying tools. The
     tests cover read-only safe/review behavior, mutation-tool failure, source
     URL preservation and outreach-tool failure. Cowork's Audit Log now mirrors
     this from an expanded run as a copy-only `policy_eval_report`, so the same
     guardrails are visible in the cockpit without replaying tools. The policy
     report now includes active tool-filter block summaries, and the renderer
     shows their count and tool names next to the redacted/read-only guardrails.

### P0/P1 - Competitor parity gaps added by 2026-05-18 audit

30. Make every long-running CLI/Cowork action create or link an
    `AgentRun` and visible work item.
    - Benchmark: Hermes durable work loop, Codex long-horizon tasks.
    - Acceptance: a user can open Cowork and see all active/recent agent
      work with source, risk, artifacts, next action and owner.

31. Add Audit Log -> Fleet recall-pack handoff.
    - Benchmark: Codex/Manus style continuation from evidence.
    - Status: first pass implemented. The current Audit Log search can
      send a recall pack to Fleet as an inspectable draft goal with
      `research` profile and `public` privacy. It does not auto-dispatch.
      Recall packs now include active tool-filter policy block summaries, and
      the new `recall-handoff` golden eval protects that evidence through the
      Fleet continuation path.
    - Acceptance: user can continue a cited run/memory/session bundle
      from Cowork without copying text through chat.

32. Finish dynamic schema patching for enforced profiles.
   - Benchmark: Claude subagent tool/permission boundaries and Hermes
     toolsets.
   - Acceptance: when a Fleet/Hermes profile disables a tool, the
     model-facing schema and prompt stop advertising that tool.
   - Status: first schema and prompt leaks closed. Skill-required tool
     augmentation now re-applies active tool filters before returning schemas
     to the agent. Prompt guidance now reads the same active filter: explicit
     PromptManager tool sections are filtered, memory/lessons instructions
     disappear when those tools are hidden, and workflow proof rules only name
     available web/browser/verification tools. Multi-turn Fleet peer sessions
     now also keep their starting dispatch profile immutable: `continue` and
     `continue-stream` reject unknown, late-added or changed `dispatchProfile`
     before any peer LLM call. Custom-agent tests now also verify that safe and
     review Fleet profiles remove mutation/execution tools from model-facing
     schemas through the shared runtime filter, and `ToolHandler` now enforces
     that same filter at tool execution time for both normal and streaming
     paths.

33. Add Browser Operator mode.
    - Benchmark: Manus local browser operator plus isolated cloud browser
      split.
    - Acceptance: local browser use requires explicit session consent,
      runs in a visible/dedicated tab, logs actions and can be stopped.
    - Status: first side-effect-free contract implemented.
      `buildBrowserOperatorSessionDraft()` turns an Internet Scout plan
      into an inspectable operator draft with isolated/local mode, consent
      state, dedicated tab label, stop control, planned action log and
      proof export manifest. CLI review is now available through
      `buddy tools browser-operator draft`, including JSON output for
      future Cowork review surfaces. Cowork's Fleet research profile now
      renders the same draft as an inspectable review strip that can seed
      a Fleet goal or scheduled review. Runtime browser execution controls
      remain future work.

34. Add mobile-safe remote supervision.
    - Benchmark: Hermes gateway and Codex remote-control controls.
    - Acceptance: phone can list runs, open artifacts, approve/cancel and
      send prompts without exposing secrets or silently executing risky
      work.
    - Status: CLI + Cowork copy contract seed implemented. `buddy run
      mobile-snapshot` creates a review-only payload with redacted recall
      context, allow/blocked action lists and local-approval posture.
      `buddy run mobile-gateway-contract` adds the next contract layer for
      the future authenticated phone bridge without exposing remote execution.
      Cowork's Audit Log now has "Copy mobile snapshot" and "Copy mobile
      contract" actions for the active run search. Runtime phone UI,
      authenticated gateway,
      approve/cancel endpoints and prompt submission remain future work.

35. Add generic hook lifecycle.
    - Benchmark: Claude hooks and Hermes gateway/tool lifecycle.
    - Hooks: before tool call, after tool call, before memory write, after
      run complete, before scheduled delivery.
    - Acceptance: guardrails and observability can be added without
      editing the agent loop.
    - Status: first CLI/runtime/Cowork pass implemented. The shared
      Hermes lifecycle manifest maps `before_tool_call`, `after_tool_call`,
      `before_memory_write`, `after_run_complete`, and
      `before_scheduled_delivery` to Code Buddy user/tool hook events with
      configured-handler counts and core touchpoints. Cowork's hook bridge
      can now configure the three missing Hermes lifecycle events without a
      schema fork.

36. Add Cowork skill package manager.
    - Benchmark: Claude/Hermes visible skill ecosystems.
    - Acceptance: browse SKILL.md packages, inspect usage telemetry,
      enable/disable per profile and install only after review.
    - Status: CLI surface implemented (see item 26): `buddy skills
      list/usage/enable/disable`. Install-only-after-review already exists via
      the skill-candidate queue (item 14, `buddy tools skill-candidate`). Cowork
      now shows Learning Agent skill outcome telemetry and the shared SKILL
      candidate review queue from the Fleet Command Center. Full package
      manager depth and per-profile scoping remain future work.

37. Add trajectory export with privacy redaction.
    - Benchmark: Codex eval workflows and Hermes research trajectories.
    - Acceptance: export prompt, selected context, tool calls, results,
      artifacts and final answer with configurable redaction.
    - Status: first CLI/Cowork pass implemented through
      `buddy run trajectory-export <run-id> --json` and the Audit Log
      "Copy trajectory" action. Artifact content remains opt-in and capped;
      the default export is metadata plus redacted event/tool/final-answer
      evidence.

38. Add golden workflow evals.
    - Benchmark: Codex repeatable workflow use cases.
    - Workflows: lead discovery, code fix, doc workshop, Fleet review and
      scheduled run.
    - Acceptance: each workflow has fixtures, expected artifacts and
      pass/fail policy assertions.
    - Status: first CLI/contract pass implemented. `buddy run golden-evals
      --json` now exposes five repeatable fixtures with expected artifacts
      and policy assertions, and `buddy run golden-evals <fixture-id>
      <run-id> --json` evaluates a redacted trajectory export without
      replaying tools. The first behavioral tests cover public lead discovery
      passing with source evidence and failing when outreach tooling appears.
      Cowork's Audit Log now mirrors the same checks from an expanded run as
      a copy-only `golden_workflow_eval_report`, and can review golden/policy
      reports in a local read-only summary panel with pass/fail counts and
      no-replay guardrails without requiring clipboard JSON.
      Dedicated safety policies now live in `buddy run policy-evals`, keeping
      golden workflow fitness separate from cross-workflow guardrails.

## Suggested next implementation order

1. Finish dynamic schema patching for disabled tools/profile contracts.
2. Add mobile-safe remote supervision after the run contract is stable.
3. Add Browser Operator consent/action-log UX on top of the current
   browser proof primitives.
4. Add hook lifecycle before scheduled delivery and memory writeback.
5. Add index health/repair reporting for stale artifact FTS rows whose
   source run folders were pruned or moved.
   - Status: implemented. `RunStore.checkArtifactIndexHealth()` classifies
     every artifact index row against disk (`missing_run` when the whole run
     folder was pruned/moved, `missing_artifact` when only the file is gone),
     and `RunStore.repairArtifactIndex({ includeOrphans })` deletes stale rows
     (and optionally orphans) in one transaction, with the FTS mirror kept in
     sync by the existing AFTER DELETE trigger. Operator surface:
     `buddy run index-doctor [--repair] [--include-orphans] [--json]`.

## Non-goals

- Do not port Hermes Python code.
- Do not add a new memory SaaS before local SQLite/files are coherent.
- Do not send emails or contact leads from the agent automatically.
- Do not collect private personal data; public professional data must
  keep source URLs and purpose limitation.
- Do not hide generated scripts inside chat; scripts must be artifacts
  with inputs, outputs and assertions.
