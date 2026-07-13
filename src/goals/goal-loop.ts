/**
 * After-turn goal driver — UI-agnostic port of Hermes'
 * `_maybe_continue_goal_after_turn`.
 *
 * Called by the interactive turn loop after each completed turn. Decides
 * whether to surface a status message and/or feed a continuation prompt
 * back into the session. Safe to call when no goal is set — returns fast.
 */

import { CodeBuddyClient } from '../codebuddy/client.js';
import { logger } from '../utils/logger.js';
import { decomposeGoal, shouldAutoDecomposeGoal } from './goal-decomposer.js';
import { judgeGoal } from './goal-judge.js';
import { GoalManager, getGoalManager, resolveGoalsConfig } from './goal-manager.js';
import type { GoalStatus, GoalVerdict } from './goal-state.js';
import { buildIntentGraph, intentCriterionIds } from './intent-graph.js';
import {
  ProofLedger,
  type CriterionProofResult,
  type ProofRecorder,
} from './proof-ledger.js';

export interface GoalTurnOutcome {
  /** User-visible status line (✓ / ⏸ / ↻) to append to chat history. */
  message?: string;
  /** When set, the caller should auto-submit this as the next user message. */
  continuationPrompt?: string;
  /**
   * Structured snapshot for host UIs (e.g. the Cowork goal banner). Mirrors the
   * post-decision GoalState so the renderer can show turn progress + verdict
   * without re-reading goal storage. Absent fields when no goal is active.
   */
  goalText?: string;
  goalId?: string;
  status?: GoalStatus;
  turnsUsed?: number;
  maxTurns?: number;
  lastVerdict?: GoalVerdict;
  lastReason?: string;
}

/**
 * Independent-verification bridge for dev-loop mode (`/loop`). Given the goal
 * and the turn's evidence, returns a fresh-context verdict. Only invoked when
 * the goal is `verifyGated` AND the judge is about to say "done" — so the extra
 * cost is bounded to the done boundary. Supplied by hosts that have the agent's
 * tool bridge (interactive TUI); absent elsewhere ⇒ judge-only fallback.
 */
export type GoalVerifyFn = (ctx: {
  goal: string;
  evidence: string;
  criteria?: Array<{ id: string; title: string }>;
}) => Promise<{
  verdict: 'CONFIRMED' | 'NEEDS REVIEW' | 'unverified';
  evidence?: string;
  criterionResults?: CriterionProofResult[];
}>;

export interface GoalAfterTurnOptions {
  client: CodeBuddyClient | null;
  /** The assistant's full response text for the turn that just finished. */
  lastResponse: string;
  /** True when the turn was user-interrupted (Esc). */
  interrupted: boolean;
  /** Optional goal-state key for host surfaces with their own session ids. */
  sessionKey?: string;
  /**
   * Optional independent Verifier for `/loop` (dev-loop) goals. When the goal
   * is `verifyGated` and the judge returns "done", this gates it: a non-CONFIRMED
   * verdict flips the turn back to "continue". No-op for classic `/goal` goals.
   */
  verify?: GoalVerifyFn;
  /** Test/embed seam. False disables the Code Buddy 2.0 Proof Ledger. */
  proofRecorder?: ProofRecorder | false;
}

// The executor appends a per-turn usage footer ("[tokens: … | cost: …]") as a
// final content chunk; strip it so the judge sees only substantive output.
const USAGE_FOOTER_RE = /\n?\[tokens: [^\]]*\]\s*$/;

export async function maybeContinueGoalAfterTurn(
  options: GoalAfterTurnOptions
): Promise<GoalTurnOutcome | null> {
  const manager = getGoalManager(options.sessionKey);
  if (!manager.isActive()) return null;

  // If the turn was user-interrupted, auto-pause instead of judging: the
  // judge would almost always say "continue" on the partial output and
  // immediately re-queue another turn — exactly what the user cancelled.
  if (options.interrupted) {
    try {
      manager.pause('user-interrupted (Esc)');
    } catch (error) {
      logger.debug('goal pause-on-interrupt failed', { error: String(error) });
    }
    return {
      message: '⏸ Goal paused — turn was interrupted. Use /goal resume to continue, or /goal clear to stop.',
      ...goalSnapshot(manager),
    };
  }

  const lastResponse = options.lastResponse.replace(USAGE_FOOTER_RE, '').trim();
  // No substantive reply (transient API failure, empty stream): skip judging
  // so we don't burn budget or trip the parse-failure counter.
  if (!lastResponse) return null;

  const config = resolveGoalsConfig();
  await maybeAttachGoalPlan(manager, options.client, config.plannerModel);
  const proofRecorder = options.proofRecorder === false
    ? null
    : options.proofRecorder
      ?? (manager.state?.verifyGated && process.env.NODE_ENV !== 'test'
        ? new ProofLedger(manager.state.goalId)
        : null);
  // Dev-loop gate (/loop): only when the goal is verifyGated AND a Verifier
  // bridge is supplied. Runs the independent Verifier only if the judge would
  // otherwise say "done", and downgrades a non-CONFIRMED "done" to "continue"
  // — a claimed-but-unproven goal never passes. Mirrors dev-loop.ts's gate.
  const verifyGate = manager.state?.verifyGated && options.verify;
  const intentGraph = manager.state ? buildIntentGraph(manager.state) : null;
  const criteria = intentGraph?.nodes
    .filter((node) => node.kind === 'criterion')
    .map((node) => ({ id: node.id, title: node.title })) ?? [];
  const verificationCapture: {
    result?: Awaited<ReturnType<GoalVerifyFn>>;
  } = {};
  const decision = await manager.evaluateAfterTurn(lastResponse, {
    judge: async params => {
      const base = await judgeGoal(options.client, {
        ...params,
        ...(config.judgeModel ? { model: config.judgeModel } : {}),
        maxTokens: config.judgeMaxTokens,
        timeoutMs: config.judgeTimeoutMs,
      });
      if (verifyGate && base.verdict === 'done') {
        let verdict: 'CONFIRMED' | 'NEEDS REVIEW' | 'unverified' = 'unverified';
        try {
          verificationCapture.result = await options.verify!({
            goal: manager.state!.goal,
            evidence: lastResponse,
            criteria,
          });
          verdict = verificationCapture.result.verdict;
        } catch (error) {
          logger.debug('goal verify gate failed (fail-open, treated as unverified)', { error: String(error) });
        }
        if (verdict !== 'CONFIRMED') {
          return {
            verdict: 'continue',
            reason: `🔎 verification not CONFIRMED (verifier=${verdict}); judge said done (${base.reason})`,
            parseFailed: false,
          };
        }
      }
      return base;
    },
  });

  if (decision.verdict === 'inactive') return null;

  const verifierResult = verificationCapture.result;
  if (verifierResult) {
    proofRecorder?.append({
      turn: manager.state?.turnsUsed ?? 0,
      kind: 'verification',
      status:
        verifierResult.verdict === 'CONFIRMED'
          ? 'pass'
          : verifierResult.verdict === 'NEEDS REVIEW'
            ? 'fail'
            : 'unknown',
      assurance: 'independent',
      summary: `Interactive Verifier returned ${verifierResult.verdict}.`,
      evidence: verifierResult.evidence ?? lastResponse,
      criterionIds: criteria.map((criterion) => criterion.id),
      criterionResults: verifierResult.criterionResults?.length
        ? verifierResult.criterionResults
        : criteria.map((criterion) => ({
            criterionId: criterion.id,
            status: verifierResult.verdict === 'CONFIRMED' ? 'passed' : 'unknown',
            evidence: verifierResult.verdict === 'CONFIRMED'
              ? 'Overall independent verifier confirmed every criterion.'
              : 'Verifier did not provide a granular criterion verdict.',
          })),
      sessionKey: manager.sessionKey,
      source: 'interactive-loop',
    });
  }

  if (manager.state?.verifyGated) {
    const criterionIds = decision.verdict === 'done'
      ? intentCriterionIds(buildIntentGraph(manager.state))
      : [];
    proofRecorder?.append({
      turn: manager.state.turnsUsed,
      kind: 'decision',
      status: decision.verdict === 'done' ? 'pass' : 'fail',
      assurance: verifierResult ? 'independent' : 'judge',
      summary: decision.reason,
      evidence: lastResponse,
      criterionIds,
      sessionKey: manager.sessionKey,
      source: 'interactive-loop',
    });
  }

  const outcome: GoalTurnOutcome = { ...goalSnapshot(manager) };
  if (decision.message) outcome.message = decision.message;
  if (decision.shouldContinue && decision.continuationPrompt) {
    outcome.continuationPrompt = decision.continuationPrompt;
  }
  return outcome;
}

/**
 * Structured per-session goal snapshot for host UIs. Reads the manager's
 * post-decision state; returns an empty object when no state is present so
 * spreading it is always safe.
 */
function goalSnapshot(manager: GoalManager): Partial<GoalTurnOutcome> {
  const s = manager.state;
  if (!s) return {};
  return {
    goalId: s.goalId,
    goalText: s.goal,
    status: s.status,
    turnsUsed: s.turnsUsed,
    maxTurns: s.maxTurns,
    ...(s.lastVerdict ? { lastVerdict: s.lastVerdict } : {}),
    ...(s.lastReason ? { lastReason: s.lastReason } : {}),
  };
}

async function maybeAttachGoalPlan(
  manager: GoalManager,
  client: CodeBuddyClient | null,
  model?: string
): Promise<void> {
  const state = manager.state;
  if (!state || state.goalPlan || state.goalPlanAttempted) return;
  if (!client || !shouldAutoDecomposeGoal(state.goal)) return;

  try {
    const plan = await decomposeGoal(state.goal, client, {
      ...(model ? { model } : {}),
    });
    if (plan) {
      manager.attachGoalPlan(plan);
    } else {
      manager.markGoalPlanAttempted('planner returned no usable task graph');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    manager.markGoalPlanAttempted(message);
    logger.debug('goal decomposition failed', { error: message });
  }
}
