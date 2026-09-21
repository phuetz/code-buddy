# OpenClaw gap — 2026-09-21

Closed on `main` this morning:

- Companion history + impulse delivery + heartbeat merge/seed.
- Per-chat session key now derived *inside* `runCompanionChannelTurn`
  (`channelCompanionSessionKey`) so the 2k-line `channel-handlers.ts` does not
  have to call `runChannelCompanionTurn` explicitly.
- Isolated workers + `/goal` evidence gate + proof ledger.

Still open:

- Remote runtime while the laptop sleeps (Daytona/Modal).
- Community size and release cadence.
- Mapping `/companion-loops` → `__COMPANION_LOOPS__` in
  `enhanced-command-handler.ts` + `builtin-commands.ts` (handler already exists).
- Splitting `channel-handlers.ts` / `enhanced-command-handler.ts` / `server/index.ts`.

Do not add a fifteenth half-wired channel to fake parity.
