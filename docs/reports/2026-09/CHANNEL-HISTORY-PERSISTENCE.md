# Companion channel history persistence

Landed in `src/companion/channel-history.ts` (commit on main, 2026-09-21).

## What it does

Lisa's last companion turns used to live in an in-memory `Map` inside `channel-handlers.ts`. A restart erased them. Telegram and Discord did not share a thread.

The new store:

- keys by person (`telegram:42` and `discord:42` collapse to `42`)
- writes `~/.codebuddy/companion/channel-history/<sha256>.json` (mode 0600)
- keeps 20 turns
- forgets a file after 7 idle days
- can be turned off with `CODEBUDDY_CHANNEL_HISTORY=false`

## Wiring still required in `channel-handlers.ts`

Replace the local Map with:

```ts
import {
  clearCompanionChannelHistoriesForTests,
  readCompanionChannelHistory,
  rememberCompanionChannelTurn as persistCompanionChannelTurn,
} from '../../companion/channel-history.js';
```

- `__resetChannelAIHandlerForTests` should call `clearCompanionChannelHistoriesForTests()`
- `rememberCompanionChannelTurn` should delegate to `persistCompanionChannelTurn`
- companion prompt history should read `readCompanionChannelHistory(sessionKey)`

The patched file is ready locally; the handler is too large to rewrite in one API call without a checkout.

## Tests

`tests/companion/channel-history.test.ts`
