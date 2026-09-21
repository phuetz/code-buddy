# Auto-skills & Living Memory

Two small additions that make Code Buddy feel like a companion that grows.

## 1. Session Skill Generator (`src/agent/self-improvement/session-skill-generator.ts`)

After a complex session — lots of tool calls, recovered errors, several files
touched — Code Buddy can automatically draft a reusable `SKILL.md` from the
transcript. The skill is safety-gated and installed as an `authored-*` skill, so
the next similar situation reuses the guide instead of re-learning from scratch.

```ts
import { generateSkillFromSession } from './session-skill-generator.js';

const result = await generateSkillFromSession(sessionTranscript);
// result.installed === true → .codebuddy/skills/authored-session-*/SKILL.md
```

Complexity is scored heuristically (tool calls, errors recovered, files touched,
decisions). Trivial sessions are ignored.

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

Both are opt-in in spirit: nothing runs unless you call them or wire them to a
session-end hook / cron job.
