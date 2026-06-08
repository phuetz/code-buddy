# Hermes Agent strategy note

Date: 2026-05-16

> **Strategy note** (long-lived). For the current, code-verified parity state and the list of open gaps, see the
> canonical [`hermes-openclaw-parity.md`](hermes-openclaw-parity.md).

Scope: Code Buddy weekend worktree. Hermes Agent was reviewed as a
strategic benchmark after the OpenClaw integration audit.

External reference snapshot:

- Repository: `https://github.com/NousResearch/hermes-agent`
- Public docs: `https://hermes-agent.nousresearch.com/docs/`
- Local review clone: `D:\CascadeProjects\_external\hermes-agent`
- Reviewed commit: `d725407`
- Latest public release seen during review: Hermes Agent v0.14.0
  (2026-05-16)
- Public docs refreshed on 2026-05-16 still emphasize the same signals:
  learning loop, persistent memory, skills, messaging gateway, scheduled
  automations, MCP, subagents and terminal backends.
- Public docs checked again on 2026-05-16 for this pass: the strongest
  transferable ideas remain closed-loop learning, FTS5 recall,
  portable skills, filtered toolsets, scheduled automations and
  programmatic tool calling through scripts/RPC.
- Public docs checked again on 2026-05-17 for this pass: the immediate
  Code Buddy translation is not another runtime, but a Hermes-style
  visible TODO/work-queue loop inside Cowork workflows.
- Competitor parity checked on 2026-05-18 against Hermes Agent,
  Claude Code, Codex Windows/CLI and Manus Browser Operator. The
  detailed audit lives in
  [`docs/cowork-competitor-audit.md`](cowork-competitor-audit.md). The
  practical conclusion is that Code Buddy needs one unified operator
  loop: visible runs, handoffs, artifacts, lessons, memory and next
  actions across CLI, Cowork and Fleet.
- Browser automation docs checked on 2026-05-17: Stagehand's useful
  transfer is the `observe` / `act` / `extract` posture on top of
  Playwright, not an immediate dependency swap. Mem0's useful transfer is
  the memory-provider boundary, not replacing Code Buddy's SQLite-first
  local memory.

Internet automation references:

- Stagehand landing/docs: `https://www.browserbase.com/stagehand/`,
  `https://docs.browserbase.com/welcome/quickstarts/stagehand`
- Mem0 OSS docs: `https://docs.mem0.ai/open-source/overview`,
  `https://docs.mem0.ai/open-source/node-quickstart`

## Hermes-inspired TODO for the next Code Buddy passes

These are the bounded items to implement without changing the stack:

For the broader architecture study and power-parity backlog, see
[`hermes-agent-power-todo.md`](archive/2026-q2-hermes-audits/hermes-agent-power-todo.md) (archived).
For the current parity state, see [`hermes-openclaw-parity.md`](hermes-openclaw-parity.md).

1. **Visible workflow TODOs in Cowork** — every long-running workshop
   should expose the next useful actions, not only a completed/pending
   progress rail. Status: implemented first for the Word-workshop panel.
2. **Outcome-to-memory loop** — Fleet and workshop outputs should become
   curated project memory only after an operator action or a strong
   confidence signal. Status: first Fleet outcome memory loop exists;
   Word-workshop now has an operator-triggered memory save action from
   the progress panel.
3. **Filtered tool posture** — keep the current dispatch profiles and
   evolve them toward real toolset constraints. Status: profile metadata
   crosses CLI, Cowork and peer RPC; Fleet now also exposes
   Hermes-style `fleet.hermes.<profile>` toolset descriptors derived
   from the existing Code Buddy policy resolver. Code Buddy also ships a
   built-in `hermes` custom-agent profile (`buddy --agent hermes`) plus
   `buddy hermes profile` / `buddy hermes doctor` diagnostics, and
   custom-agent `tools` / `disabledTools` now feed the runtime tool
   filter. Custom agents with `fleetDispatchProfile` now also compile the
   selected dispatch profile into an effective `ToolFilterConfig` against
   the real Code Buddy tool list, and `buddy hermes doctor <profile>
   --json` reports the requested profile's allowed/denied tool patterns.
   `buddy tools profile <profile>` is the first general inspector for the
   same effective tool posture: JSON/text output can show real built-in
   tools or a provided subset, with allow/deny filters and per-tool
   decisions before a run. Cowork now mirrors that posture in the Fleet
   Command Center through a compact Tool Profile strip that shows the
   active `fleet.hermes.<profile>` descriptor, allow/confirm/deny counts,
   the policy summary and per-tool preview decisions before dispatch.
   Direct runtime calls to `route_peer` and `peer_delegate` reject unknown
   explicit `dispatchProfile` values before peer discovery/delegation, so
   profile mistakes fail closed instead of silently becoming `balanced`.
   Safe/review custom-agent tests now also run those profile-derived filters
   through the same `filterTools()` path used by model-facing schemas, proving
   that mutation and execution tools are hidden before the LLM sees them.
   Peer-side `peer.dispatch` acceptance responses now immediately return the
   resolved profile, tool policy, tool decisions, Hermes toolset id and trace
   id, so asynchronous work can be logged with the same policy posture before
   a status poll completes.
   The shared `ToolHandler` now also enforces the active tool filter at
   execution time, including streaming `bash`, so hidden mutation/execution
   tools cannot run through a stale or malformed tool call after schema
   patching removed them. Those filter blocks now emit run telemetry as
   policy decisions plus failed tool results without emitting a `tool_call`,
   so policy evals can prove the tool did not actually execute while still
   preserving the blocked attempt for review exports. Cowork's Audit Log
   policy eval summary now carries and renders `toolFilterBlocks`, showing the
   count and blocked tool names directly beside the read-only/no-replay
   guardrails. Run recall packs now also include deduplicated active-filter
   policy blocks in the agent-ready prompt context, so Fleet handoffs preserve
   "requested but blocked" evidence without treating the hidden tool as used.
   The active custom-agent runtime now also carries Hermes'
   default Fleet dispatch profile into `route_peer` and `peer_delegate`,
   so delegated calls keep a concrete `fleet.hermes.<profile>` posture
   even when the model omits the optional argument. Peer chat and
   chat-session bridges now also merge dispatch policy hints into custom
   system prompts, so user-provided peer persona prompts no longer drop
   the selected Hermes toolset posture. The same dispatch-profile
   selection guide now feeds the Hermes prompt, Fleet tool schemas, CLI
   diagnostics and docs, reducing drift between what operators see and
   what the model is told to choose. `buddy hermes plan <profile>`
   now turns that profile into a short integration checklist covering
   profile inspection, doctor diagnostics, lessons vault export, and
   running `buddy --agent hermes`, with JSON output for UI consumers.
   The JSON plan includes schema version, generation time, compact
   summary, recommended next command, involved surface ids and checklist
   items so Cowork can render a handoff panel without parsing prose.
   Checklist items carry kind/risk metadata for read-only inspection,
   local artifact writes and interactive execution handoffs, plus
   expected artifact paths when a step writes files and acceptance
   criteria for UI checklist rendering. The
   same plan can render as Markdown for handoff notes and PR summaries,
   and `--plan-output` writes JSON/Markdown/text artifacts while
   creating parent folders. The plan now also declares `cli`, `cowork`
   and `shared-json` interaction surfaces, and Cowork's Fleet Command
   Center renders a compact Hermes plan strip that can seed the selected
   plan as a dispatch-ready Fleet goal. `buddy hermes hooks [--json]`
   now exposes the Hermes-style lifecycle contract for guardrails and
   observability, covering tool calls, memory writes, run completion and
   scheduled delivery without adding a second hook runtime.
   Deeper peer-side execution enforcement remains future work.
4. **Portable skills** — keep `SKILL.md` packages as the durable
   procedural-memory boundary. Status: telemetry exists; install/update
   ergonomics remain future work. The lessons store now also has a
   mini-Obsidian graph surface (`lessons_graph` / `buddy lessons graph`)
   that keeps Markdown as the canonical memory and derives nearby
   notions from wiki links, Markdown links, tags, related metadata,
   context labels and keywords. The same surface emits explicit JSON
   backlinks for tooling, Obsidian-friendly Markdown indexes, and
   Mermaid text for a future visual cockpit, can focus on one concept
   with `--concept <name>`, can disable fallback keyword concepts with
   `--no-keywords` for a cleaner explicit-link/tag graph, and
   `buddy lessons graph --graph-output <file>` can write those artifacts
   for UI consumption while inferring JSON/Markdown/Mermaid format from
   the output extension when no explicit format flag is provided.
   `buddy lessons graph --vault <dir>` writes a full Obsidian-style
   folder with `index.md`, `_concepts.md`, `_lessons.md`,
   `concepts/*.md`, `lessons/*.md`, `graph.json`, `graph.mmd` and
   `manifest.json`, including YAML frontmatter for page type, backlinks
   and concepts. The manifest also maps concept and lesson ids to their
   generated files so UI consumers can load the vault without directory
   scanning, while keeping `lessons.md` canonical. Cowork now has a
   read-only Lessons Vault strip in the Fleet Command Center that loads
   the same manifest/graph through IPC, shows counts and top concept
   pages, and can seed a review-profile Fleet goal for vault refresh
   without auto-writing lessons. Fleet outcome details now have a separate
   operator-triggered "Save as lesson" action that
   writes a procedural Markdown lesson with outcome, saga, AgentRun,
   Hermes, target-peer, proof and verification context, while keeping
   factual memory promotion as a separate action.
5. **Scheduled autonomous work** — keep scheduled dispatches visible in
   Cowork and Activity Feed. Status: first cockpit pass exists; delivery
   channels remain future work. Hermes-origin scheduled dispatches now
   keep a lightweight lineage (`hermesPlanId`, `hermesPlanProfile`,
   `hermesPlanSurface`) across Cowork schedule drafts, scheduled-work
   chips, Activity Feed chips, terminal Fleet outcomes, follow-up goals
   and saved Fleet outcome memories. The scheduled-work run-now action
   also names Fleet/Hermes lineage in its accessible label and keeps that
   lineage while the spinner is running, so icon-only controls remain
   inspectable without changing the compact layout. Recent outcome strip
   buttons now do the same for completed Hermes/Fleet runs, carrying the
   selected outcome, status, targets, delivery channel, memory count and
   web-proof burden in their accessible label/title. Detail-panel copy,
   reuse-as-goal and save-as-memory actions carry the same lineage. Reusing
   an outcome as a goal now passes through a small tested dispatch preset
   helper so only supported privacy/profile metadata can steer the next run.
   The first canonical `AgentRun` contract now exists and Cowork scheduled
   Fleet dispatch drafts embed it as `metadata.agentRun`, alongside flat
   `agentRunId` and `agentRunSchemaVersion` fields for future CLI/Cowork
   recall surfaces. Fleet outcome reuse also creates a draft `AgentRun`
   at click time; when that follow-up is scheduled, the scheduled draft
   inherits `parentRunId`, `outcomeId`, saga and Hermes plan lineage.
   That compact run lineage now continues through scheduled task Activity
   Feed entries, `dispatchFleetSaga`, Fleet saga metadata and terminal
   Fleet activity records, with Cowork chips for run, parent run and
   outcome ids. The dispatch composer also shows a follow-up AgentRun
   draft preview before immediate dispatch so an operator can inspect the
   inherited run, parent, outcome, Hermes, privacy, target, memory, proof
   and toolset context before launching work.
6. **Internet automation and self-tests** — use the current Playwright
   browser layer as the Stagehand-like boundary: observe a page before
   acting, extract structured evidence, assert the expected page state,
   then promote only proven facts to memory. Status: first CLI/browser
   actions `observe`, `extract` and `assert_text` exist without adding a
   new dependency. Generated public-data research scripts now also have a
   first typed artifact envelope (`ResearchScriptJobArtifact`) that records
   manifest/script/input/output/log paths, command, sandbox policy,
   allowed/ignored domains, assertions, cleanup expectations and an
   `AgentRun` script artifact pointer. Lead Scout enrichment plans embed
   this shape so the script can become an inspectable run artifact instead
   of only an inline chat payload. `materializeResearchScriptJobArtifact`
   can now create the reviewable artifact folder locally without executing
   the script: manifest, README, script, input, `not_run` output, empty
   logs and summary, with path-escape and overwrite guards. The paired
   `runMaterializedResearchScriptJob` runner executes only local
   materialized jobs for now, uses spawn without shell, captures stdout,
   stderr and summary artifacts, enforces timeout/executable checks, and
   refuses network-enabled policies unless the caller explicitly opts in.
   Repeatedly successful jobs can now produce a review-only SKILL.md
   candidate through `buildResearchScriptSkillCandidate`, keeping script
   patterns reusable without silently installing new capabilities.
   `materializeResearchScriptSkillCandidate` writes the candidate plus
   `candidate-review.json`, and `buddy tools skill-candidate
   list/inspect/install` lets an operator find, review and install it into the
   workspace skills directory only with explicit `--approved-by` approval.
   Cowork's Fleet `research` profile now surfaces the same review posture
   through the read-only `tools.skillCandidate.list` bridge and
   `SkillCandidateReviewQueueStrip`: eligible candidates, human-approval
   and no-auto-install chips, CLI review commands, and a goal handoff for
   inspecting the queue before any install.
   The main Lead Scout plan now also embeds a `LeadDiscoveryWorkflowTemplate`: public-only
   inputs, search ->
   site-discovery -> page-extraction -> contact-field extraction ->
   dedupe -> evidence -> export stages, review-only contact policy,
   expected artifacts and the linked research-script job artifact. Cowork
   now surfaces a compact public-data Lead Scout workflow preview under the
   Fleet `research` profile, with stage/artifact/review-only chips plus
   actions to seed the current Fleet goal or schedule the workflow with
   public-data metadata.

## Decision

Keep the Code Buddy stack.

Hermes is useful because it shows a mature shape for a long-running
personal agent, but Code Buddy should not become a Python port or a
Hermes fork. The intended stack remains:

- React / TypeScript for Cowork and the human cockpit.
- TypeScript / Node for the CLI, provider routing, tool execution,
  Fleet Gateway, skills and server APIs.
- Rust sidecars for system-level capabilities where native performance,
  desktop integration or audio/device work justify the boundary.
- SQLite as the durable local state layer, using the existing
  `better-sqlite3` foundation before adding any new storage dependency.

Hermes should replace OpenClaw as the primary architecture benchmark for
agent operating-system patterns. OpenClaw remains historical context and
a possible external-channel bridge, but Hermes is the stronger source of
ideas for memory, sessions, skills, profiles, cron and multi-agent work.

## Why Hermes matters

Hermes is built by Nous Research and is actively maintained. Its public
README presents it as a self-improving AI agent with a learning loop:
agent-curated memory, skill creation, skill improvement, session search,
user modeling, gateway channels and scheduled jobs.

The important signal for Code Buddy is not the language or exact code
shape. It is the product direction: Hermes treats an agent as a durable
personal operating system, not just a chat wrapper.

## Comparison matrix

| Area | Hermes signal | Code Buddy status | Code Buddy direction |
|---|---|---|---|
| Core stack | Python agent plus TypeScript web/TUI pieces | TypeScript CLI/server, React/Cowork, Rust sidecar | Keep Code Buddy stack; adapt patterns, not code. |
| Agent loop | Large mature agent loop with tool repair, iteration budgets, delegation and summaries | `CodeBuddyAgent`, facades and executor loop already form a native agent runtime | Audit Hermes loop ideas only where they improve reliability: tool-call repair, max-iteration summaries, delegation caps. |
| Session store | `hermes_state.py` uses SQLite with FTS5, WAL and `parent_session_id` chains | Code Buddy already has SQLite repositories and WAL, but session search/lineage are not first-class | Add FTS-backed session search and session lineage before inventing another memory layer. |
| Memory | Pluggable memory providers and user modeling | Code Buddy has memory repositories, ICM/hybrid memory work and local persistence | Add a provider boundary later: local SQLite first, optional Honcho/Mem0/Supermemory-style adapters second. |
| Skills | Large official/optional skill library, agentskills.io, curator patterns | Real `src/skills/hub.ts` exists; stale mock registry was retired in the OpenClaw audit | Make SKILL.md packages first-class, track usage, support optional installs and prune stale generated skills. |
| Gateway channels | Telegram, Discord, Slack, WhatsApp, Signal, email and more | Code Buddy Fleet Gateway is mainly AI-to-AI and Cowork-facing | Keep Fleet as the brain. Add external channels only through a narrow bridge when Cowork/Fleet is stable. |
| Cron | First-class scheduler with platform delivery | Code Buddy has long-running autonomy and operational docs, but scheduled work is not a main cockpit surface | Surface scheduled jobs in Cowork and connect them to Fleet/task state. |
| Kanban / task board | Durable SQLite-backed board for profiles and workers | Code Buddy has disk-backed Fleet sagas, Activity Feed and multi-agent coordination | Keep the existing saga store first; move to SQLite only if query/reporting needs exceed JSON files. |
| Profiles | Isolated `HERMES_HOME` profiles | Code Buddy has profiles/TOML and historical `GROK_HOME` naming | Introduce clear `CODEBUDDY_HOME` semantics while preserving compatibility aliases. |
| ACP / editors | ACP adapter for editor integration | Code Buddy has ACP protocol pieces and VS Code extension packages | Study ACP only after CLI, Cowork and Fleet flows are stable. |
| Windows | Native Windows is early beta; WSL2 is the strongest path | Code Buddy is already Windows-first in Patrice's workflow | Make Windows reliability a Code Buddy advantage. |

## Immediate roadmap

1. Keep the current React / TypeScript / Rust architecture. Status:
   documented and locked in this note.
2. Add a small session-search milestone. Status: first pass implemented
   in SQLite with FTS5-backed message search and CLI match snippets.
   Run/artifact recall also has a first CLI/store pass through
   `RunStore.searchRuns()` and `buddy run search`, covering run summaries,
   event payloads and capped text artifacts with ranked snippets. Artifacts are
   now also written to a durable local SQLite FTS5 index when saved, and
   `RunStore.searchRuns()` queries that index before falling back to file scans,
   so newly generated plans/scripts/summaries remain searchable across store
   restarts.
   `buddy run search --source` now filters by channel/tag/source aliases
   such as `cli`, `cowork`, `fleet`, `scheduled` and `mobile`, and
   `buddy run search --json` exposes the same ranked matches as stable
   JSON for future Cowork/Manus UI consumers, including `schemaVersion`,
   `generatedAt` and effective `filters` metadata. Cowork now mirrors that
   recall path in the Audit Log through a read-only `audit.searchRuns` bridge
   and a source-aware search field that renders matching summary/event/artifact
   snippets. The same source filter also applies to the normal Audit Log run
   list and CSV export. `buildRunRecallPack()` and
   `buddy run recall-pack <query> [--source ...] [--json]` now turn those ranked
   matches into a compact cited `promptContext` for follow-up agents, and Cowork
   can request the same bundle through the read-only `audit.buildRecallPack`
   IPC/preload bridge. The Audit Log also exposes a copy action that turns the
   current search into an agent-ready handoff prompt and passes the active
   workspace path for read-only lesson recall. `buddy run recall-pack` can
   include matching `lessons.md` entries with `--lessons --max-lessons <n>`,
   reusing the existing LessonsTracker rather than adding another memory store.
   The same recall pack now supports saved session snippets with
   `--sessions --max-sessions <n>`, and Cowork's copy action requests sessions
   by default so a handoff can carry recent conversation continuity alongside
   run/artifact/lesson evidence. Recall packs also support read-only persistent
   memory recall with `--memories --max-memories <n>`, scanning existing
   `CODEBUDDY_MEMORY.md`, project `MEMORY.md` and user memory files without
   creating new memory state. CLI users can use `--all-context` as a shortcut
   for lessons, memories and sessions together. Cowork's Audit Log can now
   send that same recall pack directly to Fleet as a `research` / `public`
   draft goal with outreach disabled by default; it is a handoff surface, not
   an automatic dispatch.
   - FTS5 virtual table for messages.
   - `buddy --search-sessions` command with parent lineage and snippet
     metadata.
   - `buddy run search <query> [--source cowork|fleet|scheduled|cli|mobile]`
     for recent run summaries, events and text artifacts.
  - `buddy run recall-pack <query> [--lessons] [--sessions] [--memories] [--all-context]` for an agent-ready cited context bundle.
  - `buddy run trajectory-export <run-id> [--json]` for a redacted,
    review-only trajectory envelope with prompt sources, selected context,
    tool calls/results, artifact metadata and final-answer evidence. Cowork's
    Audit Log mirrors it from an expanded run as a copy-only action.
  - `buddy run golden-evals [fixture-id] [run-id] [--json]` for the first
    repeatable workflow fixture manifest and trajectory-based pass/fail
    assertions. Cowork's Audit Log mirrors this from an expanded run as a
    copy-only `golden_workflow_eval_report` and can review it in-place through
    a local pass/fail summary panel without using the clipboard. The manifest
    now includes `recall-handoff`, which proves a recall-pack Fleet handoff
    keeps `Policy blocks:` / `active_tool_filter` evidence visible while
    staying outreach-free.
  - `buddy run policy-evals [policy-id] [run-id] [--json]` for behavior-level
    safety assertions: safe/review no-mutation and public-data source URL
    preservation. Cowork's Audit Log mirrors this from an expanded run as a
    copy-only `policy_eval_report`, sharing the same read-only summary panel.
  - `buddy run mobile-snapshot <query> [--source ...] [--json]` for a
     redacted, review-only supervision payload that can later back a phone
     UI without exposing execution controls.
   - `buddy run mobile-gateway-contract <query> [--json] [--no-snapshot]`
     for the future gateway route contract: local-first transport,
     short-lived auth, read/draft-only endpoints and deny-by-default blocked
     operations. Cowork's Audit Log mirrors this through a read-only bridge
     and "Copy mobile contract" action. This is a contract artifact, not a
     network listener.
   - `buddy run mobile-gateway-check <query> --action <action> --method
     GET|POST --path <path> [--local-operator]` for testing one future
     gateway request against the same contract before a listener exists.
     Draft-only actions stay blocked until the local-operator flag is present;
     execute/mutate/send actions stay denied.
   - `buddy run mobile-gateway-review-draft <query> --action <action>
     --method GET|POST --path <path>` for creating the local-only operator
     review envelope a phone/Cowork UI can later render before any approval
     endpoint mutates state. Cowork's Audit Log now mirrors this with a
     "Copy review draft" action for the current search, still clipboard-only
     and local-operator gated.
   - `buddy run mobile-gateway-listener-shell <query>` for rendering the
     disabled loopback listener shell that a future implementation can fill:
     planned route handlers, auth posture, acceptance checks and blocked
     operation stubs, with `serverStarted=false`. Cowork's Audit Log mirrors
     the same artifact as a copy-only action from the current search.
  - `buddy run mobile-pairing-state <query> [--device-label ...] [--ttl ...]`
    for generating preview-only pairing state from the disabled shell. It
    includes a local code, fingerprint, expiry and operator checklist, while
    keeping token issuance, persistence and listener acceptance disabled.
    Cowork's Audit Log exposes the same state as a copy-only action.
  - `buddy run mobile-pairing-acceptance-plan <query> [--device-label ...]
    [--operator-label ...]` for documenting the next mutation boundary before
    it exists: POST `/api/mobile/pairing/accept`, required evidence, disabled
    token/session mutations and safety flags all remain no-network and
    non-executable. Cowork's Audit Log mirrors the same envelope with a
    "Review acceptance" panel and copy-only "Copy acceptance plan" action
    for the current search.
  - `buddy run mobile-approval-queue <query>` for producing the local review
    queue that separates ready read-only routes, pending draft approvals and
    blocked operations. Cowork exposes the same queue as copy-only JSON and
     as a visible local review panel with ready/pending/blocked counts. Pending
     items can be copied as standalone local operator review drafts; no approval
     mutation endpoint is enabled yet.
   - tests for query sanitization and result ranking.
3. Add session lineage. Status: first pass implemented in SQLite with
   `parent_session_id`, plus clone/branch metadata persistence.
   - parent/child session relationship for compaction, branching and
     long autonomous runs.
   - Cowork display that shows where a resumed thread came from.
4. Consolidate skills:
    - keep `src/skills/hub.ts` as the only hub direction.
    - add SKILL.md package metadata and usage telemetry. Status:
      first local telemetry pass implemented in the hub lockfile with
      invocation/success/failure counts, duration averages and executor
      lifecycle events.
    - avoid any mock marketplace surface. Status: stale mock registry
      retired during the OpenClaw audit pass.
5. Make scheduled work visible:
   - scheduled task list in Cowork. Status: existing Settings schedule
     manager remains the authoring surface; Fleet Command Center now
     shows a compact scheduled-work strip with enabled count, next
     runs, schedule rule chips, last-run state, recent session id and
     last-error markers. Successful and failed scheduled runs now also
     write lightweight Activity Feed entries without persisting prompt
     content in the activity metadata. The Activity Feed has a Scheduled
     filter, and the Fleet Command Center can trigger an upcoming
     scheduled task immediately through the existing scheduler IPC or jump
     back to the Settings schedule authoring surface. The current Fleet
     dispatch goal/profile/privacy/memory context can now also be converted
     into a schedule draft. Fleet-created schedules persist lightweight JSON
     metadata (`source`, `dispatchProfile`, `privacyTag`, `parallelism`) so
     later cockpit views and Activity Feed entries can explain why a scheduled
     run exists without storing prompt content in activity metadata. Settings
     Schedule also renders the same Fleet metadata chips when administering
     scheduled tasks and when editing a Fleet-created draft before save. The
     Fleet Command Center prioritizes Fleet-origin scheduled tasks in its
     compact upcoming-work strip, shows a Fleet-origin scheduled count, keeps
     Fleet-origin scheduled events visible in both the Scheduled and Fleet
     Activity Feed filters, and refreshes Fleet activity immediately after a
     manual scheduled "Run now". Fleet-created schedules also carry only a
     memory-context flag and count, never memory contents, so the cockpit can
     explain why a run used context without leaking the actual learned text.
     Clicking a scheduled Activity Feed event now opens Settings -> Schedule
     even when the event originated from Fleet; pure Fleet events still open
     the Fleet Command Center. The classification, chip and navigation logic
     is covered by direct helper tests instead of source-string checks only.
     Fleet-created scheduled dispatches now also inherit the same internet
     proof-loop summary metadata as immediate dispatches, so Settings, the
     upcoming-work strip and scheduled Activity Feed events can show the
     expected web-proof burden before and after the run. Scheduled Activity
     Feed entries now also render the compact proof-loop step list, so an
     operator can see whether a scheduled web run planned search, fetch,
     browser extraction, assertion and persistence work without opening the
     saga detail. Fleet-created schedules also capture the number of routable
     peers available when the schedule was drafted, giving future runs a
     lightweight peer-availability breadcrumb without storing prompt content.
   - target peer/profile and delivery channel remain future work.
6. Make the Word-workshop flow preserve source analysis assets. Status:
   first roundtrip implemented for DOCX screenshots and final Word
   deliverables.
   - Cowork can attach source DOCX/PDF files to a React chat session and
     inject focused workshop guidance for question extraction, answer
     generation and deliverable synthesis.
   - `document read` now preserves DOCX paragraphs, tables and real
     embedded-image markers without mistaking hyperlink relationships for
     screenshots.
   - `document extract_images` extracts DOCX `word/media/*` screenshots
     into local files and returns `markdownRef` values so an agent can run
     OCR or visual analysis before answering, then reuse the same images in
     the generated deliverable.
   - `generate_document` can embed local bitmap image references back into
     the generated DOCX with aspect-ratio fitting and visible captions,
     which lets the final report include source screenshots alongside the
     generated technical answers.
   - Cowork artifact detection now surfaces both generated documents and
     extracted screenshot files, while ordinary document reads do not appear
     as generated artifacts.
   - Cowork now exposes the Word-workshop trigger from both the welcome
     composer and an active chat, with Electron smoke coverage for a selected
     DOCX attachment.
   - The workshop progress panel recognizes DOCX/PDF source reading,
     functional-analysis context capture, question extraction, screenshot
     extraction, OCR, generated deliverables and visible artifacts, including
     tolerant adapter aliases.
   - The generated workshop prompt now asks the agent to emit visible
     progress markers for context mapping, question inventory and OCR, and to
     maintain a compact question/context/screenshot-OCR/answer registry that
     can be reused in the final deliverable.
   - Generated DOCX text is sanitized for XML-invalid control characters
     before writing titles, headings, paragraphs, table cells and image
     captions. The DOCX validation path also fails explicitly if
     `word/document.xml` still contains an XML-invalid character, which guards
     against Word refusing a generated file.
   - Real smoke proof: `npm run smoke:docx` copied
     `gitnexus-rs-from-c/questions/Questions - Impacts.docx`, kept the source
     hash unchanged, read 33,082 characters, extracted 27 screenshots,
     generated a DOCX deliverable with 27 embedded images, and validated DOCX
     relationships/media.
   - Next polish: automate OCR-to-question binding and make
     answer-to-screenshot traceability visible in the workshop panel.
7. Keep Fleet sagas durable and visible. Status: existing disk-backed
   saga store confirmed; storage now follows `CODEBUDDY_HOME`; Cowork
   now groups sagas into a small status board for queued, running,
   completed and blocked work, with a selectable route/detail pane.
   - Activity Feed reads durable outcomes, not only live events.
     Status: terminal saga outcomes are already persisted in the
     Activity Feed and now surface back into the Fleet Command Center
     as recent selectable outcomes with final-result/error previews.
     Outcome details can be copied quickly for reuse in a follow-up run
     or an operator handoff, and can seed the next dispatch goal so an
     operator can continue from a completed/failed run without rewriting
     the context by hand.
      The same detail pane can now promote a Fleet outcome into project
      memory as a `pattern`, which is the first small Cowork-facing step
      toward the Hermes-style learning loop. Fleet Command Center now
      also reloads recent Fleet outcome memories and can include them in
      the next dispatch goal, closing the first outcome -> memory ->
      dispatch-context loop.
      Cowork dispatch now also exposes a small Hermes-inspired profile
      selector (`balanced`, `research`, `code`, `review`, `safe`) that
      injects tool/posture guidance into the saga goal and persists the
      selected profile into saga/activity metadata. This is the first
      filtered-toolset ergonomics step without replacing the existing
      router. The task router now also uses that profile as a soft model
      selection signal: `research` favors long-context models, while
      `code`, `review` and `safe` favor reasoning-capable models. The
      same profile now travels through `peer.dispatch` into the remote
      dispatch state, where it applies a small profile-specific system
      guidance block. This gives Fleet a concrete hook for future
      Hermes-style filtered toolsets while keeping the current peer RPC
      contract backward-compatible. A shared core descriptor now also
      maps each Fleet profile to the existing Code Buddy tool-policy
      vocabulary (`minimal`, `coding`, `messaging`, `full`) and exposes
      allow/confirm/deny group hints in dispatch status. The descriptor
      now produces real `PolicyConfig` rules for the existing policy
      resolver, and `buddy fleet policy` can preview per-tool decisions
      before execution. `route_peer` and `peer_delegate` also accept the
      same dispatch profile, so the LLM-facing multi-peer path can route
      and answer with the selected posture. The profile now crosses the
      `peer.chat` RPC boundary and comes back as `toolPolicy`,
      `toolDecisions` and a `toolset` descriptor, with a loopback smoke proving the metadata
      survives real WebSocket transport. Enforcement can now be added
      behind that descriptor instead of inventing a second permission
      model. The same profile metadata now applies to multi-turn
      `peer.chat-session.start` flows and appears in Cowork peer details
      as active chat-session posture/turn metadata, while preserving the
      privacy rule that prompt and answer content never ride on fleet
      monitoring events. `buddy fleet toolsets` now turns the same
      resolver-backed policy into a Hermes-style toolset manifest with
      allowed, confirmed and denied tool names for the inspected profile.
      This makes the filtered-toolset boundary concrete for operators
      and future Cowork UI work without vendoring Hermes or introducing
      a parallel permission model. The same descriptor now travels
      through the LLM-facing `route_peer` result and peer chat/session
      metadata so downstream callers can key on `fleet.hermes.<profile>`
      instead of reverse-engineering policy groups.
      Multi-turn peer chat sessions now keep that profile immutable after
      start: `continue` and `continue-stream` reject unknown, late-added or
      changed `dispatchProfile` values before any peer LLM call is made.
      Safe/review model-facing schema tests now cover the runtime filter path
      for custom agents, including removal of `create_file`, `bash` and
      `git_push`.
      Peer-side asynchronous `peer.dispatch` acceptance now preserves the RPC
      frame trace id when params omit one and echoes profile/toolset metadata
      immediately, making the runtime boundary visible at queue time. Cowork
      saga execution now persists that accepted tool policy/toolset snapshot
      before the first status poll and carries the toolset id into terminal
      Activity Feed metadata. The `ToolHandler` active-filter guard now blocks
      hidden tools before registry execution in both normal and streaming paths.
      activity metadata.
      Code Buddy now also has a built-in custom-agent profile named
      `hermes`: it loads without a user TOML file, uses the native
      Hermes Agent system prompt, and can be inspected with
      `buddy hermes profile` or `buddy hermes agent <profile>`.
   - The Fleet Command Center chrome now has `en`, `fr` and `zh`
     translation coverage with a regression guard.
   - Defer SQLite saga tables until query/reporting needs are real.
8. Make internet access automatable and testable. Status: first
   Stagehand-inspired browser primitive pass implemented without adding
   a dependency.
   - `browser` now accepts `observe` for an accessibility snapshot that
     includes actionable and contextual page elements.
   - `browser` now accepts `extract` for a compact page-state readout
     with URL, title, headings, actions, links and query-focused matches.
   - `browser` now accepts `assert_text` so autonomous internet flows can
     leave an explicit pass/fail proof instead of only a screenshot or
     prose summary.
   - `buildInternetProofPlan` now gives Cowork/Fleet a pure, reusable
     plan object for `web_search` -> `web_fetch` -> `browser.observe`
     -> `browser.extract` -> `browser.assert_text` -> curated memory,
     with no browser or network side effects in the planner itself.
   - Next polish: surface this plan as visible Cowork/Fleet Activity Feed
     steps when a web automation run starts.

## Later roadmap

- External channel bridge inspired by Hermes/OpenClaw, after Fleet is
  stable.
- Optional memory provider plugins for Honcho-like user modeling.
- Optional Mem0-style provider adapter after the SQLite memory boundary
  is stable and after there is a real migration/test need.
- ACP/editor adapter if it helps the consulting/demo story.
- Rust expansion only for clear native boundaries: sidecar services,
  desktop/device integration, local indexing, audio/STT or performance
  sensitive helpers.
- Continue the historical naming cleanup by preferring
  `CODEBUDDY_HOME` while keeping `GROK_HOME` as a compatibility alias.

## What not to do

- Do not rewrite Code Buddy in Python.
- Do not vendor Hermes.
- Do not add a second agent runtime beside `CodeBuddyAgent` unless it
  has a strict boundary and a migration plan.
- Do not rebuild every Hermes gateway channel before the Fleet/Cowork
  product loop is comfortable.
- Do not blur the product: Code Buddy is the CLI, Fleet brain and Cowork
  cockpit for multi-LLM coding work.

## Strategic conclusion

Hermes confirms that the right target is bigger than a coding CLI: the
target is a durable agent workbench. But Code Buddy's advantage is its
own stack and Patrice's workflow:

- Windows-first.
- Cowork-first.
- Multi-LLM and Fleet-first.
- Consulting/demo friendly.
- Deep integration with GitNexus-style technical documentation work.

Use Hermes as a mature research-backed compass. Keep Code Buddy's
implementation identity.
