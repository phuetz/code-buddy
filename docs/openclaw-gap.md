# OpenClaw gap — 2026-09-21

Closed on `main` this morning:

- Companion history + impulse delivery + heartbeat merge/seed.
- Per-chat session key now derived *inside* `runCompanionChannelTurn`
  (`channelCompanionSessionKey`) so the 2k-line `channel-handlers.ts` does not
  have to call `runChannelCompanionTurn` explicitly.
- Isolated workers + `/goal` evidence gate + proof ledger.
- `/companion-loops` token dispatched by `enhanced-command-handler.ts`.
- Extra catalog `src/commands/slash/extra-builtins.ts` + merge in
  `SlashCommandManager` (no rewrite of the 49k `builtin-commands.ts`).
- Cowork headless allowlist includes `__HEARTBEAT__` and `__COMPANION_LOOPS__`.

Still open:

- Remote runtime while the laptop sleeps (Daytona/Modal).
- Community size and release cadence.
- Splitting `channel-handlers.ts` / `enhanced-command-handler.ts` / `server/index.ts`.

Do not add a fifteenth half-wired channel to fake parity.
