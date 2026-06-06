/**
 * Background review agent (S4) — Hermes-style post-session self-learning pass.
 *
 * After a session, Hermes forks a child agent that inherits the parent runtime
 * but is RESTRICTED to memory + skill management tools, and is BIASED TOWARD
 * ACTION ("most sessions produce at least one skill update"). It writes memory
 * and skills directly. This module is the native Code Buddy equivalent: a small
 * one-shot headless tool loop (NOT a full `CodeBuddyAgent`, to avoid re-entering
 * `runTurnLoop` and recursing) whose tool array is filtered to the allowed set
 * BEFORE the model ever sees it, with a second execution-time allowlist as
 * defense in depth.
 *
 * Recursion safety: the run stamps `CODEBUDDY_BACKGROUND_REVIEW=1` for its whole
 * duration and no-ops if that sentinel is already set, so a review can never
 * trigger another review (and neither can any agent the paired gate spawns).
 *
 * @module agent/learning/background-review-agent
 */

import { logger } from '../../utils/logger.js';
import { executeToolHeadless, type HeadlessToolResult } from '../../cloud/headless-tool-executor.js';

/** The only tools a background review may use. */
export const BACKGROUND_REVIEW_ALLOWED_TOOLS = [
  'remember',
  'recall',
  'skills_list',
  'skill_view',
  'skill_manage',
] as const;

/** Env sentinel stamped for the duration of a review (anti-recursion). */
export const BACKGROUND_REVIEW_SENTINEL_ENV = 'CODEBUDDY_BACKGROUND_REVIEW';

export type BackgroundReviewMode = 'memory' | 'skill' | 'combined';

export interface ReviewChatMessage {
  role: string;
  content?: string | null;
  tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
  tool_call_id?: string;
}

export interface ReviewChatResponse {
  choices?: Array<{ message: ReviewChatMessage }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Minimal client surface — production passes the parent CodeBuddyClient. */
export interface BackgroundReviewClient {
  chat(
    messages: ReviewChatMessage[],
    tools: unknown[],
    options?: Record<string, unknown>,
  ): Promise<ReviewChatResponse>;
  getCurrentModel?(): string;
}

export interface ReviewTranscriptEntry {
  role: string;
  content: string;
}

export interface RunBackgroundReviewOptions {
  client: BackgroundReviewClient;
  transcript: ReviewTranscriptEntry[];
  mode: BackgroundReviewMode;
  workDir?: string;
  model?: string;
  maxRounds?: number;
  abortSignal?: AbortSignal;
  /** Tool definitions to filter. Defaults to `getAllCodeBuddyTools()`. */
  tools?: Array<{ function?: { name?: string } }>;
  /** Tool executor. Defaults to the headless executor. Injected in tests. */
  executeTool?: (
    toolName: string,
    argsJson: string | undefined,
    signal?: AbortSignal,
  ) => Promise<HeadlessToolResult>;
  /** Override the allowed tool set (defaults to BACKGROUND_REVIEW_ALLOWED_TOOLS). */
  allowedTools?: readonly string[];
}

export interface BackgroundReviewResult {
  skipped: boolean;
  reason?: string;
  rounds: number;
  /** Tool calls the model issued that were permitted and executed. */
  toolCallsMade: Array<{ name: string; success: boolean }>;
  /** Tool names the model issued that were NOT permitted (blocked, not run). */
  blockedToolAttempts: string[];
  /** Compact, user-facing action summary (Hermes 💾 style). */
  summary: string;
}

const DEFAULT_MAX_ROUNDS = 4;
const SYSTEM_PROMPT = [
  'You are the background review pass of a coding agent. The session just ended.',
  'You may ONLY use memory and skill tools. You cannot edit code, run commands, or browse.',
  'Be ACTIVE: most sessions produce at least one durable learning. A pass that does nothing is a missed opportunity — but never invent learnings that are not supported by the transcript.',
  '',
  'Skill materialization, in strict preference order:',
  '1. PATCH a currently-relevant skill if one covers the learning (skill_manage action=patch/edit).',
  '2. UPDATE an existing umbrella skill (skills_list/skill_view to find it, then patch).',
  '3. ADD a support file under an existing umbrella (skill_manage action=write_file): references/<topic>.md, templates/<name>.<ext>, or scripts/<name>.py for re-runnable actions.',
  '4. CREATE a new class-level umbrella skill only when no existing skill covers the class. Name it at the CLASS level, never a one-off (no PR numbers, error strings, or session artifacts).',
  '',
  'NEVER capture (anti-patterns):',
  '- Transient or environment-dependent failures (missing binaries, fresh-install errors, unconfigured credentials).',
  '- Negative claims like "tool X does not work" — these harden into self-cited refusals.',
  '- One-off task narratives with no class-level generalization.',
  'Memory = who the user is and the state of operations. Skills = how to do this class of task for this user.',
].join('\n');

/**
 * Run one background review pass. Returns the actions taken. Always safe to call
 * unconditionally: it no-ops if a review is already in progress (sentinel set).
 */
export async function runBackgroundReview(
  options: RunBackgroundReviewOptions,
): Promise<BackgroundReviewResult> {
  const empty: BackgroundReviewResult = {
    skipped: true,
    rounds: 0,
    toolCallsMade: [],
    blockedToolAttempts: [],
    summary: '',
  };

  if (process.env[BACKGROUND_REVIEW_SENTINEL_ENV] === '1') {
    return { ...empty, reason: 'nested review suppressed (sentinel set)' };
  }
  if (options.abortSignal?.aborted) {
    return { ...empty, reason: 'aborted before start' };
  }

  const allowed = new Set<string>(options.allowedTools ?? BACKGROUND_REVIEW_ALLOWED_TOOLS);
  const executeTool = options.executeTool ?? executeToolHeadless;
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const model = options.model ?? options.client.getCurrentModel?.();

  const allTools = options.tools ?? (await loadAllTools());
  const tools = allTools.filter((tool) => allowed.has(tool.function?.name ?? ''));

  const messages: ReviewChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildReviewPrompt(options.mode, options.transcript) },
  ];

  const toolCallsMade: Array<{ name: string; success: boolean }> = [];
  const blockedToolAttempts: string[] = [];

  const priorSentinel = process.env[BACKGROUND_REVIEW_SENTINEL_ENV];
  process.env[BACKGROUND_REVIEW_SENTINEL_ENV] = '1';
  let rounds = 0;
  try {
    while (rounds < maxRounds) {
      if (options.abortSignal?.aborted) break;
      rounds++;

      const response = await options.client.chat(messages, tools, model ? { model } : {});
      const message = response?.choices?.[0]?.message;
      if (!message) break;
      messages.push(message);

      const calls = message.tool_calls ?? [];
      if (calls.length === 0) break;

      for (const call of calls) {
        const name = call.function?.name ?? '';
        if (!allowed.has(name)) {
          blockedToolAttempts.push(name);
          messages.push({
            role: 'tool',
            content: `Error: tool "${name}" is not permitted in a background review.`,
            ...(call.id ? { tool_call_id: call.id } : {}),
          });
          continue;
        }
        let result: HeadlessToolResult;
        try {
          result = await executeTool(name, call.function?.arguments, options.abortSignal);
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : String(err) };
        }
        toolCallsMade.push({ name, success: result.success });
        messages.push({
          role: 'tool',
          content: result.output || result.error || 'Done',
          ...(call.id ? { tool_call_id: call.id } : {}),
        });
      }
    }
  } finally {
    if (priorSentinel === undefined) delete process.env[BACKGROUND_REVIEW_SENTINEL_ENV];
    else process.env[BACKGROUND_REVIEW_SENTINEL_ENV] = priorSentinel;
  }

  if (blockedToolAttempts.length > 0) {
    logger.warn('[background-review] model attempted disallowed tools (blocked)', {
      attempts: blockedToolAttempts,
    });
  }

  return {
    skipped: false,
    rounds,
    toolCallsMade,
    blockedToolAttempts,
    summary: summarizeReviewActions(toolCallsMade),
  };
}

/** Build the mode-specific review instruction. */
export function buildReviewPrompt(mode: BackgroundReviewMode, transcript: ReviewTranscriptEntry[]): string {
  const memoryAsk = 'Did the user reveal persona, desires, preferences, or expectations about how you should behave? If so, save it with the memory tool.';
  const skillAsk = 'What reusable, class-level learning did this session produce? Apply the skill materialization hierarchy.';
  const ask =
    mode === 'memory' ? memoryAsk : mode === 'skill' ? skillAsk : `${memoryAsk}\n\n${skillAsk}`;
  return [
    'Review the session transcript below and take durable learning actions.',
    '',
    ask,
    '',
    '<transcript>',
    renderTranscript(transcript),
    '</transcript>',
  ].join('\n');
}

function renderTranscript(transcript: ReviewTranscriptEntry[]): string {
  const MAX = 12_000;
  const text = transcript
    .map((entry) => `${entry.role}: ${entry.content}`)
    .join('\n')
    .trim();
  return text.length > MAX ? `${text.slice(text.length - MAX)}` : text;
}

/** Build the compact 💾 action summary from executed tool calls. */
export function summarizeReviewActions(
  toolCallsMade: Array<{ name: string; success: boolean }>,
): string {
  const successful = toolCallsMade.filter((call) => call.success);
  const parts: string[] = [];
  if (successful.some((call) => call.name === 'remember')) parts.push('Memory updated');
  if (successful.some((call) => call.name === 'skill_manage')) parts.push('Skill updated');
  return parts.length > 0 ? `💾 ${parts.join(' · ')}` : '';
}

async function loadAllTools(): Promise<Array<{ function?: { name?: string } }>> {
  const { getAllCodeBuddyTools } = await import('../../codebuddy/tools.js');
  return (await getAllCodeBuddyTools()) as Array<{ function?: { name?: string } }>;
}
