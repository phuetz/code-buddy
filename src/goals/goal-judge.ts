/**
 * Goal judge — asks an auxiliary LLM whether the standing goal is satisfied
 * by the agent's last response.
 *
 * Deliberately fail-OPEN: any transport error, timeout, or missing client
 * returns "continue" so a broken judge never wedges progress — the turn
 * budget and the consecutive-parse-failures auto-pause are the backstops.
 *
 * `parseFailed` is true only when the judge call succeeded but its output was
 * unusable (empty or non-JSON). API/transport errors return false — they are
 * transient and must not count toward the parse-failure auto-pause.
 */

import { CodeBuddyClient } from '../codebuddy/client.js';
import { getCostTracker } from '../utils/cost-tracker.js';
import { parseJsonResponse } from '../utils/llm-retry.js';
import { logger } from '../utils/logger.js';
import {
  applyEvidenceGate,
  extractGoalEvidence,
  type GoalEvidenceFields,
} from './goal-evidence-gate.js';
import {
  DEFAULT_JUDGE_TIMEOUT_MS,
  GoalVerdict,
  JUDGE_GOAL_SNIPPET_CHARS,
  JUDGE_RESPONSE_SNIPPET_CHARS,
  JUDGE_SUBGOALS_SNIPPET_CHARS,
  JUDGE_SYSTEM_PROMPT,
  JUDGE_USER_PROMPT_TEMPLATE,
  JUDGE_USER_PROMPT_WITH_SUBGOALS_TEMPLATE,
  renderSubgoalsBlock,
  truncateText,
} from './goal-state.js';

export interface GoalJudgeResult extends GoalEvidenceFields {
  verdict: GoalVerdict;
  reason: string;
  parseFailed: boolean;
}

export interface GoalJudgeParams {
  goal: string;
  lastResponse: string;
  subgoals?: string[];
  /** Override the judge model (config `goals.judgeModel`). Empty → client default. */
  model?: string;
  /** Optional per-call cap for judge output. */
  maxTokens?: number;
  timeoutMs?: number;
  verifyGated?: boolean;
}

/** Signature used by GoalManager so tests can inject a fake judge. */
export type GoalJudgeFn = (params: GoalJudgeParams) => Promise<GoalJudgeResult>;

export async function judgeGoal(
  client: CodeBuddyClient | null,
  params: GoalJudgeParams
): Promise<GoalJudgeResult> {
  if (!params.goal.trim()) {
    return { verdict: 'skipped', reason: 'empty goal', parseFailed: false };
  }
  if (!params.lastResponse.trim()) {
    return { verdict: 'continue', reason: 'empty response (nothing to evaluate)', parseFailed: false };
  }
  if (!client) {
    return { verdict: 'continue', reason: 'no judge client available', parseFailed: false };
  }

  const prompt = buildJudgeUserPrompt(params);
  const timeoutMs = params.timeoutMs ?? DEFAULT_JUDGE_TIMEOUT_MS;

  let raw = '';
  try {
    const response = await withTimeout(
      client.chat(
        [
          { role: 'system', content: JUDGE_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        [],
        {
          ...(params.model ? { model: params.model } : {}),
          ...(params.maxTokens ? { maxTokens: params.maxTokens } : {}),
          temperature: 0,
        }
      ),
      timeoutMs
    );
    raw = response?.choices?.[0]?.message?.content ?? '';
    recordJudgeCost(client, params.model, response?.usage);
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    logger.info('goal judge: API call failed — falling through to continue', {
      error: String(error),
    });
    return { verdict: 'continue', reason: `judge error: ${name}`, parseFailed: false };
  }

  const result = parseJudgeResponse(raw, { verifyGated: params.verifyGated });
  logger.info('goal judge: verdict', {
    verdict: result.verdict,
    reason: truncateText(result.reason, 120),
  });
  return result;
}

export function buildJudgeUserPrompt(params: GoalJudgeParams): string {
  const cleanSubgoals = (params.subgoals ?? []).map(s => s.trim()).filter(Boolean);
  const currentTime = new Date().toString();
  const goal = truncateText(params.goal, JUDGE_GOAL_SNIPPET_CHARS);
  const response = truncateText(params.lastResponse, JUDGE_RESPONSE_SNIPPET_CHARS);
  if (cleanSubgoals.length) {
    return JUDGE_USER_PROMPT_WITH_SUBGOALS_TEMPLATE.replace('{goal}', goal)
      .replace('{subgoals_block}', truncateText(renderSubgoalsBlock(cleanSubgoals), JUDGE_SUBGOALS_SNIPPET_CHARS))
      .replace('{response}', response)
      .replace('{current_time}', currentTime);
  }
  return JUDGE_USER_PROMPT_TEMPLATE.replace('{goal}', goal)
    .replace('{response}', response)
    .replace('{current_time}', currentTime);
}

/**
 * Parse the judge's reply. Fail-open: anything unusable reads as "continue"
 * with `parseFailed: true` so callers can auto-pause after N strikes.
 */
export function parseJudgeResponse(
  raw: string,
  options: { verifyGated?: boolean; env?: NodeJS.ProcessEnv } = {},
): GoalJudgeResult {
  if (!raw || !raw.trim()) {
    return { verdict: 'continue', reason: 'judge returned empty response', parseFailed: true };
  }

  let data: unknown;
  try {
    data = parseJsonResponse(raw);
  } catch {
    return {
      verdict: 'continue',
      reason: `judge reply was not JSON: ${truncateText(raw, 200)}`,
      parseFailed: true,
    };
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      verdict: 'continue',
      reason: `judge reply was not JSON: ${truncateText(raw, 200)}`,
      parseFailed: true,
    };
  }

  const record = data as Record<string, unknown>;
  const parsedDone = parseDoneField(record.done);
  if (!parsedDone.ok) {
    return {
      verdict: 'continue',
      reason: `judge reply had invalid done field: ${truncateText(raw, 200)}`,
      parseFailed: true,
    };
  }
  const reason = String(record.reason ?? '').trim() || 'no reason provided';
  const fields = extractGoalEvidence(record);
  return applyEvidenceGate(
    {
      verdict: parsedDone.done ? 'done' : 'continue',
      reason,
      parseFailed: false,
      ...fields,
    },
    options,
  );
}

function parseDoneField(value: unknown): { ok: true; done: boolean } | { ok: false } {
  if (typeof value === 'boolean') return { ok: true, done: value };
  if (typeof value === 'number') {
    if (value === 1) return { ok: true, done: true };
    if (value === 0) return { ok: true, done: false };
    return { ok: false };
  }
  if (typeof value !== 'string') return { ok: false };
  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', '1', 'done'].includes(normalized)) {
    return { ok: true, done: true };
  }
  if (['false', 'no', '0', 'continue', 'not_done', 'not done'].includes(normalized)) {
    return { ok: true, done: false };
  }
  return { ok: false };
}

function recordJudgeCost(
  client: CodeBuddyClient,
  modelOverride: string | undefined,
  usage: { prompt_tokens?: number; completion_tokens?: number } | undefined
): void {
  if (!usage) return;
  try {
    const model = modelOverride || client.getCurrentModel?.() || 'unknown';
    getCostTracker().recordUsage(usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0, model);
  } catch (error) {
    logger.debug('goal judge: cost recording failed', { error: String(error) });
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`goal judge timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
