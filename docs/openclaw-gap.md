# OpenClaw gap — what we close, what we do not

OpenClaw is an always-on personal gateway. Code Buddy is a coding agent with a companion.
This note tracks the slice we can close without pretending to be a 390k-star product.

## Closed in this tree (2026-09-21)

- Companion channel history persists across daemon restarts (`src/companion/channel-history.ts`).
- Prompt assembly rereads that store when in-memory history is empty.
- Channel generation writes the turn back to the store.
- Companion impulses can be *delivered*, not only listed:
  `CODEBUDDY_COMPANION_IMPULSE_DELIVER=true` or `CODEBUDDY_COMPANION_PROACTIVE=true`.
  Quiet hours 22–08. Cooldown 6h. Telegram when configured. History remembers the outreach.
- OpenClaw workspace files (`SOUL.md`, `USER.md`, `MEMORY.md`, `HEARTBEAT.md`) can be read
  from `~/.openclaw/workspace` when `CODEBUDDY_OPENCLAW_WORKSPACE_IMPORT=true`.
  Lisa injects a short digest into the companion system prompt.
- Daemon heartbeat merges local `.codebuddy/HEARTBEAT.md` with the OpenClaw file,
  keeps only sections that are due now (matin / soir / weekday / `SCHEDULE: 0 7 * * 1`),
  and seeds a default local file on first tick unless `CODEBUDDY_HEARTBEAT_SEED=false`.
- `HeartbeatEngine.start()` arms companion always-on loops (`src/companion/companion-loops.ts`):
  impulse delivery always attempted; presence / proactive / idle only when their flags are on.
- Per-chat session helper: `runChannelCompanionTurn` + `channelCompanionSessionKey`.

See `docs/heartbeat.md` and `wiki/slash-commands/companion-loops.md`.

## Still OpenClaw's ground

- 20+ messaging surfaces and native mobile/desktop apps.
- ClawHub skill marketplace.
- One-command install used by hundreds of thousands of people.
- Remote runtime while the laptop sleeps (Daytona/Modal).
- Community size and release cadence.
- Wiring `runChannelCompanionTurn` inside the 2k-line `channel-handlers.ts`
  and the `__COMPANION_LOOPS__` slash token in `enhanced-command-handler.ts`.

Do not add a fifteenth half-wired channel to fake parity. Keep closing the companion loop
that already exists: memory, outreach, coding brain.
