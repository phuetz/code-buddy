# Memory, learning and research-inspired mechanisms

Reviewed against source candidate `01fc0dbd3d2d17a079faeaa9635d677783177cb7` on 2026-09-14. This is a source and documentation review, not a new end-to-end performance benchmark. [Présentation française](../README.fr.md).

| Mechanism | What exists and when it runs |
|---|---|
| Persistent memory | Project `.codebuddy/CODEBUDDY_MEMORY.md` and user `~/.codebuddy/memory.md`; scoped bot stores where applicable; prompt integration with limits |
| Lessons | Ranked, budgeted context retrieval; session-end candidate proposals behind `SESSION_END_FLUSH` (default on), subject to session/provider conditions; review queue before activation |
| Authored skills | Proposal, validation, explicit application, pin/archive/restore and coverage-gated consolidation |
| Learned-layer improvement | `improve` can validate lessons/tools/skills; `SELF_IMPROVE=true` stays propose-only; literal `auto-apply` or applicable command authorization is needed to keep changes |
| Code evolution | `evolve` builds and evaluates isolated code variants; the engine never merges them automatically |
| Council | Deterministic conductor, complementary roles, evaluation/synthesis and routing scores when Council is invoked |
| ToT/MCTS | Explicit reasoning engine with search budgets; separate middleware can inject reasoning guidance |

## Inspect before applying

```bash
buddy lessons candidate list
buddy lessons list
buddy lessons search "test"
buddy lessons context
buddy improve status
buddy improve skills-list
buddy evolve list
```

These inspect different stores and may correctly return no entries. `buddy improve skills-consolidate` previews a proposed merge and may call a model; `--proposal-file` supplies a local proposal. Its explicit `--apply` option controls installation and archival. In this candidate it does **not** use the same environment guard as generative `improve skills --apply`; do not infer a universal double gate.

For code variants, inspect `buddy evolve review ID`. `evolve keep ID` previews; `--confirm` requests a merge into an eligible current branch, subject to its checks. The default evolution objective is an offline harness benchmark; whole-agent LLM evaluation is a separate opt-in.

For reasoning, `/think status` inspects the selected setting. Actual search execution and its evidence must still be distinguished from middleware guidance. All these mechanisms change external state or inference-time processing; they are not model-weight training.

## One incident, several reusable artifacts

Consider a connection test using the wrong profile. Project memory can retain which profile the repository uses. A reviewed lesson can explain when to compare profiles before diagnosing a server outage. A skill can turn that lesson into a sequence: inspect the active profile, compare the target, make a minimal request, rerun the failing test. These artifacts support different parts of the next debugging session.

An explicit MCTS search repeats selection, expansion, evaluation and backpropagation: choose a promising or under-explored hypothesis, generate candidate next steps, evaluate them, then update the ancestors' visits and rewards. For the same connection failure, the search might compare wrong-profile, unreachable-server and expired-credential hypotheses. Reliable execution feedback matters more than a plausible explanation alone.

A separate [recorded fleet example](reports/2026-09/fleet-two-hosts-learning-example.md) used Windows for RPC review and Linux for a one-line correction. An independent five-case oracle passed on both hosts. Messages and files were manually relayed by the pilot; this was not Council or autonomous peer delegation.

## Research attribution

- [Manus context engineering](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus): file-backed context and useful failure observations. Code Buddy's review queue is its own implementation.
- [Sakana DGM](https://sakana.ai/dgm/): empirical code-variant improvement inspires the evolution path; no reproduction of its published benchmark is claimed.
- [ShinkaEvolve](https://sakana.ai/shinka-evolve/): cited by parent/model selection code. The model bandit is explicitly selectable with `buddy evolve run --model-bandit`.
- [Sakana Fugu](https://sakana.ai/fugu-release/) and its [technical report](https://arxiv.org/abs/2606.21228): learned orchestration is the research reference. Council's current deterministic conductor differs from that trained model and from AB-MCTS.
- [Tree of Thoughts](https://arxiv.org/abs/2305.10601), [RethinkMCTS](https://arxiv.org/abs/2409.09584), [MCTSr](https://arxiv.org/abs/2406.07394): references for exploration, refinement and scoring. Their reported benchmark gains are not Code Buddy results.

## Implementation and regression entry points

| Topic | Source | Existing tests to inspect |
|---|---|---|
| Memory | [persistent-memory](../src/memory/persistent-memory.ts), [prompt-builder](../src/services/prompt-builder.ts) | `tests/memory/` |
| Lessons | [session-end-flush](../src/agent/session-end-flush.ts), [context-pipeline](../src/agent/execution/context-pipeline.ts) | [candidate queue](../tests/agent/lesson-candidate-queue.test.ts) |
| Skills | [consolidator](../src/agent/self-improvement/skill-consolidator.ts), [CLI contracts](../src/commands/cli/improve-command.ts) | [consolidation](../tests/agent/self-improvement/skill-consolidator.test.ts) |
| Evolution | [engine](../src/agent/self-improvement/evolution/evolution-engine.ts), [CLI](../src/commands/cli/evolve-command.ts) | [evolution](../tests/agent/self-improvement/evolution/evolution-engine.test.ts) |
| Council | [conductor](../src/council/conductor.ts), [scientific notes](research/council-scientific-notes.md) | `tests/council/` |
| Reasoning | [MCTS](../src/agent/reasoning/mcts.ts), [facade](../src/agent/reasoning/reasoning-facade.ts), [middleware](../src/agent/middleware/reasoning-middleware.ts) | `tests/agent/reasoning/` |

> **Review scope.** Source, command declarations and recorded fleet artifacts were inspected. No new runtime campaign was run for this editorial pass. Existing tests specify bounded cases. Text coverage and offline benchmark scores remain limited to their criteria; published research results are not Code Buddy measurements. A useful learning evaluation records the original task, baseline, changed artifact, actual execution, cost and held-out or regression cases. It also distinguishes a proposal from an accepted change and an accepted change from a benefit observed later.
