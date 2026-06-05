# Recursive Self-Improvement Engine

> Status: **V1 (reversible learnable layer)**. The empirically-gated core of an
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

- **Reversible layer only.** V1 improves lessons (add/remove). Code-level
  self-modification (the DGM's “rewrite own code”) is **out of scope**.
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

## CLI

```bash
buddy improve status            # capability coverage, autonomy mode, archive
buddy improve cycle             # one cycle (propose-only by default)
buddy improve cycle --apply     # keep validated improvements (explicit intent)
buddy improve loop --apply      # bootstrap until no further validated progress
buddy improve archive           # list validated improvements
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
