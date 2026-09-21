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

## Still OpenClaw's ground

- 20+ messaging surfaces and native mobile/desktop apps.
- ClawHub skill marketplace.
- One-command install used by hundreds of thousands of people.
- Remote runtime while the laptop sleeps (Daytona/Modal).
- Community size and release cadence.

Do not add a fifteenth half-wired channel to fake parity. Keep closing the companion loop
that already exists: memory, outreach, coding brain.
