# Spec pipeline (`buddy spec`) — BMAD-inspired, review-gated delivery

Date: 2026-05-23
Inspiration: the BMad Method (spec-driven agentic delivery). This is **not** a
port of BMAD — it maps BMAD's best idea (durable, review-gated, context-rich
work units) onto Code Buddy primitives, the same discipline used for the Hermes
work (map the pattern, don't vendor the framework).

## Why

The fragile part of agentic delivery isn't planning — it's letting the agent run
a whole monolithic objective unsupervised (it loops, it over-reaches, it burns
tokens). The fix is structural: break work into a **durable backlog of stories**,
and **gate implementation on an explicit human approval of each story's spec**.

This is the third application of the propose → human approves → no silent action
discipline already shipped for [lessons](hermes-openclaw-parity.md) (lesson-candidate
queue) and the user model. Here the reviewed artifact is the **unit of work**.

## When to use which planning surface

| Surface | Use it for | Shape |
|---|---|---|
| `buddy dev plan/run/pr/fix-ci` | A single, well-scoped objective you want done quickly | Monolithic: plan → one confirmation → implement → test → summary (`src/commands/dev/workflows.ts`) |
| `buddy flow "<goal>"` | One goal you want decomposed and executed in-session | Ephemeral multi-agent plan → execute → synthesize, in-memory (`src/agent/flow/planning-flow.ts`) |
| **`buddy spec`** | Multi-story work you want to **review story-by-story**, with durable artifacts and lineage | Durable backlog: PRD/architecture → stories → per-story approval gate → implement one at a time |

Rule of thumb: reach for `spec` when the work is big enough that you want to
approve *what* gets built before *any* of it is built, and to track it across
sessions. Reach for `dev`/`flow` for a single contained change.

## Artifacts

```
.codebuddy/specs/
├── active.json                     # pointer to the active project
└── <project-id>/
    ├── project.json                # manifest: id, title, phase, planApprovals
    ├── prd.md                      # PRD (written by `spec plan`, human-editable)
    ├── architecture.md             # architecture (written by `spec plan`)
    ├── epics/<epic-id>.md          # epic (JSON frontmatter + body)
    └── stories/<story-id>.md       # context-engineered story
```

Each story `.md` has **JSON frontmatter (authoritative)** + a human-readable
body. The story status lives on the story file; `buddy spec status` derives the
sprint view by reading the stories — there is no second source of truth.

Story ids (`st-…`), epic ids (`ep-…`), project ids (`sp-…`) are stable and
opaque — never positional — so re-sharding never renumbers existing work.

## Story status state machine

```
draft ──approve(--by)──▶ approved ──start──▶ in_progress ──complete(--evidence)──▶ done (terminal)
  │                         │                     │
  └──block(--reason)──▶ blocked ◀────block────────┘
                           │
                           └──reopen──▶ draft        (approved ──reopen──▶ draft to revise)
```

Gates mirror the review discipline:
- **approve** requires a reviewer (`--by`) — nothing is implemented un-approved.
- **complete** requires `--evidence` (test pass / approved review) — `done` is terminal.
- **block** requires `--reason`.

Every legal and illegal transition is covered by `tests/spec/spec-store.test.ts`.

## CLI (foundation)

```bash
buddy spec init "Radar map app"                 # create + activate a project
buddy spec story add "Render radars" -c "shows radars within 5km" -n "webview React layer"
buddy spec status                               # derived sprint view
buddy spec story approve <id> --by "Patrice"    # the gate
buddy spec story start <id> --run <runId>
buddy spec story complete <id> --evidence "npm test green"
buddy spec story block <id> --reason "waiting on API key"
buddy spec story reopen <id>
buddy spec epic add "Map layer" -s "render + move"
```

## `buddy spec plan` — agentic, phased, review-gated planning (Commit 2)

`buddy spec plan` is the multi-agent planning layer. Specialist personas hand work
off to each other — Analyst/PM draft the PRD → an Architect designs the architecture →
a Scrum-Master shards the approved spec into small, independently-shippable stories —
and **a human reviews each artifact before the next persona runs**. State lives on
`SpecProject.phase` (`prd → architecture → sharding → implementation`); each invocation
advances exactly one phase, writes its artifact, and exits.

```bash
buddy spec plan start "Radar map app"          # draft prd.md  (phase → prd)
#   ...review/edit .codebuddy/specs/<id>/prd.md...
buddy spec plan continue --by "Patrice"         # approve prd → draft architecture.md
#   ...review/edit architecture.md...
buddy spec plan continue --by "Patrice"         # approve architecture → shard into draft stories
buddy spec story list                           # review the generated stories
buddy spec plan continue --by "Patrice"         # finalize (phase → implementation)
buddy spec plan status                          # phase, artifacts on disk, next command
```

- `continue` **reads the artifact back from disk**, so edits a human makes between
  phases are honored, and records the approving reviewer on the project (`planApprovals`).
- `--auto` on `start` runs every phase in one shot for non-interactive use; it still
  requires `--by` (the same approval gate, just batched).
- Sharded stories land in `draft` — the existing per-story `approve --by` gate is
  unchanged. The Scrum-Master also fills the story's **runner-contract fields**
  (`allowedPaths`, `verification`, `riskLevel`) so `buddy spec next` can feed a story
  straight into the autonomous runner with no translation step.

The personas are LLM-agnostic (`src/spec/spec-planner.ts`); the model call is injected,
so they unit-test with a fake. The phase machine itself lives in a UI-agnostic core
runner (`src/spec/spec-plan-runner.ts`) shared by the CLI (`src/commands/spec-plan.ts`,
which builds the provider from settings like `buddy flow`) **and Cowork**.

**From Cowork:** the Spec backlog panel has a "Plan (agents)" section — start a plan
from a goal, see the current phase + which artifacts exist, and advance one phase with
a reviewer name (`spec.planStart` / `planContinue` / `planStatus` IPC, LLM client built
from Cowork config). Sharded stories appear in the same panel with their risk / paths /
checks, ready for the per-story review gate.

## `buddy spec next` — autonomous-runner bridge (Commit 3)

`buddy spec next` is the execution end of the loop: it takes the next **approved** story
and hands it to the autonomous coding runner (`runAgenticCodingCell`). The story's
runner-contract fields (`allowedPaths`, `verification`, `riskLevel`) populate an
`AgenticCodingTaskContract` directly — that is why the planner fills them at sharding
time. Lineage is durable: **story → run → outcome**.

```bash
buddy spec next                                  # next approved story → runner (scaffold)
buddy spec next --story st-… --fleet read-only-help   # let the coding agent consult peers
buddy spec next --edit-proposal-file p.json --apply --run-verification  # apply + verify → done
buddy spec next --dry-run                         # print the contract, transition nothing
```

- The story moves `approved → in_progress` (recording the `runId` in its lineage)
  **only after** the contract validates — a bad/insufficient story stays `approved`.
- Terminal mapping: run `verified` → `completeStory` (verification is the evidence);
  `blocked` / `validation_failed` / `verification_failed` → `blockStory` (reason from the
  run); anything else (`ready`/`previewed`/`edited`, i.e. a scaffold with no applied
  edits) **leaves the story `in_progress`** with an explicit next step — never a false
  completion. A run that throws is caught and blocks the story, so it is never stranded.
- `--fleet <none|read-only-help|delegated-slices>` is where collaboration compounds: the
  coding agent invoked for a story can itself delegate to fleet peers.
- Each run writes durable artifacts under `.codebuddy/specs/<id>/runs/<runId>/`
  (`task.json` contract + `report.json`). The runner is lazy-imported (286KB) so it
  never inflates CLI boot.
- **From Cowork:** an approved story's card has **Preview** (`--dry-run`) and **Run ▸**.
  The `spec.next` IPC shells out to this CLI as a child process (so the GUI never
  blocks and the CLI stays the single source of truth), buffers the output, and shows
  it in the panel with the final status.

> Note: when the repo being edited is the current working directory, the runner forces
> `riskLevel: high` (self-improvement guard), so in-repo runs gate to scaffold/preview
> unless edits are explicitly supplied and approved.

## Roadmap

- **Commit 1 (done):** LLM-free foundation — data model, tested state machine, durable
  artifacts, CLI. Stories are added manually so the backbone is provable without model output.
- **Commit 2 (done):** `buddy spec plan start / continue / status` — phased PRD →
  architecture → sharded stories with a human gate between each phase. Stories carry the
  runner-contract fields needed by Commit 3.
- **Commit 3 (done):** `buddy spec next` — feed the next `approved` story to the
  autonomous coding runner; the story's `allowedPaths` / `verification` / `riskLevel`
  populate the `AgenticCodingTaskContract`; lineage story → run → outcome, with terminal
  status mapped back to the story (done / blocked / stays in_progress).

The full BMAD-inspired loop is now end to end: **plan (multi-agent, gated) → approve →
implement (autonomous runner, fleet-collaborative) → verify → done**, every artifact
durable and every gate human-reviewed.
