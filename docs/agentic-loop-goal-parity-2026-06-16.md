# Agentic loop + goal feature: Hermes Agent ↔ Code Buddy (2026-06-16)

<!-- showcase:historical -->
**Historical record — outside the current evidence catalogue, not revalidated here.** Counts and validation labels below describe the dated snapshot, not this candidate. For current statuses and reasons, see the root feature catalogue.

Comparative audit of **(a)** the core agentic loop and **(b)** the autonomous "goal" feature in
[Hermes Agent](https://github.com/) (`~/hermes-agent`, Python) vs Code Buddy (this repo, TS), plus the
improvements shipped from it. Companion to [`hermes-openclaw-parity.md`](./hermes-openclaw-parity.md).

## A. Agentic loop

| Concern | Hermes (`agent/conversation_loop.py`) | Code Buddy (`src/agent/execution/agent-executor.ts`) |
|---|---|---|
| Loop core | `run_conversation()` — turn = build context → API call → tool dispatch → repeat | `runTurnLoop` async generator (single source of truth) |
| Completion | implicit: assistant returns text with no tool_calls | implicit: `toolCalls.length === 0` OR `toolRounds >= maxToolRounds` (50 / 400 YOLO) |
| Budgets | `IterationBudget` (parent 90 / subagent 50) + grace call | `TurnLimitMiddleware` (10) + `CostLimitMiddleware` (20) |
| In-loop recovery | rich `error_classifier.py` (16 `FailoverReason`s): credential-pool rotation, eager provider fallback, length-truncation "please continue", empty-response/thinking-only re-prompt, compression→new session | **length-truncation continuation + post-tool empty-response re-prompt now ported** into `runTurnLoop` (`finish_reason==='length'` → bounded "continue" injection; empty-after-tools → bounded nudge; zero-new-token = give up; tool-call pairs never split). Plus `AutoRepairMiddleware` (150, advisory) + transcript-repair + `ContextManagerV2`. Still simpler than Hermes on credential/provider rotation. |
| Verification | **file-mutation verifier footer** (model can't claim a failed write succeeded) + `<verification>` block | `workflow-rules` Verification Contract (gated) + `VerificationEnforcementMiddleware` |
| Self-critique | **`background_review`** async fork (memory/skills) after the turn | — (out of scope; noted below) |
| Completion guidance | always-on `TASK_COMPLETION_GUIDANCE` | `## Execution discipline` block (ported 2026-06-16) |

**Verdict:** the loops are structurally equivalent on budgets, completion semantics, completion guidance,
and verification wiring. The previously-open **in-loop recovery** gap is now substantially closed:
`runTurnLoop` ports Hermes' *within-turn* length-truncation continuation and post-tool empty-response
re-prompt (config-bounded via `CODEBUDDY_MAX_LENGTH_CONTINUATIONS` / `CODEBUDDY_MAX_EMPTY_RETRIES`, with a
zero-new-token give-up rail so a too-small `num_ctx` isn't masked, and the recovery only fires in the
no-tool-calls branch so tool-call pairing / transcript-repair stay intact). Proven for real on a free
local Ollama model — a low output cap forces a genuine `finish_reason:'length'` truncation that the loop
continues to completion (`tests/agent/in-loop-recovery.real.test.ts`, no mocks). The remaining, smaller
delta vs Hermes is **provider/credential rotation** (eager fallback chain + credential-pool) — left as a
follow-up; Code Buddy still relies on middleware + the goal loop's cross-turn continuation there.

## B. Goal feature

Code Buddy **already ports** Hermes' goal system (`src/goals/`): a judge loop, persisted `GoalState`
(goal, status, turnsUsed/maxTurns, lastVerdict, subgoals), continuation prompts, parse-failure
auto-pause (3), and a default 20-turn budget — the same design as Hermes `hermes_cli/goals.py`. It is
wired into the CLI (`use-input-handler.ts`, `goal-cli.ts`) **and** into Cowork via the embedded engine
adapter (`src/desktop/codebuddy-engine-adapter.ts` loops `maybeContinueGoalAfterTurn`) with `/goal` and
`/subgoal` bridged in `cowork/src/main/commands/slash-command-bridge.ts`.

## Gaps found → fixes shipped (this session)

1. **Variation-injector fragmentation (bug).** `varySystemPrompt`/`extractBlocks`
   (`src/prompts/variation-injector.ts`) shuffled the prompt footer at the *bullet* level, interleaving
   foreign bullets (tool-param docs) into the middle of the `## Workflow Orchestration` Verification
   Contract. Found empirically. **Fix:** `extractBlocks` is now heading-atomic (`##`/`###` boundaries) —
   whole sections shuffle, never fragment. (`tests/prompts/variation-injector.real.test.ts`)
2. **`VerificationEnforcementMiddleware` defined but unwired.** **Fix:** registered (priority 155) in the
   default pipeline (`src/agent/codebuddy-agent.ts`). It nudges `task_verify` after ≥3 file changes.
   (`tests/agent/middleware/verification-enforcement-wiring.real.test.ts`)
3. **Goal judge trompable by failed mutations.** The judge saw tool evidence as text but not *failures*
   (and a `if (finalOutput)` guard hid no-output failures). **Fix:** a Hermes-style non-bracketed
   failure footer (`buildToolFailureFooter`), keyed on `!success` independent of output, appended last so
   the LLM judge can't mark a goal done over a failed write/patch.
   (`tests/desktop/goal-judge-failure-footer.real.test.ts`)
4. **Cowork didn't surface the goal loop.** It ran server-side but emitted only inline chat text.
   **Fix:** a structured `goal.status` event (goal-loop outcome → adapter `emitGoalSnapshot` → runner →
   `goal.status` ServerEvent → `useIPC` → store `goalStatesBySession`) drives a first-class `GoalBanner`
   (turn progress, verdict, Pause/Clear via the slash bridge). (`cowork/e2e/goal-banner.spec.ts`)

### Real verification — reproduced 2026-06-16 (all real / no-mock)

The claims below were each re-run from scratch; the earlier draft only proved *turn-0 emission*
(`turnsUsed:0`), not the loop. Evidence is in `docs/qa/code-buddy-studio/`.

**A. The Ralph loop itself — headless `buddy goal` on a free local Ollama actor+judge
(`qwen3.5-ctx32k`, $0):**

- *Multi-turn continuation + budget exhaustion* — a "increment `counter.txt` to 3, exactly one step per
  turn" goal drove `turnsUsed` **1→2→3→4→5→6**, a distinct real judge verdict each turn, continuation
  prompts fed back in-process, and a correct `⏸ paused 6/6` budget stop.
  (`goal-multiturn-ollama-run.log`)
- *Judge strictness / failure-footer (gap 3) working* — in a "create+verify `hello.txt`" run the judge
  **refused `done`** because the actor never surfaced a verified read-back, *even though the file had
  reached the target on disk*. A goal can't be marked done over unverified/failed tool work — exactly the
  intended conservatism. (`goal-strict-judge-budget-exhaust.log`)
- *Clean `done` path* — an answer-only goal produced `✓ Goal achieved … (exit 0)`.
  (`goal-done-verdict.log`)

**B. The Cowork emission + reducer chain — real IPC, no store shortcut:**

- *Runner mapping* `goal_status → goal.status` ServerEvent, incl. a multi-turn snapshot sequence
  (`turnsUsed` 0→1→2 ending `done`): `cowork/tests/runner-event-mapping.test.ts` (real `CodeBuddyEngineRunner`
  + event-source adapter; only electron/`core-loader` platform boundaries are stubbed — the mapping switch
  is the real code).
- *Renderer reducer* — `cowork/e2e/goal-banner.spec.ts` now drives a real `goal.status` event over the
  production `server-event` channel (`webContents.send`) → preload `ipcListener` → `useIPC`
  `case 'goal.status'` → store → `GoalBanner`. No `setGoalStatus` shortcut on that path.
- *Turn-0 emission* against the rebuilt embedded core (gpt-5.5, $0) remains proven via
  `cowork/pilot/_goal_run.mjs` → `goal-banner-real-run.png`.

**C. Discoverability ("bien utilisée")** — a first-class **Goal toggle** in the composer
(`data-testid="chat-goal-mode-toggle"`, `MessageComposer.tsx`) launches a standing goal through the
`/goal` command bridge (`ChatView.tsx`), and the `GoalBanner` then surfaces turn progress + the latest
verdict with Pause/Clear.

### Round 2 — closing the disclosed caveats (reach-100%)

5. **In-loop recovery (the open loop-parity gap) — ported.** `runTurnLoop` now continues a length-truncated
   answer and re-prompts a post-tool empty response, within the turn, bounded and abort-aware (see the
   "In-loop recovery" row above). `finish_reason` is threaded through `StreamingHandler` into
   `AccumulatedMessage`. **Real proof, no mocks:** a low `CODEBUDDY_MAX_TOKENS` cap on Ollama forces a real
   `finish_reason:'length'` truncation that recovery continues to completion — the continuation fired
   repeatedly and the output ran far past one capped generation (`tests/agent/in-loop-recovery.real.test.ts`).
   (Subtlety caught: vitest's `NODE_ENV=test` silences the logger — the child run is de-test-moded so the
   test env doesn't perturb the real behaviour it measures.) The post-tool empty-response re-prompt is
   implemented and regression-covered (executor suite) but, being hard to trigger deterministically with a
   real model, ships **OFF by default** (`CODEBUDDY_MAX_EMPTY_RETRIES=0`) — no untested-by-default behaviour
   in the hot loop; opt in by setting it `>0`. Only the length-continuation path (default 3) is on by
   default, and it is the one proven end-to-end with a real model.
   Update 2026-10-03: harness A-4B captured a completed native `done:stop` with 89 thinking
   tokens and no answer after 26 successful tools. That specific post-tool thinking-only
   case now gets one recovery by default; an explicit `CODEBUDDY_MAX_EMPTY_RETRIES=0`
   disables it. The instruction preserves the last human request and never replays
   completed tools. Repeated empty replies still fail. Truly empty replies remain opt-in.
6. **Desktop-adapter goal loop proven multi-turn *directly*** (was only "by composition"). A real
   `CodeBuddyEngineAdapter.runSession` drives a real Ollama actor + real Ollama judge against a goal that
   can't finish in a 2-turn budget; the captured `goal_status` events climb `turnsUsed` `0→1→2` and end
   `paused` (`tests/desktop/codebuddy-engine-adapter-goal-multi-turn.real.test.ts`, no mocks; slow,
   Ollama-gated).
7. **gpt-5.5 goal hang — could not reproduce across 7 real runs; every await in the path now bounded.**
   `DEBUG=1` re-runs of `buddy goal -m gpt-5.5` — 4 answer-only (6–7 s each, clean `done`) and 3 tool-using
   multi-turn (46–90 s, real `notes.txt` write+read-back, incl. one budget-exhaustion pause and two clean
   `done`) — all finished with the `[chatgpt-responses] POST` log firing within ~1.2 s and the largest
   inter-POST gap only ~16 s. The earlier 8-min stall did **not** recur and was a transient (Codex backend /
   one-off slow refresh), not a code regression. More importantly the path is now bounded end-to-end so an
   indefinite hang is no longer reachable: **auth token fetch 30 s** (`AbortSignal.timeout` added this session
   to the two previously-unbounded fetches in `src/providers/codex-oauth.ts`), **POST connect 60 s**
   (`CONNECT_TIMEOUT_MS`, pre-existing), **SSE idle 120 s** (`STREAM_IDLE_TIMEOUT_MS`, pre-existing). Any future
   stall surfaces as a clear bounded error instead of an 8-min hang.
8. **Runner-mapping test honesty.** Its header now states plainly that only platform boundaries
   (`electron`, `core-loader`) are stubbed — the mapping logic is real and the zero-mock `goal-banner.spec.ts`
   covers the same chain end-to-end.

Out of scope, noted for later: Hermes `background_review` async self-critique; provider credential-pool /
eager provider rotation; code-level `verifyCommand` execution inside the judge (gap 3 supplies the failure
signal; auto-running a verify command is a follow-up).
