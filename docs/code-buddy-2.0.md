# Code Buddy 2.0 — Intent Graph and Proof Ledger

Code Buddy 2.0 starts with one invariant: a completed agent task must preserve
both the user’s intent and the evidence that justifies completion.

## First vertical slice

The existing `/loop` pipeline remains the orchestrator. This increment adds two
readable projections around it instead of creating a second agent loop:

```text
Goal + GoalPlan + /subgoal
            │
            ▼
       Intent Graph ──────── stable mission id + criteria + dependencies
            │
     /loop execution
            │
            ├── structural verifier
            ├── independent verifier
            └── goal judge
                    │
                    ▼
              Proof Ledger ─ append-only, secret-redacted JSONL
```

### Intent Graph

Every new goal receives a stable `goalId`. `buildIntentGraph()` deterministically
turns the durable `GoalState` into objective, task and criterion nodes connected
by `contains`, `depends_on` and `verified_by` edges. The graph is a view, not a
second persistence format, so Cowork, Fleet and the CLI cannot drift away from
the goal engine.

Legacy goals receive a deterministic migration id derived from their creation
time and objective. No manual migration is required.

### Proof Ledger

Verifier and judge outcomes are written to
`~/.codebuddy/proofs/<goalId>.jsonl` (or the corresponding `CODEBUDDY_HOME`).
Each record includes:

- turn, source and proof kind;
- pass/fail/unknown status;
- assurance level (`deterministic`, `independent`, `judge` or `none`);
- bounded evidence and affected artifacts;
- the criterion ids covered by a successful final decision;
- automatic secret redaction count.
- a SHA-256 link to the previous record and its own record hash.

Malformed/torn JSONL lines are ignored when reading, and one failed ledger write
never blocks the development loop.

Workspace-owned reports, screenshots, traces and benchmarks are represented by
content-addressed references (`sha256`, relative path, media type and byte
size). Absolute host paths and duplicate file contents are not persisted.

### Criterion progress

The Verifier receives stable criterion ids and can return a final
`CRITERIA_JSON` line. `deriveIntentProgress()` folds those granular verdicts
over the append-only ledger, so one criterion can be proven while another is
failed or still inconclusive. A later inconclusive run cannot erase an earlier
conclusive result.

## Inspecting the current mission

```bash
buddy intent
buddy intent graph --json
buddy intent proofs
buddy intent proofs --limit 20 --json
buddy intent progress [--json]
buddy intent integrity [--json]
buddy intent outcomes [--json]
buddy intent constitution [--json]
buddy intent exchange [--json]
buddy intent shadows [--json]
```

`buddy intent` is read-only. Goals remain controlled through `buddy loop`,
`/loop`, `/subgoal`, pause/resume and clear.

## Counterfactual Forge

Counterfactual Forge compares competing strategies without allowing them to
change the success contract. Every branch captures the current
`contractRevision`, then scores only proofs attached to the same goal and
criteria. Coverage, assurance, quality, latency, cost and regressions feed a
bounded deterministic score. A branch is eligible only with 100% criterion
coverage, no failed criterion and no declared regression.

```bash
buddy forge create "Pocket local" \
  --hypothesis "Local streaming reduces first-audio latency" \
  --strategy "Pocket TTS with sentence chunking"
buddy forge evaluate <branch-id> --quality 0.94 --latency-ms 468 --cost-usd 0
buddy forge compare [--json]
buddy forge select [branch-id]
```

## Proven Outcome Memory

When `/loop` finishes with deterministic or independent passing proof and full
criterion coverage, it appends a compact outcome to
`~/.codebuddy/outcomes/proven-outcomes.jsonl`. The outcome retains proof hashes,
content-addressed artifacts, trust score and intent revision. It then creates a
pending lesson candidate with outcome provenance. It never writes
`lessons.md`: human approval remains the only promotion path.

## Sovereign Execution Layer

Code Buddy 2.0 adds a pre-execution settlement layer in front of
Counterfactual Forge:

```text
Intent contract
      │
      ▼
Autonomy Constitution ── privacy / cost / latency / risk / reversibility
      │
      ▼
Mission Exchange ─────── model and Fleet bids on one immutable revision
      │
      ▼
Shadow Twin ──────────── predicted versus measured quality/latency/cost
      │
      ▼
Settlement gates ────── constitution + shadow + proof plan + rollback
      │
      ▼
Forge branch ────────── normal `/loop` execution and proof settlement
```

### Autonomy Constitution

The constitution is mission-scoped and append-only. It can restrict privacy,
maximum cost, maximum p95 latency, risk, approval and reversibility. It never
grants a tool permission and cannot bypass `ConfirmationService`.

```bash
buddy exchange constitution \
  --privacy private-peers \
  --budget-usd 2 \
  --latency-ms 800 \
  --require-reversible \
  --approval on-risk \
  --max-risk high
```

### Mission Exchange and Pareto ranking

Models and Fleet peers submit explicit predictions and a proof plan. Ranking
maximizes quality while minimizing latency and cost. A bid is marked Pareto
only when no other policy-compatible bid is at least as good on all three
axes and strictly better on one.

```bash
buddy exchange bid "Fleet hybride" \
  --provider fleet --model two-peers \
  --strategy "Two peers with local synthesis" \
  --hypothesis "Two peers avoid one failure point" \
  --evidence-plan "Measure every acceptance criterion" \
  --quality 0.94 --latency-ms 520 --cost-usd 0.04 \
  --privacy private --risk high
buddy exchange rank [--json]
```

Fleet peers can discover the active contract with
`peer.mission-exchange.describe`. Inbound `peer.mission-exchange.offer` is
fail-closed unless `CODEBUDDY_PEER_EXCHANGE_ALLOW_BIDS=1` is set on the
receiving peer. The remote peer must echo the exact goal and intent revision;
the bridge never exposes the objective text.

### Shadow Twin and settlement

Shadow observations are never synthesized. Quality, latency, cost, checkpoint,
rollback and persistent-side-effect results must be recorded explicitly. A
weighted prediction-drift score and all reversibility checks determine pass or
fail. Awarding a ready bid creates a normal Forge branch.

```bash
buddy exchange rehearse <bid-id> \
  --quality 0.90 --latency-ms 542 --cost-usd 0.04 \
  --checkpoint --rollback --no-persistent-side-effects
buddy exchange award <bid-id> --approve
```

## Mission Control in Cowork

Cowork exposes the same read-only mission contract in **Mission Control →
Intention vérifiable**. The panel follows the active Cowork session and shows:

- the standing objective, stable contract revision and per-criterion progress;
- interactive Counterfactual Forge creation, evaluation and winner selection;
- proof-chain integrity, raw evidence and content-addressed artifacts;
- the evidence timeline and proven-outcome/human-review route.
- a five-tab sovereign workspace: Mission, Exchange, Shadow, Constitution and Capsules;
- editable policy constraints, live Pareto offers, measured rehearsal drift,
  assumption support and the four settlement gates;
- explicit award/reject actions, with an award materialized as a Forge branch.

## Outcome Capsules

The 2026 benchmark showed a clear convergence: Cursor exposes remote background
agents, Devin combines managed parallel sessions with playbooks and knowledge,
GitHub Copilot supports custom agents/skills/MCP, and the Codex app combines
parallel worktrees, skills and scheduled automations. Code Buddy's differentiator
is therefore not another background-agent queue. It compiles **proof-backed
outcomes into portable capabilities**.

An Outcome Capsule captures:

- the proven outcome and content-addressed proof/artifact hashes;
- the exact autonomy Constitution revision;
- a typed parameter contract;
- passing Shadow Twin attestations from distinct provider/model runtimes;
- a portability gate (two runtimes minimum) and explicit human activation.

```bash
buddy capsule list [--json]
buddy capsule create --title "Realtime voice" --required-runtimes 2
buddy capsule activate <capsule-id> --approve
buddy capsule revoke <capsule-id>
```

A capsule is not a permission bundle and never executes on its own. Normal tool
permissions, write policy and loop proof gates apply to every future replay.
Revocation is terminal. Secret-like material is rejected during compilation.

Benchmark sources:

- [Cursor Background Agents](https://docs.cursor.com/background-agent)
- [Devin Advanced Capabilities](https://docs.devin.ai/work-with-devin/advanced-capabilities)
- [GitHub Copilot custom agents](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/copilot-cli/use-copilot-cli/invoke-custom-agents)
- [OpenAI Codex app](https://openai.com/index/introducing-the-codex-app/)

When no chat session is active, Mission Control shows the latest local mission.
The renderer never reads the filesystem directly: a typed main-process IPC
bridge projects `GoalState` and tails the matching ledgers. Proof and outcome
inspection remains read-only; explicit Forge buttons append branch events.

The production visual reference is
[`docs/designs/code-buddy-2-mission-control-concept.png`](designs/code-buddy-2-mission-control-concept.png).
The Sovereign Execution reference is
[`docs/designs/code-buddy-2-sovereign-exchange-concept.png`](designs/code-buddy-2-sovereign-exchange-concept.png).

## Safety properties

- Evidence is redacted before persistence and clipped to a bounded size.
- Goal ids are path-safe; a malformed id cannot escape the proof directory.
- The ledger is audit data and never grants permissions.
- A modified chained record is reported as broken by `buddy intent integrity`.
- Counterfactual selection fails closed until every criterion is proven.
- Mission Exchange inbound Fleet writes are disabled unless explicitly enabled.
- Remote offers must match the exact intent revision and do not receive the
  mission objective text.
- Shadow Twin does not execute or fabricate measurements; it records observed
  metrics and rollback checks supplied by the rehearsal runner.
- Exchange award fails closed until constitution, shadow, proof-plan and
  reversibility gates all pass.
- Proven outcomes require strong proof; lesson promotion still requires review.
- Outcome Capsules require proof hashes, matching Constitution revision, two
  passing runtime attestations and explicit human activation.
- `/loop` keeps its existing budget, structural gate, independent Verifier and
  judge semantics.
- Tests can inject or disable a proof recorder without touching user storage.
