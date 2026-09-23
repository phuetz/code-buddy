# Hermes gaps closed 2026-09-21

The July parity doc (`docs/hermes-openclaw-parity.md`) is still the audit against Hermes v2026.7.1.
This note covers the slice implemented after the September Hermes drift (Judgment evidence + swarm scale).

## Closed here

- **Evidence gate** — `CODEBUDDY_GOAL_EVIDENCE=true` or `GoalState.verifyGated`.
  `parseJudgeResponse` reads `evidence` / `artifacts` / `criteria` and downgrades bare `done`.
  Each turn is appended to `ProofLedger` (`src/goals/record-goal-proof.ts`).
- **Isolated workers** — `runIsolatedWorkers()` caps concurrency (`CODEBUDDY_ISOLATED_WORKERS`, default 4, max 32)
  and gives each job its own `sessionKey`. Not 218 Hermes subagents.

## Still not copied (on purpose)

- Auto-written skills without review.
- Modal / Daytona / Vercel Sandbox accounts.
- Desktop Pantheon / Herald voice stack.
- 200 concurrent process workers.
