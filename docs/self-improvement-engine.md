# Recursive Self-Improvement Engine

> Status: **Reversible learning plus reviewed code evolution**. The empirically-gated core of an
> agent that improves itself — designed to become the brain of Patrice's robot,
> with the senses plugging into the same loop.

## Why

Code Buddy already *records* its work (RunStore), *reflects* on it
(retrospectives), and *remembers* (lessons, skills, patterns) — but a human has
to approve every improvement. The self-improvement engine closes that loop
**safely and autonomously**: it proposes improvements, **validates them
empirically against a deterministic benchmark**, and keeps only the changes that
measurably help with zero regressions — every change reversible and audited.

It is built on the project's guiding principle — *“construire petit, propre et
mesurable”* — and on two results from the literature:

- **Darwin Gödel Machine** ([Sakana, 2025](https://sakana.ai/dgm/)) — a
  self-improving agent that **empirically validates** each self-modification
  against a benchmark instead of requiring a formal proof, and keeps an
  **archive** of validated agents as evolutionary stepping stones.
- **Voyager** ([Wang et al., 2023](https://voyager.minedojo.org/)) — an
  ever-growing, **self-verified skill library** driven by an automatic
  curriculum.

The key adaptation: our validation signal is **deterministic and cheap** (a pure
function of lessons + scenarios), so a before/after delta reflects the *change*,
not LLM run-to-run noise. That's what makes the empirical gate trustworthy on a
small fixture set, where live-agent benchmarks would need hundreds of tasks to
denoise.

## The loop

```
ExperienceSource → Curriculum → Proposer → Empirical Gate → Archive
   (what hurt?)   (weakest cap) (a fix?)  (snapshot/apply/   (stepping
                                           re-score/keep|     stones)
                                           rollback)
```

1. **Observe** — an `ExperienceSource` yields friction. Today:
   `RunExperienceSource` mines run retrospectives. Tomorrow: the robot's senses
   (see below).
2. **Curriculum** — pick the weakest capability (first uncovered benchmark
   scenario).
3. **Propose** — an `ImprovementProposer` drafts a candidate lesson. V1 ships a
   deterministic `StaticProposer` + a curated bootstrap pack; the production path
   is an injected LLM proposer.
4. **Empirical gate** (`empirical-gate.ts`) — snapshot → apply transiently →
   re-score the deterministic `CapabilityBenchmark` → **accept iff Δ>0 AND no
   regression AND structurally valid**; otherwise roll back.
5. **Archive** (`evolutionary-archive.ts`) — append validated wins with rollback
   refs and lineage.

## Safety model

- **Reversible layer only.** V1 improves lessons (add/remove). Code variants are produced separately by `buddy evolve` in isolated worktrees; their promotion requires explicit confirmation on an integration branch.
- **Tiered autonomy, fail-safe.** `propose-only` by default — validates and
  *reports* what would help but persists nothing. `auto-apply` requires
  `CODEBUDDY_SELF_IMPROVE=true` (or `--apply`), and even then keeps only
  empirically-validated, reversible, audited changes.
- **No self-dealing evals.** The benchmark scenarios (the evals) are curated and
  kept **structurally separate** from the proposer, so the engine can never
  author the checks that bless its own changes.
- **No regressions.** A change is rejected if it makes *any* previously-covered
  scenario worse.
- **Everything audited.** Archive entries are stamped `auto:self-improve` and
  carry the score delta + a rollback reference.

## Experience Sources (`RunExperienceSource` & `DelegationLogsExperienceSource`)

Experiences feed the self-improvement loop with grounded operational friction:
- **`RunExperienceSource`**: Extracts lessons, tool errors and failure patterns from local task runs.
- **`DelegationLogsExperienceSource`**: Ingests read-only delegation logs (e.g. from subagent lanes and task coordinator runs) under `~/.codebuddy/logs/delegation/` or workspace configs, extracting anonymized delegation facts (task duration, model, blocker patterns) and synthesizing pilot lessons without exposing personal paths. Activated with opt-in `CODEBUDDY_SELF_IMPROVE_DELEGATION_SOURCE=true` or via CLI options.

## CLI

```bash
buddy improve status            # capability coverage, autonomy mode, archive
buddy improve digest            # markdown/HTML summary of recent improvements
buddy improve cycle             # one cycle (propose-only by default)
buddy improve cycle --apply     # keep validated improvements (explicit intent)
buddy improve cycle --llm       # let the model DISCOVER a novel lesson, then validate it
buddy improve tools --apply     # author and gate tools through G1 (static) -> G4 (held-out)
buddy improve skills --apply    # author and gate skills through SG1 (structure) -> SG4 (held-out)
buddy improve loop --apply      # bootstrap until no further validated progress
buddy improve archive           # list validated improvements
```

## Tools & Skills Self-Authoring (`buddy improve tools|skills`)

Beyond lessons, the agent authors its own tools (`authored__*`) and skills (`authored-*`):

- **Tools**: Generated by `LlmToolProposer` in `llm-tool-proposer.ts` from a redacted view with no held-out cases visible, then gated sequentially by:
  - **G1**: AST & dangerous pattern static scan, strict memory & byte limits.
  - **G1b**: Mandatory `authored__*` naming prefix and isolated exports.
  - **G3**: Visible behavioral input/output test cases.
  - **G4**: Held-out secret behavioral test cases (anti-gaming defense).
  Validated tools: `authored__extract_url_statuses` (`sitemap-check`), `authored__audit_ffmpeg_argv` (`ffmpeg-argv-audit`), `authored__find_orphan_temp_files` (`orphan-temporaries`).
- **Skills**: Generated by `LlmSkillProposer` and orchestrated by `skill-engine.ts`, gated sequentially by:
  - **SG1**: Frontmatter validity, non-empty structured instructions, title and triggers.
  - **SG2**: Static safety scan + full-document firewall (`scanSkillFirewall`, prompt-injection and exfiltration defenses).
  - **SG3**: Visible guidance coverage check.
  - **SG4**: Held-out guidance coverage, still a lexical relevance check.
  - **Behavioral gate before auto-apply**: paired runs with/without the skill on curated file tasks, executed through `ToolHarness`. Check final file contents, preservation/removal and required ordering of effects. At least one observed gain, no loss, and every candidate task passing are required. These small fixtures provide execution evidence, not a statistical guarantee of general skill quality.
  Validated skills: `authored-relecture-typographique-francaise` (rules for « », non-breaking spaces, curly apostrophes, decimal commas, code block protection), `authored-mission-contrat-lane` (formalization of autonomous lane contracts: dedicated clone, report before inspection, isolated HOME, atomic named commits, touched files proof, 10-line summary).

**Proposers.** Default is a deterministic, offline `StaticProposer` (a curated
bootstrap pack). `--llm` swaps in `LlmProposer`, which asks the agent's own model
to draft a *novel* lesson from real run friction — creative generation gated by
the *same* deterministic empirical validator, so a hallucinated or off-target
draft is simply rejected and rolled back. This is the autonomy leap: the system
discovers its own improvements and only keeps the ones that measurably help.

## What this measures — and what it does NOT (read this)

Be precise about the signal, because this is meant to become the core of a robot
and overclaiming propagates for years.

**What the benchmark measures:** for a situation `query`, does a *retrievable,
on-topic* lesson exist (a lesson `search(query)` returns whose text contains the
expected guidance keywords), and does adding it regress nothing? In other words:
**retrievability + relevance + non-regression**.

**What it does NOT measure: correctness.** The gate filters *off-topic* and
*malformed* proposals, not *wrong* ones. A lesson like *"When running npm test,
NEVER use a path filter"* is on-topic and retrievable, so the keyword gate would
**accept** it — even though the advice is wrong. And in the `--llm` path the
draft prompt currently tells the model which keywords to include, so the gate is
partly checking that the model copied the words it was given. Treat the current
score as a **proxy for capability (does the right guidance surface?)**, not a
behavioural guarantee (does the agent now act correctly?).

**Making "empirical" real (in progress).** A deterministic down-payment now ships
for the subclass of improvements that encode a *checkable behavioral rule*:
`execution-gate.ts` validates a proposed rule by how well it **correctly
classifies real recorded trajectories** — does it flag the bad runs and pass the
good ones — with a counterfactual-ablation pre-filter (reject rules that change
no verdict) and a no-regression guard. This measures *correctness against
recorded behavior*, not keyword presence: e.g. a plausible-but-wrong rule
("every run must use bash") is rejected because it misclassifies the compliant
read-only runs — which the retrieval benchmark could never catch. It is
deterministic and cheap (no live agent, no LLM-judge), grounding the gate exactly
as the Darwin Gödel Machine does, on execution outcomes.

**Paired LIVE gate (general lessons).** For lessons that aren't checkable rules,
`paired-gate.ts` runs the agent WITH the candidate lesson and WITHOUT it on a set
of graded tasks (the lesson is the only delta), and accepts only on a
**paired-Bayesian sign test** — the statistically-sound way to decide from few
noisy paired evals (CLT error bars are unreliable at N<100). Guards: a
counterfactual-ablation pre-filter (reject a lesson that changes no behavior), a
safety-regression hard stop, and anytime-valid early stopping. `buddy improve
verify "<lesson>"` runs it against a seed task set on the real model. Verified
live (Ollama qwen2.5:7b): a path-filter lesson ACCEPTS (4 win / 0 loss, P=0.969),
an off-topic lesson REJECTS. This measures *behavioral* improvement, not
retrievability — the genuine fix. Note it grades the model's RESPONSE to a task
(one call per arm); grading full tool-using execution is the next horizon, and
the seed tasks must be in the lesson's domain (operators curate per-capability
task sets, human-gated).

## Reversibility (git-backed)

The whole mechanism is reversible: if an applied improvement turns out bad, you
return to a version that works better. The learnable state (lessons + archive +
the benchmark score of that version) is versioned in a **dedicated, isolated git
repo per project** at `.codebuddy/self-improvement/store/` (`.codebuddy/` is
gitignored by the project, so this never touches the main history).

- Each applied improvement (`--apply`) becomes a **commit carrying its score**
  in `manifest.json`.
- `buddy improve versions` lists versions with scores (HEAD / BEST marked).
- `buddy improve restore --best` (or `--commit <sha>`) re-materialises the
  best-scoring version through the `LessonsTracker` API (in-memory and
  `lessons.md` stay consistent) and commits the restore. History is
  **append-only** — restore moves forward by re-applying old content, never
  rewrites.
- `--push` pushes the store to a git remote you configure (local-first; nothing
  leaves the machine otherwise).

```bash
buddy improve loop --apply        # version each validated improvement
buddy improve versions            # list scored versions
buddy improve restore --best      # revert to the version that works better
```

## The robot seam (5 senses)

`ExperienceSource` is **modality-agnostic**. `SensorExperienceSource` is the
plug-in point for the robot: when senses are available, a world-model (JEPA)
encodes each modality into a latent `z` and predicts `z_{t+1}`; the **prediction
error / latent surprise** becomes the `Experience` signal, and the engine
improves the policies/skills that reduce that surprise — the *same*
observe→propose→validate→keep loop, no engine change. It is **interface-only**
in V1 and refuses to run rather than emit fake signals.

## Files

| Module | Role |
|---|---|
| `src/agent/self-improvement/types.ts` | Shared types (Experience is modality-agnostic) |
| `…/capability-benchmark.ts` | Deterministic, offline retrieval scorer + curriculum |
| `…/empirical-gate.ts` | DGM-style snapshot/apply/re-score/keep-or-rollback |
| `…/proposer.ts` | Proposer seam + deterministic static proposer + seed pack |
| `…/evolutionary-archive.ts` | Append-only archive of validated wins |
| `…/experience-source.ts` | Run-friction source + robot sensor seam |
| `…/engine.ts` | Orchestrator (cycle/loop/status) + autonomy resolution |
| `…/index.ts` | Workspace wiring (real LessonsTracker port) |
| `src/commands/cli/improve-command.ts` | `buddy improve …` |

## Roadmap

- **V1.1** — LLM-backed proposer drafting lessons from real run friction;
  skill (not just lesson) proposals with structural validation; promote the
  benchmark from a seed set to run-derived scenarios (human-reviewed curation).
- **V2** — pattern/prompt improvements; multi-objective archive
  (quality-diversity), so the engine keeps diverse stepping stones.
- **Robot** — `SensorExperienceSource` over the JEPA world-model prediction-error
  stream; per-modality micro-benchmarks; the loop runs on the robot's lived
  experience.


## Corrections verified on 2026-09-13

`create_skill` and the forge now share the authored skill installer. Generated names use `authored-*` and the path is `.codebuddy/skills/<authored-name>/SKILL.md`. YAML is serialized and parsed, frontmatter cannot substitute a different identity, existing skills require explicit overwrite, and pinned skills cannot be overwritten. Loading must succeed before success is reported; a failed installation restores the prior file. The tool adapter passes the execution workspace explicitly.

`improve skills --apply` now needs a configured model for behavioral verification in addition to its existing opt-in. The static/coverage result remains provisional. Each of the four seed scenarios has two curated tasks, run once without and once with the skill: up to four additional model requests per candidate. A missing provider, missing task set, failed task, regression, or no observed gain prevents installation. The archive records outcome pairs and hashes of the installed document and benchmark. The model writes bounded JavaScript using file tools inside a fresh temporary fixture; it cannot author the expected outcomes.

Authored JavaScript, TypeScript (transpiled in the parent) and Python run under **Linux Landlock ABI ≥3 plus seccomp**, with Python 3 as the trusted bootstrap. Supported architectures: x86_64 and aarch64 (x86_64 exercised here). Host private files are inaccessible, system runtime libraries are read-only, networking and spawning separate processes are denied. Files are confined to the private temporary run directory; CPU, data memory, file size, descriptors and Node heap are bounded. Temporary artifacts are removed on completion. Other platforms or missing kernel facilities return an error rather than execute unrestricted code.

`buddy evolve run` now separates required type/test checks from a graded objective. The default objective is the protected offline `eval/harness-benchmark.mjs`: 17 tool-search and programmatic execution tasks. `--eval-task <ids...>` explicitly selects whole-agent LLM tasks instead; those require a provider usable in the evaluation environment. The candidate and baseline are built and evaluated in isolated worktrees. Baseline references are resolved to a SHA before the round. Vitest counts come from a separate JSON report, so subprocess logs and file-summary counts do not corrupt the measurement. Losing any previously passing task, or dropping a component, is a regression.

```bash
CODEBUDDY_EVOLVE=true buddy evolve run --baseline HEAD --goal "Improve tool discovery"
buddy evolve review <id>
# On an integration branch, after reviewing the evaluated commit:
buddy evolve keep <id> --confirm
```

Promotion refuses failed/regressed variants and branches whose tip differs from the evaluated SHA. It merges the evaluated commit, not a subsequently movable branch name. The store retains the baseline SHA and full component report. Main/master remain protected.

Verification report: [skills/DGM corrections](reports/2026-09/CORRECTIONS-SKILLS-DGM-2026-09-13.md).
