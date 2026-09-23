# Auto-skills & Living Memory

Two small additions that make Code Buddy feel like a companion that grows.

## 1. Session Skill Generator (`src/skills/session-skill-generator.ts`)

After a complex session — lots of tool calls, recovered errors, several files
touched — Code Buddy can automatically draft a reusable `SKILL.md` from the
transcript. The skill is safety-gated and installed as an `authored-*` skill, so
the next similar situation reuses the guide instead of re-learning from scratch.

```ts
import { generateSessionSkill, maybeGenerateFromSessionEnd } from './session-skill-generator.js';

const result = generateSessionSkill({ metrics });
// result -> .codebuddy/skills/authored-<slug>/SKILL.md
```

Complexity is scored heuristically (tool calls, errors recovered, files touched).
Trivial sessions are ignored. The generator is now wired into the session-end
lifecycle hook and the cron job, so it fires automatically when metrics cross
the thresholds.

## 2. Memory Reviver (`src/memory/memory-reviver.ts`)

The existing memory layer was rich but under-used: `CODEBUDDY_MEMORY.md` stayed a
skeleton and per-agent `MEMORY.md` files filled up with `done` placeholders.

`reviveMemory()` cleans those files, promotes real facts into the global memory,
and writes a compact `memory_summary.md` for prompt injection. Idempotent — safe
to run after every session or on a cron tick.

```ts
import { reviveMemory } from './memory-reviver.js';
reviveMemory();
```

## 3. Session Metrics Tracker (`src/memory/session-metrics-tracker.ts`)

Fills the `SESSION_METRICS` env var that the session-end cron hook reads.
Without it, the skill generator always saw zeros and never fired.

- `beginSession()` — called by the lifecycle `beforeExecute` hook.
- `recordToolCall()` / `recordRecoveredError()` — called by `recordToolMetric`
  in the tool-hooks after every tool execution.
- `recordFileTouched()` — called when a tool result is persisted.
- `endSession()` + `setSessionSummary()` — called by the lifecycle
  `sessionEnd` hook, which also runs `reviveMemory()` and
  `maybeGenerateFromSessionEnd()` directly.

Both the lifecycle hook and the cron step are safe to re-run. Nothing runs
unless a session actually starts.
