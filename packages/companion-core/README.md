# @phuetz/companion-core

The relational core of an AI companion, extracted so two products can share one
implementation instead of two that drift.

Pure TypeScript. **No UI, no network, no filesystem, no host dependency.** Time,
randomness and storage are injected (`Clock`, `Rng`, `KeyValueStore`), so every
behaviour is deterministic under test and a host owns its own persistence.

## What is in it

| Module | What it owns |
| --- | --- |
| `persona` | Profiles as **data**, validated by Zod. A registry for multi-persona hosts. The built-in `copine` profile. |
| `relationship` | The numeric state: mood, drifting traits, tenure milestones, rapport tier. It **drifts, it never ratchets**. |
| `memory` | The « what matters » sheet: a dozen named facts with provenance, date and confidence. Soft forgetting, and a refusal to hold a clinical claim. |
| `initiative` | When a companion may write FIRST: a daily cap, a wall-clock window, one line per angle, silence on a warm thread, a 24 h stop. |
| `limits` | The output contract: no diagnosis, no guilt, no fear of missing out, nothing to unlock, and honesty about what it is when asked frankly. |

## What is deliberately NOT in it

No gamification of any kind — no XP, no streak, no affection bar, no tier to
farm. `rapportTier` shifts phrasing; it is not a score and is never spoken as a
number. No messaging, no voice synthesis, no camera, no billing, no images.

## Install

```bash
npm install @phuetz/companion-core
```

## Use

```ts
import {
  COPINE_PROFILE,
  applyLimitsContract,
  detectRelationalSignal,
  evolveRelationship,
  emptyRelationshipState,
  pickGreeting,
  planInitiative,
  resolveCivilClock,
  WhatMattersMemory,
} from '@phuetz/companion-core';

let state = emptyRelationshipState();
state = evolveRelationship(state, detectRelationalSignal('je galère un peu'));

const bonjour = pickGreeting(COPINE_PROFILE, 'morning');

const plan = planInitiative({
  state: { sent: [] },
  clock: resolveCivilClock(Date.now(), 'Europe/Paris'),
  profile: COPINE_PROFILE,
});

const verdict = applyLimitsContract(replyFromTheModel, { heard: whatTheUserSaid });
```

The full public API is documented at the top of `src/index.ts`, in fifteen lines.

## Licence

MIT.
