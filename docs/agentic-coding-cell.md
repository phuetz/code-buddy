# Agentic Coding Cell

The Agentic Coding Cell is the smallest safe unit of autonomous software work
inside Code Buddy. Its job is to take one bounded coding task, understand the
workspace, make scoped edits, run verification, and return evidence.

This is the first practical layer of the long-term robot vision: before an
embodied system can safely act in the physical world, it must be able to act
reliably in its own software environment.

## Product Intent

Code Buddy already has the ingredients of an autonomous coding assistant:
tools, providers, sessions, memory, permissions, fleet, Cowork, and GitNexus
integration points. The Agentic Coding Cell turns those ingredients into one
clear execution contract.

It is not a new agent personality. It is a guarded run mode.

```text
User intent
  -> task contract
  -> workspace understanding
  -> plan
  -> approval state
  -> scoped edits
  -> verification
  -> evidence report
  -> memory / handoff
```

## Non-goals

- No automatic push.
- No automatic deploy.
- No destructive filesystem operation.
- No edits outside the allowed workspace scope.
- No hidden retries that change behavior without a trace.
- No physical-world action.
- No self-improvement loop without human review.

## Task Contract

The first version should accept a JSON task file rather than a free-form command
line prompt. This keeps the autonomy explicit and reviewable.

```json
{
  "repo": "<repo>",
  "task": "Fix the targeted behavior or add the bounded capability.",
  "allowedPaths": ["src/...", "tests/..."],
  "verification": ["npm run typecheck", "npm test -- tests/example.test.ts"],
  "riskLevel": "low",
  "edits": [
    {
      "type": "replace_text",
      "path": "docs/example.md",
      "find": "old text",
      "replace": "new text",
      "expectedOccurrences": 1
    }
  ],
  "output": "text"
}
```

Required fields:
- `repo`: absolute workspace path.
- `task`: one clear change request.
- `allowedPaths`: files or directory globs the cell may edit.
- `verification`: commands that prove completion.
- `riskLevel`: `low`, `medium`, or `high`.

Optional fields:
- `branchName`: suggested branch name.
- `maxFilesChanged`: default `10`.
- `maxToolRounds`: default inherited from the active autonomy profile.
- `memoryPolicy`: `none`, `handoff`, or `lessons`.
- `fleetPolicy`: `none`, `read-only-help`, or `delegated-slices`.
  `read-only-help` adds advisory `route_peer`/`peer_chain` access for
  research, review, and safety input. `delegated-slices` adds a data-only
  research -> code -> review -> safe peer chain; peers can suggest the
  controlled proposal, but preview, approval, apply, and verification remain
  runner-owned.
- `edits`: guarded declarative edit operations. V0 supports only exact
  `replace_text` operations with an expected occurrence count.

Edit operations may also come from a separate controlled proposal file:

```json
{
  "summary": "Replace the placeholder sentence in the docs.",
  "producer": "agent-name",
  "risks": ["Documentation-only change."],
  "verificationNotes": ["Run git diff --check."],
  "edits": [
    {
      "type": "replace_text",
      "path": "docs/example.md",
      "find": "old text",
      "replace": "new text",
      "expectedOccurrences": 1
    }
  ]
}
```

This gives future agent loops a narrow output shape: propose edits in JSON, then
let the runner validate scope and occurrence counts before file writes.

The runner can also create a constrained prompt for a future agent:

```bash
buddy autonomous-code --task-file task.json --proposal-prompt-file proposal-prompt.md
```

That prompt includes the task, allowed paths, verification commands, preflight
status, and the exact JSON shape expected for a controlled edit proposal. It is
non-writing: the agent still has to return a proposal file, and the runner still
validates, previews, and applies it separately.

Cowork can wrap that prompt in a data-only producer dispatch:

```bash
buddy autonomous-code --task-file task.json --edit-proposal-producer-dispatch-file edit-proposal-producer-dispatch.json
```

That artifact has `kind: "agentic-coding-edit-proposal-producer-dispatch"`.
Inspired by PostCommander's workflow builder contract, it carries system/user
messages, the current workflow state, read-only tool hints, forbidden actions,
the target `edit-proposal.json`, and the review command that must run after a
producer writes JSON. It is an invocation boundary only: it does not run an
agent and does not grant permission for direct file edits.

For autonomous producer execution, the runner can invoke that same data-only
boundary and persist the controlled JSON proposal:

```bash
buddy autonomous-code --task-file task.json --generate-edit-proposal-file edit-proposal.json
```

When this is combined with `--edit-proposal-producer-dispatch-file`, the saved
dispatch and generated proposal share the same Fleet policy and artifact
directory. The generated proposal is still inert until a later run validates,
previews, approves, applies, and verifies it.
The same run also writes `edit-proposal-producer-trace.json` next to the
generated proposal. That trace is machine-readable evidence of the data-only
tools the producer actually called, including whether `route_peer` or
`peer_chain` was attempted and whether any Fleet call completed. It records
bounded metadata such as chain roles and prompt length, not full prompts or
tool output.
Add `--require-fleet-collaboration` when a Fleet-backed task must not proceed
unless the producer trace shows at least one completed `route_peer` or
`peer_chain` call. This turns missing peers or ignored Fleet guidance into a
failed run while preserving the trace file for audit. Overnight manifests
preserve this requirement in the execution profile; resume and supervise
commands replay it by reading the manifest-linked trace or the default trace
next to the generated proposal.
If `--preview-edits`, `--apply-edits`, or `--run-verification` is supplied in
the same invocation, the CLI feeds the generated proposal back into the runner
immediately, so unattended runs can generate, preview, apply, and verify through
one guarded command:

```bash
buddy autonomous-code --task-file task.json --generate-edit-proposal-file edit-proposal.json --apply-edits --require-preview --run-verification
```

For unattended long runs, use the explicit overnight preset:

```bash
buddy autonomous-code --task-file task.json --autonomy-preset overnight --generate-edit-proposal-file edit-proposal.json --apply-edits --require-preview --run-verification
```

`--autonomy-preset overnight` raises the default self-correction budget to 16
iterations, the estimated LLM spend guard to $10, and the per-command
verification timeout to 300000 ms. Explicit `--max-iterations`,
`--max-cost-usd`, or `--verification-timeout-ms` flags still win, so operators
can tighten or widen any guardrail per run.
If no `--run-id` is supplied, the CLI creates an `overnight-*` run id, writes an
initial checkpoint under `CODEBUDDY_HOME/runs/<runId>/state.json`, and includes
`runId` plus `checkpointPath` in JSON output so the run can be resumed with
`--resume <runId>`.
The overnight preset also writes an `overnight-manifest.json` next to the
checkpoint by default. That manifest records the run id, checkpoint path,
budget guards, Fleet collaboration posture, artifact paths, the execution
profile needed to continue the same apply/preview/verification flow, and a
copyable `--resume-from-manifest` command plus a copyable
`--supervise-from-manifest` watchdog command, and an `auditCommand` that can
verify the persisted evidence later without starting another cycle. If the run
generated a controlled proposal, the manifest stores that generated proposal as the resumable
`editProposalFile` and links the producer trace as an audit artifact, so resume
and supervision commands do not silently drop the edit/apply/verify intent and
operators can prove whether Fleet collaboration was actually attempted. Use
`--overnight-manifest-file <path>` to put it
in an operations directory instead. A later process can resume from that file
with `--resume-from-manifest <path>`; the CLI reuses the manifest run id,
budgets, execution profile, and diagnostic artifact paths unless explicit flags
override them.
For unattended watchdog-style runs, use `--supervise-from-manifest <path>` with
`--supervise-cycles <count>` and `--supervise-sleep-ms <ms>` to run repeated,
bounded resume cycles from the same manifest. Without explicit overrides, the
watchdog is sized for an eight-hour observed interval: 961 cycles at 30000 ms between
cycles. It stops as `stalled` when the same progress signature repeats for
3 cycles, and stops after 3 consecutive cycle errors without losing the JSONL
audit trail; use `--supervise-max-stalled-cycles <count>` and
`--supervise-max-error-cycles <count>` to tune those guards. Add
`--supervision-events-file <path>` to choose the per-cycle JSONL audit log path;
otherwise the CLI appends `supervision-events.jsonl` next to the manifest. The
supervised run preserves the manifest run id and writes the final report,
workflow diagnostics, manifest supervision summary, and per-cycle events. If
every cycle errors before a report is produced, the manifest still records the
error-only supervision summary, the JSONL event path, the recovery handoff path,
and a copyable supervise command pinned to those audit artifacts. Each
supervision event includes a compact Fleet snapshot (`policy`, `mode`,
`chainRoles`, expected collaboration state, and the peer-chain invocation
metadata without the full prompt). When `--require-fleet-collaboration` is
replayed from the manifest, supervision summaries and JSONL events also include
`fleetCollaborationProof` with the trace path, completed peer-call counts, and
whether the proof was satisfied. Overnight manifests and JSON output include
`overnightReadiness`, a compact verdict that combines the configured eight-hour
watchdog window with the required Fleet proof, and separately marks whether an
overnight window has actually completed. `completionProven` is only true after
the supervised run reaches the cycle limit and the observed first-to-final
cycle timestamps cover the minimum window; configured cycle count alone does
not prove completion. Early terminal statuses do not count as an overnight
completion. Add `--require-overnight-readiness`
to a supervised manifest run to fail before the first cycle when the watchdog
window is too short or required Fleet proof is missing. Generated manifests add
that flag to the copyable supervise command only when the readiness verdict is
already satisfied. Add `--require-overnight-completion` when the supervising
process must fail unless the run actually observes the minimum overnight window
and required Fleet proof; ready-but-early terminal statuses still fail this
completion gate. Generated manifests add that completion gate to ready copyable
supervise commands, so the command can serve as proof rather than only a launch
recipe. After the process exits, use
`--audit-overnight-manifest <path>` to recalculate readiness and completion
from the persisted manifest without running another supervision cycle; combine
it with `--require-overnight-completion` when the audit itself must fail unless
the stored evidence proves the full overnight window and Fleet proof. The audit
also reads the persisted supervision JSONL path from the manifest and requires
the event count, cycle details, source manifest path, and final `stoppedReason`
to match before it reports `completion_proven`. Non-final events include
`nextCycleAt` so an external monitor can detect a missing follow-up cycle; the
final event includes `stoppedReason` so an unattended run can be audited for
multi-agent posture even when the terminal is gone. When
supervision stops before a terminal status
(`stalled`, `cycle_error_limit`, or non-terminal `cycle_limit`), the CLI also
writes `supervision-recovery.json` next to the manifest unless
`--supervision-recovery-file <path>` overrides it. That recovery handoff records
the last cycle, relevant artifacts, an audit action, resume/supervise commands,
readiness verdict, and the Fleet peer-chain invocation when available, so
another agent can resume triage without terminal scrollback. The audit action
recalculates the persisted readiness/completion verdict before any resume or
restart. Restarts that reuse the same supervision JSONL path keep the manifest
supervision summary cumulative, so the audit can compare the whole appended
event trail rather than only the last watchdog segment. When Fleet is enabled
and the stop is recoverable, the CLI also writes
`supervision-fleet-triage.json`
unless `--supervision-fleet-triage-file <path>` overrides it. That file contains
the bounded `peer_chain` call, last-cycle summary, readiness blockers, and
artifact paths needed for peers to diagnose the stop without editing the
repository. The CLI also attempts that bounded peer-chain triage immediately and
writes `supervision-fleet-triage-result.json` unless
`--supervision-fleet-triage-result-file <path>` overrides it; unavailable peers
are recorded as a failed triage result, not as a failed supervision run. The
recovery handoff includes an `inspect_fleet_triage_result` action when that
automatic attempt exists, so the next agent reads existing evidence before
asking Fleet peers again. Its copyable `restart_supervision` command also pins
the JSONL event, recovery, Fleet triage, and Fleet triage result paths when
those artifacts exist, so restarting from the handoff keeps one continuous audit
surface. Use `--recover-from-supervision <path>` to restart the watchdog
directly from the recovery handoff; the CLI reuses the handoff's source
manifest, supervision thresholds, JSONL event path, Fleet triage paths, and
recovery path unless explicit flags override them.
For the same preset, the CLI also writes `report.json`,
`workflow-progress.json`, and `workflow-events.json` next to the checkpoint
unless explicit `--report-file`, `--workflow-progress-file`, or
`--workflow-events-file` paths are supplied. This keeps a post-run diagnostic
surface available even if the terminal scrollback is gone.

After a future agent writes `edit-proposal.json`, Cowork can ask the runner for
a compact review before previewing:

```bash
buddy autonomous-code --task-file task.json --edit-proposal-file edit-proposal.json --edit-proposal-review-file edit-proposal-review.json
```

That artifact has `kind: "agentic-coding-edit-proposal-review"` and reports
whether the proposal is `accepted`, `rejected`, or `missing`. An accepted review
points the next action to preview. A rejected review carries validation errors
and points back to the producer step. It does not preview edits and does not
write repository files.

For Cowork orchestration, the CLI can bundle the full safe loop into one packet:

```bash
buddy autonomous-code --task-file task.json --proposal-loop-file proposal-loop.json
```

That artifact has `kind: "agentic-coding-proposal-loop"` and includes the edit
proposal prompt, approval decision prompt, expected artifact paths, and
copyable `buddy autonomous-code` command args for: prompt generation, proposal
review, preview, approval decision, approved apply, verification, and handoff.
It also projects the loop as `nodes` and `edges`, then adds `activeStepId`,
`completedStepIds`, `blockedStepIds`, and status `counts` so Cowork can render
it as a graph or stepper without recomputing loop state. Its `events` array adds
one ordered activity item per loop step, with severity and active flags for
feed-style UI. The producer-output review is an explicit
`review-edit-proposal` step between `produce-edit-proposal` and
`preview-scoped-edits`, so malformed agent JSON is stopped before any preview
or write path. It does not execute the loop; it gives Cowork or an agent a
bounded route through it.

The same safe loop can be exported directly as a Cowork canvas:

```bash
buddy autonomous-code --task-file task.json --proposal-loop-canvas-file proposal-loop-canvas.json
```

That artifact has `kind: "agentic-coding-proposal-loop-canvas"` and turns the
proposal loop into ReactFlow-style `customNode` nodes with positions,
`data.agenticType`, `data.iconName`, `data.status`, and `data.type`, plus teal
edges. It keeps the approval gate visible as a logic node and points Cowork at
the active review step without requiring the UI to re-shape the loop packet.

Cowork can also ask for a compact consumer hint for just the current loop
action:

```bash
buddy autonomous-code --task-file task.json --proposal-loop-next-action-file proposal-loop-next-action.json
```

That artifact has `kind: "agentic-coding-proposal-loop-next-action"`. It
includes the loop `nextAction`, the active step, the safe command when one is
available, `canRunCommand`, and a `runState` such as `ready_command` or
`human_input_required`. It also includes a small `ui` object for Cowork:
`primaryAction.enabled`, `primaryAction.type`, `primaryAction.label`,
`primaryAction.commandText` when the command is runnable, `disabledReason` when
human review or a blocker is required, and input/output artifact hints for the
active step. This gives Cowork a queue/sidebar payload without having to parse
the full loop packet or execute anything implicitly.

Cowork or a future agent can also ask the CLI to materialize the safe loop
workspace in one non-writing bundle:

```bash
buddy autonomous-code --task-file task.json --proposal-loop-artifacts-dir .agentic-loop
```

That writes `artifact-bundle.json` plus `proposal-loop.json`,
`proposal-loop-canvas.json`, `edit-proposal-prompt.md`,
`edit-proposal-request.json`, `edit-proposal-producer-dispatch.json`,
`edit-proposal-review.json`,
`proposal-loop-next-action.json`,
`approval-decision-prompt.md`, `approval-state.json`, `workflow-progress.json`,
`workflow-events.json`, and `seed-report.json`. The bundle never applies edits
or executes the loop. It only prepares the reviewable artifacts Cowork needs to
display the graph, hand a prompt to an agent, and keep the first approval gate
visible.

The bundle manifest also contains `coworkImport`: a small import surface with a
default panel, suggested focus panel, primary loop artifact, queue artifact,
required artifact paths, and UI panels for canvas, next action, approval,
producer request, producer dispatch, producer review, event timeline, seed
report, and manifest. This lets Cowork import a proposal-loop workspace without
guessing which JSON file should drive each panel.

Cowork can also request only that import map:

```bash
buddy autonomous-code --task-file task.json --proposal-loop-cowork-import-file cowork-import.json
```

The resulting JSON has the same `coworkImport` shape as the bundle manifest.
It is useful when a consumer wants to discover panels and expected artifact
paths before materializing or opening the full loop workspace.

Once a manifest exists, Cowork can ask for a passive availability check:

```bash
buddy autonomous-code --task-file task.json \
  --proposal-loop-cowork-import-file cowork-import.json \
  --proposal-loop-cowork-import-check-file cowork-import-check.json
```

The check reads the import map, resolves artifact paths from the manifest
location, and reports `ready`, `missing_required`, or `invalid`. It only checks
file presence for required artifacts and panels; it never opens the artifacts as
commands and never grants edit authority.

For an even more direct UI handoff, Cowork can request a workspace summary:

```bash
buddy autonomous-code --task-file task.json \
  --proposal-loop-cowork-import-file cowork-import.json \
  --proposal-loop-cowork-workspace-file cowork-workspace.json
```

The workspace summary wraps the import check into an opening state: available
panel ids, unavailable panel ids, the suggested `openPanelId`, and a
`ui.primaryAction` such as `open_panel`, `resolve_missing`, or `fix_import`.
It remains display-only and does not execute or approve anything.

When the queue artifact exists, the workspace also includes a passive `queue`
object copied from `proposal-loop-next-action.json`: `runState`,
`activeStepId`, `nextActionType`, `canRunCommand`, validation errors, and the
nested `uiPrimaryAction`. Any command remains plain text for display/copy; it
is never executed by the workspace export.

When the primary loop artifact exists, the workspace also includes a passive
`stepper` object copied from `proposal-loop.json`: `activeStepId`,
`completedStepIds`, `blockedStepIds`, status `counts`, and compact step rows.
This lets Cowork render a sidebar or progress strip without parsing the full
loop packet as execution authority.

The workspace also includes a passive `graph` object copied from
`proposal-loop.json`: active node id, node and edge counts, approval node ids,
blocked node ids, compact nodes, compact edges, status counts, deterministic
node positions, icon names, and canvas node types. This lets Cowork render a
graph mini-map without opening the full canvas as an execution surface.

The workspace also includes a passive `graphLegend`: status rows, node-type
rows, icon names, canvas types, node count, edge count, and active node id.
This lets Cowork render a stable legend for the graph mini-map without
reinterpreting graph data as execution authority.

The workspace also includes a passive `graphViewport`: graph bounds, center,
padding, active node position, active index, focus node order, node count, and
edge count. It also carries active trail node ids, edge ids, drawable segments,
active trail bounds, active trail progress counts, and upcoming trail metadata
(`upcomingTrailNodeIds`, `upcomingTrailEdgeIds`, `upcomingTrailSegments`,
`upcomingTrailBounds`, `upcomingTrailProgress`) plus `trailProgressSummary`,
`statusBounds`, `statusTransitions`, `statusTransitionBridges`,
`statusTransitionBridgeSummary`, `statusTransitionBridgeViewport`,
`statusTransitionSummary`, `renderLayers`, `renderLayerSummary`,
`renderLayerSafety`, `renderLayerGroups`, `renderLayerGroupSummary`,
`renderLayerGroupSafety`, `renderLayerGroupBadges`,
`renderLayerGroupBadgeSummary`, `renderLayerGroupBadgeAccessibilitySummary`,
`renderLayerGroupBadgeAccessibilityAudit`,
`renderLayerGroupBadgeAccessibilityHealth`,
`renderLayerGroupBadgeAccessibilityChecklist`,
`renderLayerGroupBadgeAccessibilityChecklistSummary`,
`renderLayerGroupBadgeSafety`,
`renderLayerGroupBadgeToneSummary`, `renderLayerGroupBadgeToneLegend`,
`renderLayerGroupBadgeToneLegendSummary`, `focusWindow`, `focusWindowBounds`,
`focusWindowRange`, and
`focusWindowSegments`, `focusWindowStatuses`, `focusWindowSummary`, and
`focusWindowControls` plus `focusWindowControlSummary` and
`focusWindowControlSafety` so Cowork can highlight, frame, navigate, summarize,
color passive section badges, expose, audit, summarize, and checklist ready accessibility labels, and render local controls around the current node. Those controls carry
passive `actionType` and `keyHint` values for UI display, plus
`canExecute: false`, `executionMode: display_only`, and a safety note. This lets
Cowork frame the graph mini-map consistently and support future keyboard focus
without recalculating layout or treating the viewport as execution state.

The workspace also includes a passive `commands` object copied from the same
loop packet. It lists each step that has a `buddy` command, its status, safety
notes, input/output artifacts, and a display-only `commandText`. This gives
Cowork a command palette without making the workspace export a command runner.

The workspace also includes passive `navigation` data: active panel,
recommended panel, tab rows, panel availability counts, required counts, and
logical groups (`workflow`, `review`, `producer`, `evidence`). This lets Cowork
open the right cockpit view and render tabs without reinterpreting the import
manifest as an execution plan.

The workspace also includes passive `guardrails` data: approval state, whether
a command can run, command counts, missing required artifacts, read-only tools,
disallowed actions, safety notes, and whether human review or an approval
decision is still needed. This gives Cowork a safety banner without turning
guardrail text into permission to run anything.

The workspace also includes a passive `harness` contract inspired by the
native Hermes Agent profile. It names the authority boundaries for run,
evidence, sensitive action, workflow, human approval, memory/lessons, and
agent-producer handoff; exposes the active workspace state; and lists the
Hermes native surfaces plus lifecycle stages that may observe or block work in
the wider system. This gives Cowork the missing "harnais" vocabulary without
making the workspace export execute, approve, write memory, push, or deploy.
Cowork renders this contract through the `AgenticHarnessStrip` when a JSON
artifact is opened from an assistant message or from the file preview pane.
The JSON artifact detector also labels workspace exports that contain this
contract as an Agentic Cowork workspace harness, so the operator sees the
authority boundary before inspecting the raw source.

The workspace also includes passive `supervision` data: whether a human review
is required, the current supervision state, the panel to open, the next action
type, and the approval or producer review state that explains the request. This
lets Cowork route Patrice to the right review surface without approving,
running, or applying anything.

The workspace also includes a passive `reviewChecklist`: affected files, a
next checklist item, and review steps such as opening the review panel,
inspecting the preview, confirming guardrails, and writing an approval decision.
This gives Cowork a human-review checklist without making checklist completion
an approval or execution signal.

The workspace also includes a passive `reviewRoute`: ordered review steps with
the target panel, target region, target artifact path, suggested UI action,
status, and safety note for each step. This lets Cowork render a guided review
wizard without treating route progress as approval or execution authority.

The workspace also includes passive `badges`: compact status rows for
workspace readiness, approval state, supervision, artifact availability,
command readiness, and the review checklist. This lets Cowork render a
first-glance cockpit strip without recomputing state or treating badges as
actions.

The workspace also includes passive `layout` data: a compact top badge strip
and stable cockpit regions for workflow map, operator review, producer handoff,
and evidence. This lets Cowork arrange panels predictably without deriving a
new execution plan from panel order.

The workspace also includes a passive `artifactShelf`: artifact totals and
per-region artifact groups with available, required, unavailable, primary panel,
and primary artifact path metadata. This lets Cowork render an artifact tray
without opening files as commands or treating artifact presence as approval.

The workspace also includes passive `focus` data: active panel, active region,
recommended panel, attention badge ids, and the supervision reason. This lets
Cowork highlight the current review surface without treating focus as an
approval, command, or priority signal.

The workspace also includes passive `panelStates`: one row per import panel
with availability, active/recommended flags, region id, attention badge ids,
and attention tone. This lets Cowork render panel chrome without joining the
manifest, navigation, layout, and focus objects itself.

The workspace also includes a passive `decisionForm` descriptor for the
approval panel. It lists the `agentic-coding-approval-decision` artifact kind,
allowed decisions, required fields, affected files, and conservative safety
notes, but it never creates or validates the decision artifact on its own.

The workspace also includes a passive `actionRail`: suggested UI controls for
opening the active panel, filling the approval decision, inspecting guardrails,
or copying the next command when it is safe. These entries are button metadata
only; the workspace export still does not execute, approve, or apply anything.

The workspace also includes a passive `operatorBrief`: a one-line headline,
body, severity, recommended panel/action, and compact evidence strings for the
current operator state. This lets Cowork show a stable cockpit summary without
reconstructing status from the lower-level objects.

The workspace also includes a passive `operatorHandoff`: title, summary,
target panel, target region, target artifact path, suggested action, evidence,
and safety notes. This gives Cowork one compact handoff card without granting
permission to execute, approve, or apply anything.

When the events artifact exists, the workspace includes a passive `activity`
object copied from `workflow-events.json`: `activeEventId`, `activeNodeId`,
severity counts, validation errors, and compact event rows. This gives Cowork an
activity-feed opening state without granting permission to run, approve, or
apply anything.

When the approval artifact exists, the workspace includes a passive `approval`
object copied from `approval-state.json`: `state`, `reason`,
`requiredBeforeApply`, `affectedFiles`, `gateNodeIds`, edit summary counts,
`nextAction`, and validation errors. This lets Cowork render the review gate
without producing an approval decision or applying edits.

When the producer artifacts exist, the workspace includes a passive `producer`
object copied from `edit-proposal-request.json`,
`edit-proposal-producer-dispatch.json`, and `edit-proposal-review.json`:
request instructions, safety rules, target edit-proposal path, schema keys,
allowed read-only tools, disallowed actions, review command, review state,
affected files, producer summary, `nextAction`, and validation errors. This
lets Cowork render the producer boundary and review result without launching an
agent, previewing, approving, or applying edits.

When the seed report exists, the workspace includes a passive `evidence` object
copied from `seed-report.json`: run status, approval state, blocked reasons,
validation errors, edit counts, verification counts, and workflow counts. This
lets Cowork render a compact evidence strip without treating the full report as
permission to run, approve, or apply anything.

When the artifact bundle manifest exists, the workspace includes a passive
`manifest` object copied from `artifact-bundle.json`: materialized artifact
count, roles, safety notes, Cowork import panel count, required artifact count,
and source state. This lets Cowork render bundle completeness without treating
the manifest as permission to launch agents or execute commands.

`edit-proposal-request.json` is the first producer boundary for a future
coding agent. It says which prompt to read, where to write `edit-proposal.json`,
the exact JSON schema expected, and the non-negotiable safety rules: data-only
output, no direct file edits, and preview plus approval still required before
apply.

`edit-proposal-producer-dispatch.json` is the first producer invocation
boundary. It packages the request as messages plus tool policy for a future
agent runner, while still keeping all validation, preview, approval, and apply
authority inside `buddy autonomous-code`.
When `fleetPolicy` is not `none`, the dispatch also carries a `fleet` block
with the recommended `peer_chain` invocation and the only Fleet tools the
producer may call. Those tools are advisory: a peer can return research,
implementation notes, review, or safety feedback, but it cannot write the
repository or bypass the controlled edit-proposal schema.
The main run report and workflow progress snapshots also expose `fleet.policy`,
`fleet.mode`, and `fleet.chainRoles`, so long-running autonomous sessions can
show their collaboration posture without opening the producer dispatch.

When an autonomous loop is allowed to write, use `--require-preview` with
`--apply-edits` so the runner must produce a successful preview in the same run
before any file is modified:

```bash
buddy autonomous-code --task-file task.json --edit-proposal-file proposal.json --require-preview --apply-edits
```

Inspired by PostCommander's content approval workflow, every report also carries
an `approval` state:

- `draft`: scoped edits exist but have not been previewed or applied.
- `needs_approval`: a successful preview exists and is ready for human or
  Cowork approval.
- `approved`: scoped edits were applied after validation and preflight.
- `rejected`: validation, preflight, preview, or application blocked the edit.
- `not_required`: no scoped edits were declared.

The same PostCommander workflow-builder idea also applies to the report shape:
the execution plan is projected as a `workflow` graph with `nodes`, `edges`,
`activeNodeId`, `completedNodeIds`, `blockedNodeIds`, and per-node
`nodeErrors`. Cowork can render that directly as a workflow canvas later, while
the CLI stays dependency-free.

Cowork can also consume the approval state as a small queue item:

```bash
buddy autonomous-code --task-file task.json --preview-edits --approval-file approval.json
```

That artifact has `kind: "agentic-coding-approval-state"` and includes the
approval `state`, `reason`, `requiredBeforeApply`, a deterministic
`nextAction`, affected files, preview/apply counts, and the approval gate node
ids. It lets a future Cowork panel show "review preview", "inspect rejection",
or "nothing required" without parsing the full run report.

For the human-or-Cowork review step, the CLI can write a constrained prompt
that turns the preview into a validated approval-decision JSON artifact:

```bash
buddy autonomous-code --task-file task.json --preview-edits --approval-decision-prompt-file decision-prompt.md
```

The prompt includes the task contract, current approval state, previewed
before/after text, and a strict `agentic-coding-approval-decision` schema.

The reverse path is also structured. After reviewing a preview, Cowork can write
an approval decision:

```json
{
  "kind": "agentic-coding-approval-decision",
  "schemaVersion": 1,
  "decision": "approved",
  "reviewer": "human-reviewer",
  "reason": "Preview reviewed in Cowork."
}
```

Then the runner can require that decision before writing:

```bash
buddy autonomous-code --task-file task.json --approval-decision-file decision.json --require-approval --apply-edits
```

When `--require-approval` is used, the runner previews first, validates the
decision file, and only applies edits if the decision is `approved`. A
`rejected` decision blocks the write and becomes an explicit workflow node
error.

The CLI can also write a PostCommander-style workflow canvas artifact:

```bash
buddy autonomous-code --task-file task.json --workflow-file agentic-workflow.json
```

That JSON keeps the same run graph but shapes each node for a future ReactFlow
surface: `type: "customNode"`, `position`, `data.label`, `data.iconName`,
`data.status`, `data.agenticType`, and `data.errorMessages`. This is the first
bridge from PostCommander's workflow creator into Code Buddy without adding
frontend dependencies to the CLI.

For the builder side of that bridge, the CLI can also write a constrained
workflow-builder prompt:

```bash
buddy autonomous-code --task-file task.json --workflow-builder-prompt-file workflow-builder.md
```

That prompt asks a future agent to return only a workflow proposal JSON:
`kind: "agentic-coding-workflow-builder-proposal"`, `nodes`, `edges`,
`approvalGates`, `coworkVisualizationNotes`, and `risks`. It explicitly forbids
direct file edits and keeps all writes behind preview and approval nodes.

The runner can then validate that builder output without executing it:

```bash
buddy autonomous-code --task-file task.json --workflow-builder-proposal-file workflow-proposal.json
```

This is the same trust boundary as edit proposals: an agent may propose a
workflow graph, but Code Buddy validates the schema, node ids, and edge
references before the graph enters the run report. A proposal must declare
exactly one trigger node, and every node must be reachable from that trigger.

After validation, the proposed graph can be exported as its own Cowork-ready
canvas:

```bash
buddy autonomous-code --task-file task.json --workflow-builder-proposal-file workflow-proposal.json --workflow-builder-proposal-canvas-file workflow-proposal-canvas.json
```

This keeps the builder output separate from the runner's actual execution graph,
so Cowork can show "proposed workflow" and "current run workflow" side by side.

Cowork can also consume a compact progress snapshot without parsing the full
canvas:

```bash
buddy autonomous-code --task-file task.json --workflow-progress-file workflow-progress.json
```

That artifact contains `kind: "agentic-coding-workflow-progress"`,
`activeNodeId`, `completedNodeIds`, `blockedNodeIds`, `nodeErrors`, status
counts, per-node error messages, and a deterministic `nextAction` for the UI.
It mirrors the lightweight progress shape used by PostCommander's runner.

For activity feeds and steppers, Cowork can also consume a deterministic event
timeline:

```bash
buddy autonomous-code --task-file task.json --workflow-events-file workflow-events.json
```

That artifact has `kind: "agentic-coding-workflow-events"` and one event per
workflow node, including `sequence`, `nodeId`, node type, status, severity,
message, and whether the node is active. It keeps the future Cowork feed simple:
show successes, the active step, and blocked nodes without reconstructing events
from the full report.

## Run Phases

### 1. Preflight

The cell reads workspace rules and current state:
- `AGENTS.md`, `CLAUDE.md`, `COLAB.md`, README, and relevant project docs;
- `git status --short --branch`;
- package scripts and test conventions;
- existing modified files.

It must stop or downgrade to planning if the requested scope collides with
unrelated dirty files.

### 2. Understanding

The cell maps the change before editing:
- search the codebase with `rg`;
- inspect source files directly;
- ask GitNexus for likely files, symbols, callers, callees, and impact when
  available;
- identify existing tests or likely test locations.

The output of this phase is a short execution plan with acceptance criteria.

### 3. Lock Behavior

When behavior is not already covered, the cell should add or update a focused
test before cleanup or risky edits. For tiny documentation-only changes this
phase can be skipped with a recorded reason.

### 4. Scoped Edit

The cell edits only files allowed by the task contract. If it needs to widen
scope, it stops and reports the required expansion.

Rules:
- prefer small diffs;
- reuse existing helpers and patterns;
- do not introduce dependencies;
- avoid broad rewrites;
- never revert user changes.

### 5. Verification

The cell runs the declared verification commands and reads the output.

If a verification command fails, the cell keeps iterating while the failure is
in scope and recoverable. If the failure is pre-existing or outside scope, it
must report that distinction with evidence.

### 6. Evidence Report

The final output is structured enough for Cowork, CLI, and future fleet peers:

```json
{
  "status": "completed",
  "summary": "What changed and why.",
  "filesChanged": ["src/example.ts", "tests/example.test.ts"],
  "testsRun": ["npm run typecheck", "npm test -- tests/example.test.ts"],
  "evidence": ["typecheck passed", "3 targeted tests passed"],
  "risks": ["Full suite not run"],
  "nextSteps": ["Run npm run validate before release"]
}
```

## Safety Gates

Low-risk tasks may execute directly inside the allowed scope.

Medium-risk tasks require stronger evidence:
- behavior locked by tests;
- diff reviewed by an independent reviewer or verifier role;
- no shared contract changes without targeted integration tests.

High-risk tasks should not be fully autonomous in V0:
- auth, payments, encryption, secrets, migrations, production deploys;
- physical robot action;
- broad refactors;
- changes touching policy enforcement or permission boundaries.

The high-risk path may still produce a plan, impact analysis, and proposed
patch, but it should not auto-complete without human review.

## Cowork Surface

Cowork should show the cell as a run with visible steps:
- task contract;
- current phase;
- plan;
- files inspected;
- diff;
- tests running;
- final evidence;
- blocked reason if stopped.

This turns autonomy into an observable process rather than a black box.

## Fleet Integration

Fleet support should start as read-only help:
- ask a peer to inspect a file;
- ask for an independent test idea;
- ask GitNexus-backed peers for impact;
- ask a verifier peer to review the final evidence.

Write delegation can come later, once file ownership and conflict protocols are
strong enough.

## First CLI Shape

The first user-facing command is experimental:

```bash
buddy autonomous-code --task-file task.json
```

It currently:
- parse and validate the task contract;
- optionally load a controlled edit proposal with
  `--edit-proposal-file <path>`;
- optionally write a constrained prompt for producing a proposal with
  `--proposal-prompt-file <path>`;
- run preflight;
- produce a report;
- include a structured execution plan with per-step status;
- preview declared replacements without writing files when `--preview-edits` is
  provided;
- apply declared exact text replacements only when `--apply-edits` is provided,
  the task passes preflight, and every edit path stays inside `allowedPaths`;
- require a successful preview in the same run before writing when
  `--require-preview` is combined with `--apply-edits`;
- optionally run declared verification commands only when `--run-verification`
  is provided and the preflight gate passes;
- choose `--autonomy-preset overnight` for longer unattended runs while keeping
  per-run overrides explicit;
- auto-create a resumable `overnight-*` checkpoint id when the overnight preset
  is used without `--run-id`;
- write an overnight manifest with the checkpoint path, artifact paths, Fleet
  posture, budget guards, resumable execution profile, resume command,
  audit command, and eight-hour supervise command;
- resume directly from that manifest with the stored run id, budgets, and
  diagnostic artifact paths, while preserving the original apply/preview/verify
  profile unless explicit CLI flags override it;
- supervise repeated bounded resume cycles from the manifest for unattended
  overnight watchdog runs, defaulting to 961 cycles at 30000 ms with a JSONL
  event written after each cycle, a stalled-progress guard after 3 repeated
  progress signatures, an error guard after 3 consecutive cycle failures, and
  `nextCycleAt` on non-final events for stale-watchdog detection;
- enforce the overnight watchdog window plus required Fleet proof up front with
  `--require-overnight-readiness`;
- enforce actual observed overnight completion with
  `--require-overnight-completion`, measured from persisted supervision cycle
  timestamps rather than configured cycle count;
- audit a finished run with `--audit-overnight-manifest <path>` without
  launching another cycle, and optionally apply the same readiness/completion
  gates to the stored evidence, including JSONL event consistency checks;
- write `supervision-recovery.json` for stalled, errored, or exhausted
  non-terminal supervision runs;
- write `supervision-fleet-triage.json` with a bounded `peer_chain` handoff
  when recoverable supervision stops with Fleet enabled;
- write `supervision-fleet-triage-result.json` with the attempted peer-chain
  triage result, preserving evidence even when no Fleet peer is connected;
- add an `inspect_fleet_triage_result` recovery action when that attempted
  triage result already exists;
- pin existing supervision artifact paths in copyable restart commands so
  restarted watchdogs preserve the audit trail;
- restart the watchdog from `supervision-recovery.json` with
  `--recover-from-supervision`, preserving the source manifest, thresholds, and
  diagnostic paths by default;
- include compact Fleet collaboration telemetry in every supervision JSONL
  event, making disabled, read-only, and delegated-slices runs distinguishable
  during overnight audits;
- auto-materialize overnight `report.json`, `workflow-progress.json`, and
  `workflow-events.json` unless explicit artifact paths are supplied;
- bound the self-correction loop with `--max-iterations <count>` and the
  estimated LLM spend with `--max-cost-usd <usd>`;
- write a final report to stdout;
- output JSON with `--json`;
- persist the JSON report with `--report-file <path>`;
- persist a Cowork proposal loop packet with `--proposal-loop-file <path>`;
- persist a Cowork proposal loop canvas with
  `--proposal-loop-canvas-file <path>`;
- persist a compact Cowork proposal-loop next action with
  `--proposal-loop-next-action-file <path>`;
- persist a data-only edit-proposal producer dispatch with
  `--edit-proposal-producer-dispatch-file <path>`;
- run the data-only edit-proposal producer and persist its controlled JSON with
  `--generate-edit-proposal-file <path>`;
- persist the matching producer trace next to the generated proposal so Fleet
  tool attempts/completions are auditable after unattended runs;
- fail generated-proposal runs with `--require-fleet-collaboration` when the
  producer trace does not prove a completed Fleet peer call;
- materialize a non-writing Cowork proposal loop artifact bundle with
  `--proposal-loop-artifacts-dir <path>`;
- persist a standalone Cowork import manifest with
  `--proposal-loop-cowork-import-file <path>`;
- persist a passive Cowork import availability check with
  `--proposal-loop-cowork-import-check-file <path>`;
- persist a Cowork workspace summary with
  `--proposal-loop-cowork-workspace-file <path>`;
- persist a compact producer-output review with
  `--edit-proposal-review-file <path>`;
- persist a compact Cowork approval artifact with `--approval-file <path>`;
- persist a constrained approval-decision prompt with
  `--approval-decision-prompt-file <path>`;
- consume a compact Cowork approval decision with
  `--approval-decision-file <path>`;
- require approval before writing with `--require-approval`;
- persist a workflow canvas artifact with `--workflow-file <path>`.
- persist a compact workflow event timeline with
  `--workflow-events-file <path>`.
- persist a non-writing workflow builder prompt with
  `--workflow-builder-prompt-file <path>`.
- load and validate a non-writing workflow builder proposal with
  `--workflow-builder-proposal-file <path>`.
- persist a canvas for that validated proposal with
  `--workflow-builder-proposal-canvas-file <path>`.
- persist a compact Cowork progress snapshot with
  `--workflow-progress-file <path>`.

## Current Implementation Foothold

The first pure core module is intentionally small:

- `src/agent/autonomous/agentic-coding-contract.ts` validates the V0 task
  contract, controlled edit proposals, controlled workflow-builder proposals,
  and decides whether a task may auto-execute.
- `src/agent/autonomous/agentic-coding-runner.ts` loads a task file, checks
  workspace rules, inspects `git status`, blocks dirty files outside the allowed
  scope, builds a structured execution plan, previews or applies declared scoped
  text replacements when explicitly requested, renders proposal prompts,
  validates and summarizes producer edit proposals, optionally runs
  verification, computes an approval state, projects the plan as a workflow
  graph, writes PostCommander-style workflow canvas artifacts, and renders
  workflow-builder prompts, validates workflow-builder proposals, writes
  proposal canvases, carries per-node workflow errors, writes progress
  snapshots with UI-ready next actions, writes compact approval-state snapshots,
  renders approval-decision prompts, writes proposal-loop packets with stepper
  state, graph nodes/edges, events, explicit producer-output review steps,
  canvas exports, compact next-action snapshots with Cowork UI action hints,
  non-writing artifact bundles with `coworkImport` panel manifests, standalone
  Cowork import manifests, passive import availability checks, Cowork workspace
  summaries with passive queue, stepper, graph, graph legend, graph viewport,
  command catalog, navigation, guardrails, supervision, review checklist,
  review route, badges, layout, artifact shelf, focus, panel
  states, decision form, action rail, operator brief, operator handoff,
  activity, approval, producer request, producer dispatch/review, evidence, and
  manifest hints,
  edit-proposal request envelopes, data-only producer dispatch artifacts, and
  review artifacts, consumes approval-decision snapshots before approved
  writes, writes compact workflow event timelines, includes advisory Fleet
  collaboration plans in run reports, progress snapshots, proposal-loop
  snapshots, and producer dispatches when `fleetPolicy` enables read-only help
  or delegated slices, or reports.
- `src/commands/cli/autonomous-code-command.ts` exposes the experimental
  `buddy autonomous-code --task-file task.json` command, including explicit
  loop/cost budget flags for long-running runs.
- `tests/agent/autonomous/agentic-coding-contract.test.ts` covers accepted
  defaults, unsafe scopes, missing verification, medium-risk blocking,
  high-risk path blocking, guarded edit validation, edit proposal validation,
  and data-only Fleet delegated-slices gating.
- `tests/agent/autonomous/agentic-coding-runner.test.ts` covers clean preflight,
  dirty outside-scope blocking, explicit verification, and dangerous command
  blocking, declared edit application, edit-scope blocking, ambiguous
  occurrence blocking, controlled proposal loading, malformed proposal blocking,
  edit preview without writing, preview ambiguity blocking, plus JSON report
  artifact writing, proposal prompt artifacts, edit-proposal review snapshots,
  approval-state reporting, and workflow graph reporting plus `--workflow-file`, workflow-builder prompts, and
  workflow-builder proposal validation/canvas export, including per-node error
  reporting, progress snapshot export for blocked workflow nodes, and compact
  approval-state snapshot export plus approval-decision prompt export,
  proposal-loop packet export, approval-decision gating, and workflow event
  timeline export plus proposal-loop canvas export, artifact bundle export,
  edit-proposal request export, producer dispatch export, producer-output review
  export, bundle and standalone `coworkImport` manifests, and next-action
  snapshot export with UI action hints, plus passive Cowork import checks and
  workspace summaries with queue, stepper, graph, graph legend, graph viewport,
  command catalog, navigation, guardrails, supervision, review checklist,
  review route, badges, layout, artifact shelf, focus, panel
  states, decision form, action rail, operator brief, operator handoff,
  activity, approval, producer
  request/dispatch/review hints, evidence, and manifest hints.
- `tests/commands/autonomous-code-command.test.ts` covers the CLI JSON path and
  explicit verification path, plus `--report-file`, `--preview-edits`,
  `--apply-edits`, `--require-preview`, `--edit-proposal-file`,
  `--edit-proposal-producer-dispatch-file`, `--edit-proposal-review-file`, and
  `--proposal-prompt-file`, `--workflow-file`, and
  `--workflow-builder-prompt-file`, `--workflow-builder-proposal-file`, and
  `--workflow-builder-proposal-canvas-file`, `--workflow-progress-file`, and
  `--workflow-events-file`, `--approval-file`, `--approval-decision-file`, and
  `--approval-decision-prompt-file`, `--proposal-loop-file`, and
  `--proposal-loop-canvas-file`, `--proposal-loop-next-action-file`,
  `--proposal-loop-artifacts-dir`, `--proposal-loop-cowork-import-file`, and
  `--proposal-loop-cowork-import-check-file`,
  `--proposal-loop-cowork-workspace-file`, `--require-approval`,
  `--generate-edit-proposal-file`, and invalid budget flag handling.

This gives the implementation a stable data-only producer boundary before it
applies patches or appears in Cowork. The producer may gather advisory Fleet
input, but patch application remains a separate guarded runner step.

## V0 Acceptance Criteria

The V0 is good enough when it can complete five real low-risk tasks in this
repository with:
- no edits outside `allowedPaths`;
- targeted tests passing;
- clear final evidence;
- no hidden dirty-file reversions;
- no push or deploy;
- a useful handoff when blocked.
