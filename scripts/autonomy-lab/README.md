# Autonomy lab — a real test set Code Buddy works on autonomously

This is a **real** end-to-end exercise of Code Buddy's autonomous fleet: the real
agent, the real task queue, real file edits, real verification — on **free local
Ollama models**, in a throwaway sandbox.

## What it proves

A small backlog of real coding tasks (`tasks.json`) is dropped on the fleet queue,
and the autonomous loop drives them to "done" with **no human in the loop**:

```
seed tasks → FleetAutonomousLoop.tick()
                ├─ nextClaimable()        (priority order, DAG deps, claim lease)
                ├─ chooseAutonomousModel() (free-first ladder; `high` → escalate)
                └─ executor:
                     ├─ spawn the REAL `buddy` agent headless in the sandbox,
                     │    pinned to the tier's model, `--permission-mode acceptEdits`
                     └─ run the task's self-verifying `*.check.mjs` → pass/fail gate
            complete (pass) or release for retry (fail)
```

Nothing is mocked: `src/fleet/colab-store.ts`, `src/daemon/autonomous-loop.ts`,
`src/agent/model-tier.ts`, and the real CLI agent (`src/index.ts`) all run.

## The task set (`tasks.json`)

| Task | Priority | Tier it routes to | DAG |
|------|----------|-------------------|-----|
| `t-slugify` | medium | local | — |
| `t-luhn` | **high** | **network (escalated)** | — |
| `t-slug-id` | medium | local | `dependsOn: [t-slugify]` |

Each task asks the agent to implement a stub `*.mjs` so its `*.check.mjs` exits 0.
The checks are **self-verifying** (a correct reference implementation is the oracle),
so any correct solution passes — the agent is not pinned to one coding style, and
the check files cannot be gamed by copying an expected literal.

## Run it

```bash
# Needs Ollama up with a tool-capable model (see "Model capability" below).
tsx scripts/autonomy-lab/run.ts
# Overrides:
CB_LAB_LOCAL_MODEL=qwen3.6:27b CB_LAB_NETWORK_MODEL=qwen3.6:35b-a3b-q4_K_M \
  OLLAMA_BASE_URL=http://localhost:11434/v1 tsx scripts/autonomy-lab/run.ts
```

It prints a per-task table (tier, model, status, check pass/fail) and exits 0 only
if every acceptance check passes. The sandbox lives under `$TMPDIR/cb-autonomy-lab/`
and is recreated each run — **this repo is never touched**.

## Model capability (important finding)

The autonomous loop drives the *real* agent, so the model must emit **structured
OpenAI tool calls** (to actually edit files), not just chat. Verified on this box
(Ollama / Vulkan):

- **qwen3.6 (MoE)** — emits real tool calls → completes the tasks. `model-tools.ts`
  now marks `qwen3*` as `supportsToolCalls: true`.
- **qwen2.5:7b** — emits the tool call as *text* (`write_file {…}`) instead of a
  structured call → the agent can't execute it. Left conservative
  (`supportsToolCalls: false`, chat-only). Use **qwen3+ for autonomous editing.**

This is why the lab defaults both tiers to qwen3.6. The "free-first then escalate"
ladder is still real: `medium` tasks take the local tier, `high` tasks escalate
(here both point at the same local endpoint, so it stays $0; point
`CB_LAB_NETWORK_MODEL` / `CODEBUDDY_NETWORK_MODELS` at a bigger or paid endpoint to
make the escalation a capability jump).

## Safety

- Agents run with `cwd` = an ephemeral sandbox copy; writes are confined there.
- Acceptance is a fixed `node <file>.check.mjs`; no model-chosen shell.
- Free: local Ollama, `$0`.
