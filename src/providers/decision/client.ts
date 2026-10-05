/**
 * Optional Kev decision client.
 *
 * Disabled unless CODEBUDDY_DECISION_URL is a non-empty base URL: decide()
 * then returns before fetch. The HTTP call is the one documented by
 * `python -m kev.serve` (kev/serve.py POST /v1/systemone, body =
 * kev.api.SystemOneRequest) at fe64b1274ea7f80d4095866df90666abb03e9cf6.
 * PRIVACY: the question AND the transcript (`texte`, e.g. what was said in the
 * room) are POSTed to CODEBUDDY_DECISION_URL. Point it only at a server you trust;
 * nothing restricts it to loopback. Redirects are refused.
 * No Authorization header: that file's local default is an open server
 * (KEV_API_KEY unset). This module does not load a model.
 */

import {
  KEV_DEFAULT_MODEL,
  KEV_MAX_OPTIONS,
  KEV_QUESTION_TYPES,
  type KevQuestionType,
} from './types.js';

export const DECISION_URL_ENV = 'CODEBUDDY_DECISION_URL';

/**
 * Client-side abort only. Not a field of SystemOneRequest or Server._body.
 * Stops a dead URL from holding the caller; the caller keeps its own decision.
 */
export const DEFAULT_DECISION_TIMEOUT_MS = 1000;

export class DecisionUrlMissingError extends Error {
  constructor() {
    super(`${DECISION_URL_ENV} is empty; no request sent`);
    this.name = 'DecisionUrlMissingError';
  }
}

export class DecisionTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecisionTypeError';
  }
}

export class DecisionHttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecisionHttpError';
  }
}

export class DecisionShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecisionShapeError';
  }
}

export function decisionBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env[DECISION_URL_ENV]?.trim() ?? '';
}

/** Origin from CODEBUDDY_DECISION_URL plus the path kev/serve.py registers. */
export function systemOneUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/v1/systemone')) return trimmed;
  return `${trimmed}/v1/systemone`;
}

export interface DecideOptions {
  /** Overrides CODEBUDDY_DECISION_URL. Empty still sends nothing. */
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * kev/api.py criteria. Omitted for noul when absent (criteria is optional).
   * Required dict for choice, required list for score. Not invented here.
   */
  criteria?: Record<string, unknown> | unknown[] | null;
  /** Caller-chosen questions key. kev/serve README: the model never sees it. */
  id?: string;
  /** SystemOneRequest.model. Default kev-latest. */
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function isKevType(type: string): type is KevQuestionType {
  return (KEV_QUESTION_TYPES as readonly string[]).includes(type);
}

function assertCriteria(type: KevQuestionType, criteria: DecideOptions['criteria']): void {
  if (type === 'noul') {
    if (criteria == null) return;
    if (Array.isArray(criteria) || typeof criteria !== 'object') {
      throw new DecisionTypeError('noul criteria must be an object or null (kev/api.py Noul)');
    }
    return;
  }
  if (type === 'choice') {
    if (
      criteria == null ||
      Array.isArray(criteria) ||
      typeof criteria !== 'object' ||
      Object.keys(criteria).length < 1 ||
      Object.keys(criteria).length > KEV_MAX_OPTIONS
    ) {
      throw new DecisionTypeError(
        `choice criteria must be a dict of 1..${KEV_MAX_OPTIONS} options (kev/api.py Choice)`,
      );
    }
    return;
  }
  if (!Array.isArray(criteria) || criteria.length < 1 || criteria.length > KEV_MAX_OPTIONS) {
    throw new DecisionTypeError(
      `score criteria must be a list of 1..${KEV_MAX_OPTIONS} levels (kev/api.py Score)`,
    );
  }
}

/**
 * One System One question. Returns a probability only when the response field
 * is already a probability:
 * - noul → answers[id].noul (p(true), kev/api.py to_answers)
 * - choice → answers[id].probabilities[answers[id].choice] (reported probability of the argmax option)
 * - score → null. answers[id].score is an expected level index, not a probability,
 *   and confidence is score_confidence, not a probability. Neither is returned as one.
 */
export async function decide(
  question: string,
  texte: unknown,
  type: string,
  options: DecideOptions = {},
): Promise<number | null> {
  if (!isKevType(type)) {
    throw new DecisionTypeError(
      `type must be one of ${KEV_QUESTION_TYPES.join(', ')} (kev/api.py Question); got ${type}`,
    );
  }
  assertCriteria(type, options.criteria);
  const baseUrl = (options.baseUrl ?? decisionBaseUrl(options.env)).trim();
  if (!baseUrl) throw new DecisionUrlMissingError();

  const id = options.id ?? 'q';
  const questionBody: Record<string, unknown> = {
    type,
    instructions: question,
  };
  if (options.criteria != null) questionBody.criteria = options.criteria;
  const body = {
    state: texte,
    model: options.model ?? KEV_DEFAULT_MODEL,
    questions: { [id]: questionBody },
  };

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_DECISION_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let parsed: unknown;
  try {
    const response = await fetchImpl(systemOneUrl(baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      redirect: 'error',
    });
    if (!response.ok) {
      throw new DecisionHttpError(`POST /v1/systemone failed: HTTP ${response.status}`);
    }
    // The timer must also cover the body: headers can arrive and the body never end.
    parsed = await response.json();
  } finally {
    clearTimeout(timer);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new DecisionShapeError('response is not an object');
  }
  const answers = (parsed as { answers?: unknown }).answers;
  if (!answers || typeof answers !== 'object') {
    throw new DecisionShapeError('response.answers missing');
  }
  const answer = (answers as Record<string, unknown>)[id];
  if (!answer || typeof answer !== 'object') {
    throw new DecisionShapeError(`response.answers[${id}] missing`);
  }
  const record = answer as Record<string, unknown>;
  if (record.type !== type) {
    throw new DecisionShapeError(`response type ${String(record.type)} != ${type}`);
  }
  if (type === 'noul') {
    if (typeof record.noul !== 'number') {
      throw new DecisionShapeError('noul answer has no numeric noul field');
    }
    return record.noul;
  }
  if (type === 'choice') {
    const choice = record.choice;
    const probs = record.probabilities;
    if (typeof choice !== 'string' || !probs || typeof probs !== 'object') {
      throw new DecisionShapeError('choice answer missing choice or probabilities');
    }
    const probability = (probs as Record<string, unknown>)[choice];
    if (typeof probability !== 'number') {
      throw new DecisionShapeError('choice probabilities[choice] is not a number');
    }
    return probability;
  }
  if (typeof record.score !== 'number') {
    throw new DecisionShapeError('score answer has no numeric score field');
  }
  return null;
}
