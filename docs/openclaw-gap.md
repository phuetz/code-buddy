# OpenClaw gap — 2026-09-21

Closed on `main` this morning:

- Companion history + impulse delivery + heartbeat merge/seed.
- Per-chat session key now derived *inside* `runCompanionChannelTurn`
  (`channelCompanionSessionKey`) so the 2k-line `channel-handlers.ts` does not
  have to call `runChannelCompanionTurn` explicitly.
- Isolated workers + `/goal` evidence gate + proof ledger.
- `/companion-loops` token is dispatched by `enhanced-command-handler.ts`.
- Extra catalog `src/commands/slash/extra-builtins.ts` registers the slash
  name without rewriting the 49k `builtin-commands.ts`.

Still open:

- Remote runtime while the laptop sleeps (Daytona/Modal).
- Community size and release cadence.
- `SlashCommandManager` must merge `extraBuiltinCommands` (see follow-up if
  `slash-commands.ts` is not yet patched).
- Splitting `channel-handlers.ts` / `enhanced-command-handler.ts` / `server/index.ts`.

Do not add a fifteenth half-wired channel to fake parity.
