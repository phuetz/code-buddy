# Hermes / Cowork / CLI improvement log

Date: 2026-05-18
Workspace: local Code Buddy checkout (redacted for public docs)
Status: implementation plan plus first shipped slice

> **Improvement log** (chronological). For the current parity state and open gaps, see the canonical
> [`hermes-openclaw-parity.md`](hermes-openclaw-parity.md).

## Goal

Code Buddy should move toward the useful product shape shown by systems
like Hermes Agent and Manus-style operator UIs, while keeping its own
identity:

- CLI first for repeatable, scriptable, inspectable operations.
- Cowork first for human supervision, scheduling, visible progress and
  multi-agent orchestration.
- Fleet first for multi-AI delegation.
- Lessons and memory first for durable learning.
- TypeScript/React/Rust stack first; no Python runtime fork and no
  vendored Hermes runtime.

The operator should be able to start, inspect, schedule, continue and
learn from agent work from either surface:

- In the CLI: commands must emit stable JSON, readable text and Markdown.
- In Cowork: the same plan should be visible as a checklist and usable as
  a Fleet dispatch/scheduling prompt.

## External benchmark summary

Hermes Agent is useful as a benchmark because its public docs emphasize
the same durable-agent themes Code Buddy is already growing toward:

- persistent memory across sessions;
- reusable skills/procedural memory;
- scheduled jobs;
- multi-surface interaction through CLI and messaging gateways;
- isolated subagents and parallel work;
- browser/web automation and tool use;
- sandboxed execution backends.

Manus-style UIs are useful as a product benchmark because they make the
agent's work legible: the human sees a task plan, running steps,
artifacts, evidence and final outcome instead of only a chat transcript.

The Code Buddy translation is not "copy Hermes". The translation is:
make the same operating ideas native to Code Buddy's CLI, Cowork and
Fleet surfaces.

## Current Code Buddy baseline

Already present or underway:

- `buddy --agent hermes` built-in custom agent profile.
- `buddy hermes profile`, `buddy hermes doctor`, `buddy hermes agent`.
- `buddy hermes plan` with JSON/Markdown/text output and `--plan-output`.
- Hermes-style Fleet dispatch profiles:
  `balanced`, `research`, `code`, `review`, `safe`.
- Resolver-backed `fleet.hermes.<profile>` toolset metadata.
- Lessons graph and Obsidian-style vault export.
- Cowork Fleet Command Center with dispatch profile selection,
  scheduled Fleet work, Fleet memory, outcomes, saga board and proof-loop
  metadata.

## Gap analysis

1. Plan visibility gap
   - CLI can print a Hermes integration plan.
   - Cowork does not yet show that plan as an operator checklist.

2. Handoff gap
   - CLI can export a plan.
   - Cowork needs a direct way to turn the same plan into a Fleet goal.

3. Interaction-contract gap
   - The plan has checklist items.
   - It does not yet explicitly describe which surfaces consume the plan:
     CLI, Cowork and shared JSON.

4. Progress-loop gap
   - Fleet sagas expose live state.
   - The Hermes plan needs to be seedable as a goal so normal saga
     progress can become the visible execution layer.

5. Learning-loop gap
   - Lessons graph exists.
   - Cowork still needs stronger "finish -> lesson/memory -> next run"
     ergonomics for Hermes-style self-improvement.

## Product principles

1. One contract, many surfaces
   - A Hermes plan must be plain JSON first.
   - Text and Markdown are renderings, not separate truth.
   - Cowork should read the same shape rather than parse prose.

2. Human-visible autonomy
   - Every autonomous run should show next action, risk, artifacts,
     acceptance criteria and evidence.

3. Conservative execution
   - Profiles should stay explicit.
   - Risk labels should be visible before local writes or interactive
     execution.

4. Learning without hidden mutation
   - Lessons and project memory should be promoted deliberately or from a
     high-confidence signal, not silently.

5. Scripts as sandboxed skills
   - When an agent builds a scraper or analyzer, it should produce a
     bounded script, run it in a protected workspace, record evidence,
     then promote the useful pattern into lessons.

## Improvement plan

### Phase 1: Shared Hermes interaction contract

Objective: make `buddy hermes plan` describe both CLI and Cowork surfaces.

Implementation:

- Add `interactionSurfaces` to `HermesIntegrationPlan`.
- Include at least:
  - `cli`: command entrypoint, JSON/Markdown export, doctor/profile loop.
  - `cowork`: Fleet Command Center panel, checklist display, dispatch and
    schedule handoff.
  - `shared-json`: stable schema for tests, PR notes and future IPC.
- Render those surfaces in text and Markdown.
- Keep JSON backward compatible by adding fields, not removing fields.

Acceptance:

- `buddy hermes plan safe --json` includes `interactionSurfaces`.
- Text and Markdown mention CLI and Cowork.
- Existing Hermes tests pass.

### Phase 2: Cowork Hermes plan strip

Objective: surface the Hermes plan in the Fleet Command Center.

Implementation:

- Add a compact `HermesPlanStrip` component.
- Show selected profile, toolset, next command, checklist count and risk
  mix.
- Let the operator seed the Fleet goal from the plan.
- Keep the component pure and small.

Acceptance:

- Fleet Command Center imports and renders the strip.
- The strip uses the selected dispatch profile.
- A button can convert the plan into a dispatch-ready goal.
- Cowork targeted tests cover the helper/component wiring.

### Phase 3: CLI handoff refinement

Objective: make CLI output more useful for Cowork and future dashboards.

Implementation:

- Add file-output tests for JSON and Markdown.
- Keep `--plan-output` extension inference.
- Add stable `planSchemaVersion` changes only when shape changes
  incompatibly.

Acceptance:

- JSON file output is tested.
- Markdown file output remains tested.
- CLI smoke runs still work.

### Phase 4: Lessons and memory cockpit

Objective: close the Hermes-style learning loop.

Implementation:

- Add Cowork action to open or generate the lessons vault.
- Show recent lessons linked to Fleet outcome memories.
- Allow "promote outcome to lesson" separately from "promote outcome to
  memory".

Acceptance:

- Operator can see which lesson informed a dispatch.
- Lesson writeback is explicit and reversible.

### Phase 5: Script sandbox pipeline

Objective: support Manus-like "generate script, run in sandbox, learn"
for web/OSINT/business prospecting workflows.

Implementation:

- Represent script jobs as plan items with:
  - input sources;
  - extraction goal;
  - sandbox command;
  - expected artifacts;
  - proof assertions;
  - data minimization notes.
- Route through existing browser/web proof plan before persistence.

Acceptance:

- Generated scripts are never opaque one-off hacks.
- Every script run leaves artifacts and acceptance criteria.
- Lessons can capture the reusable extraction pattern.

### Phase 6: Durable multi-agent runbook

Objective: make Code Buddy feel like a durable agent workbench.

Implementation:

- Keep Fleet sagas as the visible run layer.
- Add lineage from Hermes plan -> saga -> outcomes -> memory/lessons.
- Add "resume from plan" affordance in Cowork and CLI.

Acceptance:

- A user can ask "continue this Hermes plan" from CLI or Cowork.
- The system can reconstruct what happened and what remains.

## First implementation slice

This pass implements Phase 1 and the first part of Phase 2:

- extend the Hermes plan contract with interaction surfaces;
- render the surfaces in CLI text/Markdown/JSON;
- add a Cowork strip that displays the selected Hermes plan and can seed
  a Fleet goal from it;
- add targeted tests and documentation.

## Risks

- The repo currently has many unrelated changes. Keep this slice narrow.
- Importing root Code Buddy helpers into Cowork must remain browser-safe.
- Cowork should not parse CLI text; it should use the JSON/typed plan
  shape.
- Avoid adding new dependencies or new persistence layers.

## Verification plan

Run targeted proof rather than the entire slow suite:

- Hermes profile tests.
- Hermes CLI command tests.
- Cowork Fleet Command Center tests.
- Targeted ESLint for touched TS/TSX files.
- Root typecheck.
- Cowork typecheck if the UI import path changed.
- CLI smoke:
  - `buddy hermes plan safe --json`
  - `buddy hermes plan safe --markdown`

## References

- Nous Research Hermes Agent overview: https://nousresearch.com/hermes-agent/
- Hermes Agent docs: https://hermes-agent.nousresearch.com/docs/
- Hermes cron docs: https://hermes-agent.nousresearch.com/docs/user-guide/features/cron/
- Hermes GitHub repository: https://github.com/NousResearch/hermes-agent
