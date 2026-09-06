/**
 * Failover-oriented classification of a provider error.
 *
 * Distinct from `classifyProviderError` (retry-vs-fatal for the SAME
 * credential). This answers: may we switch provider, and until when
 * should the failed one stay on the bench?
 */
import { classifyProviderError } from './provider-error-classifier.js';

export type FailoverKind =
  | 'quota_exhausted'
  | 'overloaded'
  | 'unreachable'
  | 'auth'
  | 'other';

export interface FailoverClassification {
  kind: FailoverKind;
  /** True for quota / overload / unreachable — never for auth or other. */
  shouldFailover: boolean;
  status?: number;
  /** Absolute epoch ms when the provider may be retried. */
  resetsAt?: number;
  /** Short label for logs. */
  reason: string;
}

const DEFAULT_QUOTA_TTL_MS = 60 * 60 * 1000;
const OVERLOADED_TTL_MS = 60 * 1000;
const UNREACHABLE_TTL_MS = 5 * 60 * 1000;

function asRecord(err: unknown): Record<string, unknown> | undefined {
  if (!err || typeof err !== 'object') return undefined;
  return err as Record<string, unknown>;
}

function nestedError(err: unknown): Record<string, unknown> | undefined {
  const rec = asRecord(err);
  const nested = rec?.error;
  if (nested && typeof nested === 'object') return nested as Record<string, unknown>;
  return undefined;
}

/** Pull `resets_in_seconds` from SDK fields or a JSON body embedded in the message. */
export function extractResetsInSeconds(err: unknown): number | undefined {
  const rec = asRecord(err);
  const candidates: unknown[] = [
    rec?.resets_in_seconds,
    rec?.resetsInSeconds,
    nestedError(err)?.resets_in_seconds,
  ];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
    if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) return Number(value.trim());
  }
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const match = message.match(/resets_in_seconds["']?\s*[:=]\s*(\d+(?:\.\d+)?)/i);
  if (match?.[1]) return Number(match[1]);
  try {
    const jsonStart = message.indexOf('{');
    if (jsonStart >= 0) {
      const parsed = JSON.parse(message.slice(jsonStart)) as { resets_in_seconds?: unknown };
      if (typeof parsed.resets_in_seconds === 'number') return parsed.resets_in_seconds;
    }
  } catch {
    /* message is not JSON */
  }
  return undefined;
}

function isNetworkish(reason: string, err: unknown): boolean {
  if (reason === 'network') return true;
  const rec = asRecord(err);
  const code = typeof rec?.code === 'string' ? rec.code.toUpperCase() : '';
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'UND_ERR_CONNECT_TIMEOUT'
  ) {
    return true;
  }
  const message = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  return (
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('etimedout') ||
    message.includes('connect timeout') ||
    message.includes('fetch failed')
  );
}

function isOverloadedSignal(status: number | undefined, reason: string, err: unknown): boolean {
  if (status === 503 || status === 529) return true;
  if (reason === 'http_503' || reason === 'http_529') return true;
  const rec = asRecord(err);
  const code = typeof rec?.code === 'string' ? rec.code.toLowerCase() : '';
  const type = typeof rec?.type === 'string' ? rec.type.toLowerCase() : '';
  if (code === 'overloaded_error' || type === 'overloaded_error') return true;
  const message = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  return message.includes('overloaded') || message.includes('overloaded_error');
}

export function failoverTtlMs(kind: FailoverKind, resetsInSeconds?: number): number {
  if (kind === 'quota_exhausted') {
    if (typeof resetsInSeconds === 'number' && Number.isFinite(resetsInSeconds) && resetsInSeconds > 0) {
      return Math.round(resetsInSeconds * 1000);
    }
    return DEFAULT_QUOTA_TTL_MS;
  }
  if (kind === 'overloaded') return OVERLOADED_TTL_MS;
  if (kind === 'unreachable') return UNREACHABLE_TTL_MS;
  return DEFAULT_QUOTA_TTL_MS;
}

export function classifyFailoverKind(err: unknown, nowMs: number = Date.now()): FailoverClassification {
  const classified = classifyProviderError(err, nowMs);
  const resetsInSeconds = extractResetsInSeconds(err);
  const status = classified.status;

  if (classified.reason === 'quota_exhausted' || resetsInSeconds !== undefined) {
    const ttl = failoverTtlMs('quota_exhausted', resetsInSeconds);
    return {
      kind: 'quota_exhausted',
      shouldFailover: true,
      status,
      resetsAt: nowMs + ttl,
      reason: classified.reason === 'quota_exhausted' ? 'quota_exhausted' : 'usage_limit_reached',
    };
  }

  if (classified.reason === 'auth_failed') {
    return { kind: 'auth', shouldFailover: false, status, reason: 'auth_failed' };
  }

  if (isOverloadedSignal(status, classified.reason, err)) {
    return {
      kind: 'overloaded',
      shouldFailover: true,
      status,
      resetsAt: nowMs + OVERLOADED_TTL_MS,
      reason: classified.reason || 'overloaded',
    };
  }

  if (isNetworkish(classified.reason, err)) {
    return {
      kind: 'unreachable',
      shouldFailover: true,
      status,
      resetsAt: nowMs + UNREACHABLE_TTL_MS,
      reason: classified.reason || 'network',
    };
  }

  // Transient 429 congestion (not a weekly quota) — switch rather than hammer.
  if (classified.retryable && (status === 429 || classified.reason === 'rate_limited')) {
    return {
      kind: 'overloaded',
      shouldFailover: true,
      status,
      resetsAt: nowMs + OVERLOADED_TTL_MS,
      reason: 'rate_limited',
    };
  }

  return {
    kind: 'other',
    shouldFailover: false,
    status,
    reason: classified.reason || 'unclassified',
  };
}
