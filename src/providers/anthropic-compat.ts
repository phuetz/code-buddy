/**
 * Anthropic on the OpenAI-compatible endpoint (`POST /v1/chat/completions`).
 *
 * Everything here was measured against the real API on 2026-10-08 (recorded
 * bodies: tests/fixtures/anthropic-5-5/):
 *
 * - `temperature`, `top_p`, `top_k` → 400 « `x` is deprecated for this model. »
 *   on every 5.x model and on Opus 4.7 / 4.8 (any value, `0` included); still
 *   accepted by Sonnet 4.5/4.6, Opus 4.6, Haiku 4.5.
 * - `thinking: {type: 'adaptive'}` → 400 « Adaptive thinking is not available
 *   via the OpenAI compatibility endpoint. » while `{type: 'enabled',
 *   budget_tokens}` is accepted (Haiku/Sonnet/Opus 5.5, Haiku 4.5). The native
 *   `/v1/messages` endpoint is the other way round.
 * - 5.x models think adaptively by default and the compat endpoint does not
 *   return the thinking: a small `max_tokens` is spent on it entirely and the
 *   answer is HTTP 200, `content: ""`, `finish_reason: "length"`.
 * - Turning thinking off has a different spelling per model on this endpoint:
 *   `{type: 'disabled'}` for Haiku 5.5 and the 4.x models; Sonnet 5.5 answers 400
 *   « send "thinking": {"type": "between_tools"} instead of {"type": "disabled"} »
 *   (and refuses `between_tools` elsewhere); Opus 5.5 and Fable 5.1 refuse every
 *   spelling (« "thinking.type.disabled" is not supported for this model ») and
 *   always think.
 *
 * No model id is named in this file: models that must not receive a parameter
 * are recognised by their version, and any other refusal is learned from the
 * API's own 400 body (one retry, remembered per model).
 */
import { logger } from '../utils/logger.js';


/** `thinking` needs `budget_tokens >= 1024`, and the answer needs room after it. */
export const ANTHROPIC_MIN_THINKING_BUDGET = 1_024;

/**
 * An explicit `maxTokens` at or under this is a bounded call (judge, summary,
 * JSON extraction): the adaptive thinking would consume it before any text.
 * The agent loop passes no `maxTokens`, so it is never concerned.
 */
export const ANTHROPIC_BOUNDED_MAX_TOKENS = 4_096;

export function isAnthropicEndpoint(baseURL: string): boolean {
  try {
    const host = new URL(baseURL).hostname.toLowerCase();
    return host === 'anthropic.com' || host.endsWith('.anthropic.com');
  } catch {
    return false;
  }
}

/** `claude-opus-4-8` → 4.8, `claude-sonnet-5-5` → 5.5, `claude-haiku-4-5-20251001` → 4.5, `claude-opus-4-20250514` → 4.0. */
function claudeVersion(model: string): { major: number; minor: number } | null {
  const match = /^claude-(?:opus|sonnet|haiku|fable)-(\d{1,2})(?:-(\d{1,2}))?(?=-|$)/i.exec(model.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: match[2] ? Number(match[2]) : 0 };
}

/** Models known to answer 400 to any sampling parameter. */
export function anthropicRejectsSampling(model: string): boolean {
  const version = claudeVersion(model);
  if (!version) return false;
  return version.major >= 5 || (version.major === 4 && version.minor >= 7);
}

/** `claude-sonnet-5-5` and later think adaptively without being asked. */
function thinksByDefault(model: string): boolean {
  const version = claudeVersion(model);
  return !!version && version.major >= 5;
}

// ---------------------------------------------------------------------------
// What the API refused, remembered per model
// ---------------------------------------------------------------------------

type SamplingParam = 'temperature' | 'top_p' | 'top_k';
const learnedSampling = new Map<string, Set<SamplingParam>>();
/** model → the `thinking.type` that turns thinking off, or `null` when it cannot be turned off. */
const learnedThinkingOff = new Map<string, string | null>();

export function resetAnthropicLearnedRefusals(): void {
  learnedSampling.clear();
  learnedThinkingOff.clear();
}

export interface AnthropicRefusals {
  sampling: SamplingParam[];
  /** Present when the API refused `thinking: {type: <sent>}` used to turn thinking off. */
  thinkingOff?: { replacement: string | null };
}

/** What an Anthropic 400 body (`message` of the SDK error) refuses. */
export function parseAnthropicRefusals(message: string, sentThinkingType?: string): AnthropicRefusals {
  const sampling: SamplingParam[] = [];
  for (const match of message.matchAll(/`(temperature|top_p|top_k)` is deprecated/g)) {
    sampling.push(match[1] as SamplingParam);
  }
  const refusals: AnthropicRefusals = { sampling };
  const replacement = /send "thinking": \{"type": "([a-z_]+)"\} instead of \{"type": "disabled"\}/.exec(message);
  if (replacement) {
    refusals.thinkingOff = { replacement: replacement[1]! };
  } else if (sentThinkingType && sentThinkingType !== 'enabled' && message.includes(`"thinking.type.${sentThinkingType}" is not supported`)) {
    refusals.thinkingOff = { replacement: null };
  }
  return refusals;
}

/**
 * Rewrite what the API just refused. Returns the payload to retry with, or `null`
 * when the refusal names nothing we sent (then the 400 is the caller's to see).
 */
export function payloadWithoutRefusals<T extends Record<string, unknown>>(
  payload: T,
  baseURL: string,
  errorMessage: string,
): T | null {
  if (!isAnthropicEndpoint(baseURL)) return null;
  const model = String(payload.model ?? '');
  const sentType = (payload.thinking as { type?: string } | undefined)?.type;
  const refusals = parseAnthropicRefusals(errorMessage, sentType);
  const next: Record<string, unknown> = { ...payload };
  const notes: string[] = [];

  for (const param of refusals.sampling) {
    if (!(param in next)) continue;
    delete next[param];
    const set = learnedSampling.get(model) ?? new Set<SamplingParam>();
    set.add(param);
    learnedSampling.set(model, set);
    notes.push(`${param} dropped`);
  }
  if (refusals.thinkingOff && sentType && sentType !== 'enabled') {
    const { replacement } = refusals.thinkingOff;
    learnedThinkingOff.set(model, replacement);
    if (replacement === null) delete next.thinking;
    else next.thinking = { type: replacement };
    notes.push(replacement === null ? 'thinking dropped (cannot be turned off)' : `thinking sent as ${replacement}`);
  }
  if (notes.length === 0) return null;
  logger.warn(`Anthropic refused part of the request for ${model} (${notes.join(', ')}); retrying once`, {
    source: 'anthropic-compat',
  });
  return next as T;
}

// ---------------------------------------------------------------------------
// Request adaptation
// ---------------------------------------------------------------------------

export interface AnthropicRequestIntent {
  /** `ChatOptions.temperature`: set by a caller, never defaulted by us. */
  temperature?: number | undefined;
  /** `ChatOptions.maxTokens`: set only when the caller bounds the answer. */
  explicitMaxTokens?: number | undefined;
  /** What `getExtendedThinking().getThinkingConfig()` returned. */
  thinking?: { type: 'enabled'; budget_tokens: number } | undefined;
}

type MutablePayload = { model: string; max_tokens?: number | null; temperature?: unknown; thinking?: unknown } & Record<string, unknown>;

/** The `thinking` value that turns thinking off for this model, `undefined` when none exists. */
function thinkingOffFor(model: string): { type: string } | undefined {
  if (!learnedThinkingOff.has(model)) return { type: 'disabled' };
  const learned = learnedThinkingOff.get(model);
  return learned === null || learned === undefined ? undefined : { type: learned };
}

function thinkingEnvMode(): 'disabled' | 'default' | undefined {
  const raw = process.env.CODEBUDDY_ANTHROPIC_THINKING?.trim().toLowerCase();
  if (raw === 'disabled' || raw === 'off' || raw === 'false' || raw === '0') return 'disabled';
  if (raw === 'default' || raw === 'adaptive') return 'default';
  return undefined;
}

/**
 * Make an OpenAI-shaped payload acceptable to `api.anthropic.com`:
 * sampling parameters only when a caller set them and the model takes them,
 * and a `thinking` value that the endpoint accepts and that leaves room for
 * the answer. A no-op for every other host.
 */
export function adaptPayloadForAnthropic<T extends MutablePayload>(
  payload: T,
  baseURL: string,
  intent: AnthropicRequestIntent,
): T {
  if (!isAnthropicEndpoint(baseURL)) return payload;
  const model = payload.model;

  // --- sampling ---------------------------------------------------------
  const refused = anthropicRejectsSampling(model);
  if (intent.temperature === undefined || refused || learnedSampling.get(model)?.has('temperature')) {
    if (intent.temperature !== undefined && refused) {
      logger.debug(`temperature ${intent.temperature} not sent: deprecated for ${model}`, { source: 'anthropic-compat' });
    }
    delete payload.temperature;
  }
  for (const param of ['top_p', 'top_k'] as const) {
    if (refused || learnedSampling.get(model)?.has(param)) delete payload[param];
  }

  // --- thinking ---------------------------------------------------------
  const maxTokens = payload.max_tokens ?? undefined;
  const mode = thinkingEnvMode();
  let thinking: unknown;

  if (mode === 'disabled') {
    thinking = thinkingOffFor(model);
  } else if (mode === 'default') {
    thinking = undefined;
  } else if (intent.thinking) {
    const room = typeof maxTokens === 'number' ? maxTokens - ANTHROPIC_MIN_THINKING_BUDGET : intent.thinking.budget_tokens;
    const budget = Math.min(intent.thinking.budget_tokens, room);
    if (budget >= ANTHROPIC_MIN_THINKING_BUDGET) {
      thinking = { type: 'enabled', budget_tokens: budget };
    } else {
      logger.warn(
        `Extended thinking left off: max_tokens ${String(maxTokens)} cannot hold a ${ANTHROPIC_MIN_THINKING_BUDGET}-token budget plus an answer`,
        { source: 'anthropic-compat' },
      );
      thinking = thinkingOffFor(model);
    }
  } else if (
    intent.explicitMaxTokens !== undefined &&
    intent.explicitMaxTokens <= ANTHROPIC_BOUNDED_MAX_TOKENS &&
    thinksByDefault(model)
  ) {
    thinking = thinkingOffFor(model);
  }

  if (thinking === undefined) delete payload.thinking;
  else payload.thinking = thinking;
  return payload;
}

// ---------------------------------------------------------------------------
// Empty answers
// ---------------------------------------------------------------------------

/** An answer with no text and no tool call: reported, never returned as a success. */
export class EmptyProviderResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmptyProviderResponseError';
  }
}

export function emptyAnthropicResponseError(args: {
  model: string;
  finishReason: string | null | undefined;
  maxTokens: number | null | undefined;
}): EmptyProviderResponseError {
  const finish = args.finishReason ?? 'none';
  const requested = args.maxTokens ?? 'default';
  if (finish === 'length') {
    return new EmptyProviderResponseError(
      `Empty answer from ${args.model}: finish_reason: length with no text — the max_tokens budget (${requested}) ` +
        'was spent before any text came out (adaptive thinking runs by default on 5.x models and is not returned by this endpoint). ' +
        'Raise max_tokens, or set CODEBUDDY_ANTHROPIC_THINKING=disabled (a model that cannot turn thinking off, like Opus 5.5 or Fable 5.1, needs the larger budget).',
    );
  }
  return new EmptyProviderResponseError(
    `Empty answer from ${args.model}: no text and no tool call (finish_reason: ${finish}, max_tokens: ${requested}). ` +
      'Check the model and provider logs, then retry.',
  );
}

/** True when a non-streamed choice carries neither text nor a tool call. */
export function isEmptyChoice(message: { content?: unknown; tool_calls?: unknown } | null | undefined): boolean {
  if (!message) return true;
  const content = message.content;
  const hasText =
    typeof content === 'string'
      ? content.trim().length > 0
      : Array.isArray(content) && content.some(part => typeof (part as { text?: unknown })?.text === 'string' && (part as { text: string }).text.trim().length > 0);
  const hasTools = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  return !hasText && !hasTools;
}
