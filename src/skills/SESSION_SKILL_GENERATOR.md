# Session Skill Generator

Turns a hard session into a reusable skill, automatically.

## When it fires

At session end, if the session crossed any of these thresholds:

- at least 8 tool calls, or
- at least 1 recovered error, or
- at least 2 files touched

## What it does

1. Builds a `SKILL.md` under `.codebuddy/skills/authored-<slug>/`.
2. Runs it through the security scanner (`scanSkillFile`). Critical findings block the install.
3. Registers it in the `SkillRegistry` (workspace tier) so it can auto-activate later.

## Usage

```ts
import { maybeGenerateFromSessionEnd } from './skills/session-skill-generator.js';

// inside your session-end hook:
maybeGenerateFromSessionEnd({
  toolCalls: 12,
  errorsRecovered: 2,
  filesTouched: ['src/a.ts', 'src/b.ts', 'tests/a.test.ts'],
  summary: 'Hardened the retry logic against transient network errors.',
}, 'retry-logic');
```

The generator is idempotent: running it twice with the same topic overwrites
the same `authored-` directory instead of creating duplicates.
