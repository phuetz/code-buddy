import { codeBuddyEnv } from '../config/legacy-env.js';
/**
 * Goal-mode for fleet colab tasks — port of Hermes Agent's kanban goal-mode.
 *
 * A task with `goalMode: true` is not completed on the worker's first
 * successful attempt: an LLM judge checks the task's title/description (with
 * `acceptanceCriteria` as strict numbered criteria) against the worker's
 * output. "Continue" re-opens the task with a continuation nudge so the next
 * tick keeps going; once `goalMaxTurns` is spent the task is BLOCKED for
 * human review instead of spinning (Hermes' "block instead of loop" rule).
 *
 * The judge is fail-open (judgeGoal semantics): a broken judge yields
 * "continue", and the turn budget is the backstop.
 */

import { CodeBuddyClient } from '../codebuddy/client.js';
import type { ColabTask } from '../fleet/colab-store.js';
import { resolveGoalJudgeClient } from '../goals/goal-judge-client.js';
import { GoalJudgeResult, judgeGoal } from '../goals/goal-judge.js';
import { resolveGoalsConfig } from '../goals/goal-manager.js';
import type { AutonomousModelChoice } from '../agent/model-tier.js';
import { logger } from '../utils/logger.js';
import type { TaskExecutionResult } from './autonomous-loop.js';

/**
 * Conservative default for unattended subprocess loops (Hermes' kanban
 * example uses 7; interactive /goal uses 20).
 */
export const DEFAULT_COLAB_GOAL_MAX_TURNS = 5;

export type ColabGoalJudge = (
  task: ColabTask,
  result: TaskExecutionResult,
  model: AutonomousModelChoice
) => Promise<GoalJudgeResult>;

/** The goal text the judge evaluates: title + description. */
export function goalTextForTask(task: Pick<ColabTask, 'title' | 'description'>): string {
  return `${task.title}\n\n${task.description ?? ''}`.trim();
}

/**
 * Continuation nudge fed to the worker on later goal-mode turns (port of
 * Hermes' KANBAN_GOAL_CONTINUATION_TEMPLATE, adapted to the colab lifecycle:
 * completion is decided by the loop's judge, so the worker is nudged to
 * finish and state the outcome explicitly).
 */
export function buildColabGoalContinuationPrompt(task: ColabTask): string {
  const criteria = task.acceptanceCriteria?.length
    ? `\nAcceptance criteria (ALL must be satisfied):\n${task.acceptanceCriteria
        .map((text, i) => `- ${i + 1}. ${text}`)
        .join('\n')}\n`
    : '';
  const lastReason = task.goalLastReason ? `\nJudge's last verdict: ${task.goalLastReason}\n` : '';
  return (
    '[Continuing toward this fleet task — the judge says it is not done yet]\n' +
    `Task: ${goalTextForTask(task)}\n` +
    criteria +
    lastReason +
    '\nFinish the remaining work. When everything is done, state completion ' +
    'explicitly with evidence (file contents, command output). If you are ' +
    'blocked, state the blocker clearly.'
  );
}

/**
 * Default judge: a one-shot call on the same tier model the worker ran on
 * (local tiers stay free), overridable via `goals.judgeModel`. Task
 * `acceptanceCriteria` become strict numbered criteria for the judge.
 */
export function createColabGoalJudge(): ColabGoalJudge {
  return async (task, result, model) => {
    try {
      const config = resolveGoalsConfig();
      const apiKey = codeBuddyEnv('API_KEY') || process.env.OPENAI_API_KEY || 'local';
      const baseClient = new CodeBuddyClient(
        apiKey,
        model.model,
        model.baseUrl
      );
      const client = await resolveGoalJudgeClient(baseClient, config.judgeModel, {
        apiKey,
        ...(model.baseUrl ? { baseURL: model.baseUrl } : {}),
        providerLabel: model.baseUrl?.includes(':11434') ? 'ollama' : model.tier,
      });
      return await judgeGoal(client, {
        goal: goalTextForTask(task),
        lastResponse: result.output || result.summary,
        ...(task.acceptanceCriteria?.length ? { subgoals: task.acceptanceCriteria } : {}),
        ...(config.judgeModel ? { model: config.judgeModel } : {}),
        maxTokens: config.judgeMaxTokens,
        timeoutMs: config.judgeTimeoutMs,
      });
    } catch (error) {
      // Fail-open, like judgeGoal itself: never wedge the loop on judge setup.
      logger.debug('colab goal judge: setup failed — continue', { error: String(error) });
      return { verdict: 'continue', reason: `judge setup error: ${String(error)}`, parseFailed: false };
    }
  };
}
