# Autopilot Context — Agentic Coding Cell

## Task Statement

Continue implementing the Agentic Coding Cell in Code Buddy as the first guarded
software autonomy faculty for the long-term robot vision.

## Desired Outcome

Move beyond the existing V0 contract/preflight runner toward a controlled
execution plan and the first gated edit operation that can later be generated
by a safe autonomous code-edit loop.

## Known Facts / Evidence

- `docs/agentic-coding-cell.md` describes the V0 product contract.
- `src/agent/autonomous/agentic-coding-contract.ts` validates task JSON and
  blocks unsafe scope/risk.
- `src/agent/autonomous/agentic-coding-runner.ts` performs preflight, dirty-file
  checks, optional controlled edit proposal loading, optional scoped
  `replace_text` preview/apply, proposal prompt rendering, optional
  verification, PostCommander-inspired approval-state reporting, workflow graph
  projection, workflow canvas export, and reporting.
- `src/commands/cli/autonomous-code-command.ts` exposes
  `buddy autonomous-code --task-file`, with `--edit-proposal-file`,
  `--proposal-prompt-file`, `--preview-edits`, `--require-preview`,
  `--apply-edits`, `--run-verification`, `--report-file`, and
  `--workflow-file`, plus `--workflow-builder-prompt-file` and
  `--workflow-builder-proposal-file`, plus
  `--workflow-builder-proposal-canvas-file`, `--workflow-progress-file`, and
  `--workflow-events-file`, `--approval-file`, plus
  `--approval-decision-prompt-file`, `--approval-decision-file`,
  `--require-approval`, `--proposal-loop-file`, and
  `--proposal-loop-canvas-file`, plus `--proposal-loop-next-action-file`,
  `--proposal-loop-artifacts-dir`, `--edit-proposal-producer-dispatch-file`,
  `--proposal-loop-cowork-import-file`,
  `--proposal-loop-cowork-import-check-file`, and
  `--proposal-loop-cowork-workspace-file`, and `--edit-proposal-review-file`.
- Targeted tests currently pass: 94/94.
- `npm run typecheck` passes.
- Smoke CLI with `--workflow-file` produced `status: ready`,
  `kind: agentic-coding-workflow-canvas`, 11 nodes, 10 edges, and a
  `customNode` first node.
- Smoke CLI with `--workflow-builder-prompt-file` produced `status: ready`
  and a prompt containing `agentic-coding-workflow-builder-proposal`, the
  current canvas, and a no-direct-edits rule.
- Smoke CLI with `--workflow-builder-proposal-file` produced `status: ready`
  and loaded a 2-node / 1-edge proposal with an approval gate.
- Smoke CLI with `--workflow-builder-proposal-canvas-file` produced
  `status: ready`, `kind: agentic-coding-workflow-builder-proposal-canvas`, 2
  nodes, 1 edge, and a `customNode` first node.
- Smoke CLI for a deliberately blocked repo produced `status: blocked`,
  `activeNodeId: git-preflight`, 2 `workflow.nodeErrors`, and matching
  `data.errorMessages` on the `git-preflight` canvas node.
- Smoke CLI with `--workflow-progress-file` produced
  `kind: agentic-coding-workflow-progress`, `activeNodeId: git-preflight`, 2
  blocked nodes out of 11, and the first node error.
- Smoke CLI with a disconnected workflow builder proposal produced
  `status: validation_failed` and `unreachable node(s): orphan`.
- Smoke CLI with `--workflow-progress-file` now includes `nextAction`:
  `inspect_blocker` on `git-preflight` with the exact block message.
- Smoke CLI with `--approval-file` produced `status: previewed`,
  `kind: agentic-coding-approval-state`, `state: needs_approval`,
  `nextAction: review_preview`, and file `docs/note.md`.
- Smoke CLI with `--approval-decision-file --require-approval --apply-edits`
  produced `status: edited`, `approvalState: approved`, preview `previewed`,
  edit `applied`, and file content `after`.
- Smoke CLI with `--workflow-events-file` produced
  `kind: agentic-coding-workflow-events`, `activeNodeId: git-preflight`,
  active event severity `error`, and 12 events.
- Smoke CLI with `--approval-decision-prompt-file` produced
  `status: previewed`, `approvalState: needs_approval`, and a prompt containing
  `agentic-coding-approval-decision`, `docs/note.md`, and
  `Use decision "approved"`.
- Smoke CLI with `--proposal-loop-file` produced
  `kind: agentic-coding-proposal-loop`, `nextAction: review_preview`, 8 steps,
  including explicit `review-edit-proposal`, and inline edit-proposal plus
  approval-decision prompts.
- Smoke CLI for proposal-loop stepper state produced
  `activeStepId: review-preview`, `completed: 4`, `ready: 1`, `total: 8`.
- Smoke CLI for proposal-loop events produced 8 events with active event
  `review-preview`, severity `warning`, and sequence 5.
- Smoke CLI for proposal-loop graph projection produced 8 nodes, 7 edges,
  a `review-edit-proposal` -> `preview-scoped-edits` edge,
  `review-preview` typed as `approval`, and a `review-preview` ->
  `apply-approved-edits` edge.
- Smoke CLI with `--proposal-loop-canvas-file` produced
  `kind: agentic-coding-proposal-loop-canvas`, `activeNodeId:
  review-preview`, 8 nodes, 7 edges, and an approval `customNode` logic node.
- Smoke CLI with `--proposal-loop-artifacts-dir` produced
  `kind: agentic-coding-proposal-loop-artifact-bundle`, `activeStepId:
  review-preview`, 13 materialized artifact entries, and files for loop packet,
  canvas, edit-proposal request, edit-proposal producer dispatch,
  edit-proposal review, proposal-loop next action, prompts, approval state,
  workflow progress/events, and seed report.
- Smoke CLI with `--edit-proposal-review-file` produced
  `kind: agentic-coding-edit-proposal-review`, `state: accepted`,
  `nextAction: preview_edits`, file `docs/note.md`, and preserved proposal
  producer metadata.
- Smoke CLI with `--edit-proposal-file --proposal-loop-file` before preview
  produced `activeStepId: review-edit-proposal`, `nextAction:
  review_edit_proposal`, `review-edit-proposal` ready, and
  `preview-scoped-edits` pending.
- Smoke CLI with `--proposal-loop-next-action-file` before preview produced
  `kind: agentic-coding-proposal-loop-next-action`, `runState:
  ready_command`, `canRunCommand: true`, active step `review-edit-proposal`,
  command args containing `--edit-proposal-review-file`, and
  `ui.primaryAction.type: run_command`.
- Smoke CLI with `--proposal-loop-artifacts-dir` after preview now writes
  `proposal-loop-next-action.json` with `runState: human_input_required` and
  `canRunCommand: false` for the approval step, plus
  `ui.primaryAction.type: human_review`.
- Smoke CLI with `--edit-proposal-producer-dispatch-file` produced
  `kind: agentic-coding-edit-proposal-producer-dispatch`, `runPolicy.mode:
  data_only_edit_proposal`, 3 allowed read-only tool hints, review command args
  containing `--edit-proposal-review-file`, and output file `edit-proposal.json`.
- Smoke CLI with `--proposal-loop-artifacts-dir` now includes
  `edit-proposal-producer-dispatch.json`, materialized role
  `edit_proposal_producer_dispatch`, and a dispatch review command.
- Smoke CLI with `--proposal-loop-artifacts-dir` now also exposes
  `artifact-bundle.json.coworkImport`, with `defaultPanelId: canvas`,
  `suggestedFocusPanelId: approval`, queue artifact
  `proposal-loop-next-action.json`, and panels for canvas, next action,
  approval, producer request, producer dispatch, events, seed report, and
  manifest.
- Smoke CLI with `--proposal-loop-cowork-import-file` produced a standalone
  import map with `defaultPanelId: canvas`, `suggestedFocusPanelId: approval`,
  queue artifact `proposal-loop-next-action.json`, 9 panels, and producer
  dispatch plus approval panels.
- Smoke CLI with `--proposal-loop-cowork-import-check-file` after bundle
  materialization produced `status: ready`, no missing required artifacts,
  queue artifact present, 9 panels, and all panel artifacts present.
- Smoke CLI with `--proposal-loop-cowork-workspace-file` produced a ready
  workspace summary with `openPanelId: approval`, `primaryAction.type:
  open_panel`, no unavailable panels, and status text `Workspace ready: 9/9
  panels available.`
- Workspace summaries now include passive queue details from
  `proposal-loop-next-action.json`: `runState: human_input_required`, active
  step `review-preview`, `nextActionType: review_preview`, and
  `uiPrimaryAction.type: human_review`.
- Workspace summaries now also include passive stepper details from
  `proposal-loop.json`: active step `review-preview`, counts `completed: 4`,
  `ready: 1`, `total: 8`, and compact step rows for Cowork sidebars.
- Workspace summaries now include a passive command catalog from
  `proposal-loop.json`: command count `5`, ready command count, command text,
  step status, safety notes, and input/output artifacts for Cowork command
  palettes.
- Workspace summaries now include a passive graph summary from
  `proposal-loop.json`: active node `review-preview`, 8 nodes, 7 edges,
  approval node ids, blocked node ids, and status counts for Cowork graph
  mini-maps.
- Workspace summaries now include passive activity details from
  `workflow-events.json`: active event for the active workflow node, severity
  counts, total events, and compact event rows for Cowork activity feeds.
- Workspace summaries now include passive approval details from
  `approval-state.json`: `state: needs_approval`, source active node
  `approval-decision`, affected file `docs/note.md`, and next action
  `review_preview`.
- Workspace summaries now include passive producer details from
  `edit-proposal-request.json`, `edit-proposal-producer-dispatch.json`, and
  `edit-proposal-review.json`: request instructions, safety count, schema keys,
  dispatch mode `data_only_edit_proposal`, read-only tools, review command,
  review state, affected files, and producer next action.
- Workspace summaries now include passive evidence details from
  `seed-report.json`: run status, approval state, blocked/validation reasons,
  edit counts, verification counts, and compact workflow counts.
- Workspace summaries now include passive manifest details from
  `artifact-bundle.json`: materialized artifact count, roles, safety notes,
  Cowork panel count, required artifact count, and source state.

## Constraints

- Worktree has many pre-existing unrelated changes. Do not revert or touch them.
- Keep additions isolated to the Agentic Coding Cell lane.
- Code edits are declarative only in this tranche: exact `replace_text`, path
  checked against `allowedPaths`, expected occurrence count required.
- Agent-produced edits must cross the proposal-file boundary first; the runner
  validates and applies, not the model.
- `--preview-edits` gives Cowork/agents evidence before file writes; it must
  stay non-writing.
- `--require-preview` must force a successful same-run preview before
  `--apply-edits` writes target files.
- `--proposal-prompt-file` writes the constrained prompt for an agent to produce
  proposal JSON; it is also non-writing with respect to repo target files.
- `--proposal-loop-file` writes an orchestration packet only: prompts, expected
  artifact paths, and command args for Cowork/agents. It must not execute the
  loop by itself. It also carries stepper metadata (`activeStepId`, counts,
  completed/blocked step ids), graph projection (`nodes`/`edges`), and per-step
  events for future Cowork visualization. Producer output review is an explicit
  loop step before preview.
- `--proposal-loop-canvas-file` writes a visual artifact only. It should remain
  derived from the safe proposal loop packet and must not execute commands,
  approve edits, or write target repo files.
- `--proposal-loop-artifacts-dir` materializes only non-writing run artifacts
  for Cowork or an agent consumer. It must not execute loop commands, apply
  edits, approve decisions, or write target repo files. Its `coworkImport`
  section is an import map only and must not imply execution authority.
- `--proposal-loop-cowork-import-file` writes only that import map. It must not
  materialize loop artifacts, execute commands, approve decisions, or write
  target repo files.
- `--proposal-loop-cowork-import-check-file` reads the generated import map and
  writes only a file-presence report. It must not execute commands, parse
  artifacts as authority, approve decisions, or write target repo files.
- `--proposal-loop-cowork-workspace-file` writes only a UI opening summary
  derived from the import check. It must not execute commands, approve
  decisions, or write target repo files.
- Workspace queue details are copied as inert UI data only. `commandText` must
  remain text and must not be executed by the workspace export.
- Workspace stepper details are copied as inert UI data only. They summarize
  `proposal-loop.json`; they must not be interpreted as permission to run,
  approve, apply, push, or deploy anything.
- Workspace command details are copied as inert UI data only. `commandText`
  must remain display/copy data and must not be executed by the workspace
  export.
- Workspace graph details are copied as inert UI data only. They summarize
  `proposal-loop.json`; they must not be interpreted as permission to run,
  approve, apply, push, or deploy anything.
- Workspace activity details are copied as inert UI data only. They summarize
  `workflow-events.json`; they must not be interpreted as permission to run,
  approve, apply, push, or deploy anything.
- Workspace approval details are copied as inert UI data only. They summarize
  `approval-state.json`; they must not be interpreted as an approval decision
  or permission to apply edits.
- Workspace producer details are copied as inert UI data only. They summarize
  producer request/dispatch/review artifacts; they must not be interpreted as
  permission to launch an agent, preview, approve, apply, push, or deploy.
- Workspace evidence details are copied as inert UI data only. They summarize
  the seed report; they must not be interpreted as permission to run, approve,
  apply, push, or deploy.
- Workspace manifest details are copied as inert UI data only. They summarize
  `artifact-bundle.json`; they must not be interpreted as permission to launch
  agents, execute commands, approve, apply, push, or deploy.
- `--proposal-loop-next-action-file` writes a compact consumer snapshot only.
  It may expose a copyable safe command and Cowork UI hints, but must not
  execute it.
- `edit-proposal-request.json` is a producer envelope only: it tells a future
  agent where to read the prompt and where to write controlled proposal JSON.
  It must not be treated as permission to edit files directly.
- `--edit-proposal-producer-dispatch-file` writes a producer invocation
  boundary only. It packages messages, current workflow state, read-only tool
  hints, forbidden actions, target output path, and review command; it must not
  run an agent or grant direct edit authority.
- `--edit-proposal-review-file` writes a validation/review snapshot only. It
  must not preview, apply, approve, execute commands, or modify target repo
  files.
- The run report now exposes `approval` plus a workflow graph (`nodes`, `edges`,
  `activeNodeId`, `completedNodeIds`, `blockedNodeIds`) inspired by
  PostCommander's workflow builder and runner progress model.
- `--workflow-file` must remain a UI/export bridge: it writes a separate
  canvas artifact and does not grant write authority over target repo files.
- `--workflow-builder-prompt-file` must remain non-writing and only shape a
  future workflow-builder agent's JSON output.
- `--workflow-builder-proposal-file` must remain non-writing; it only validates
  and reports a proposed graph, including node-id and edge-reference checks.
- `--workflow-builder-proposal-canvas-file` must remain non-writing with
  respect to target repo files; it only exports a visual artifact for Cowork.
- Workflow node errors should stay derived from blocked plan steps so Cowork can
  show failure causes without inventing explanations.
- `--workflow-progress-file` should stay a compact, non-writing Cowork status
  snapshot for steppers/sidebar views, separate from full canvas artifacts.
- Workflow builder proposals now require exactly one `trigger` node and all
  nodes reachable from it.
- Workflow progress snapshots include deterministic `nextAction` for Cowork UI.
- Approval snapshots should stay compact and queue-friendly: state, reason,
  next action, affected files, preview/apply counts, and approval gate nodes.
- Approval decision prompts should stay non-writing and strictly review-shaped:
  schema, contract, approval state, scoped edit previews, and decision rules.
- Approval decisions are controlled JSON (`agentic-coding-approval-decision`).
  When `--require-approval` is used, apply must stay blocked unless the
  decision is `approved`; rejected decisions become explicit workflow blockers.
- Workflow event timelines should stay deterministic and derived from graph
  nodes/errors only: one ordered event per node for activity feeds/steppers.
- No new dependencies.

## Unknowns / Open Questions

- How deeply the future runner should reuse the existing interactive agent loop
  to propose declared edits.
- Exact Cowork run artifact format.
- Whether verification command execution should later use BashTool policy rather
  than the current direct validator path.

## Likely Touchpoints

- `src/agent/autonomous/`
- `src/commands/cli/autonomous-code-command.ts`
- `tests/agent/autonomous/`
- `tests/commands/`
- `docs/agentic-coding-cell.md`
