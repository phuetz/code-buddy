/**
 * Terminal error after the declared failover chain is exhausted.
 *
 * Carries the original outage (typically a 429) and every backup attempt
 * so the 400 of a too-small local model is not hidden behind the quota.
 */
import { classifyProviderError } from './provider-error-classifier.js';

export interface FailoverAttemptDetail {
  target: string;
  status?: number | 'skipped';
  message: string;
}

export class ProviderFailoverExhaustedError extends Error {
  readonly details: {
    primary: string;
    attempts: FailoverAttemptDetail[];
  };
  override readonly cause: unknown;

  constructor(primaryError: unknown, attempts: FailoverAttemptDetail[]) {
    const primary = primaryError instanceof Error ? primaryError.message : String(primaryError ?? '');
    const attemptLines = attempts.map(formatFailoverAttemptLine);
    super([primary, ...attemptLines].filter(Boolean).join('; '), {
      cause: primaryError instanceof Error ? primaryError : undefined,
    });
    this.name = 'ProviderFailoverExhaustedError';
    this.details = { primary, attempts };
    this.cause = primaryError;
  }
}

export function isProviderFailoverExhaustedError(
  err: unknown,
): err is ProviderFailoverExhaustedError {
  if (err instanceof ProviderFailoverExhaustedError) return true;
  if (!err || typeof err !== 'object') return false;
  const rec = err as { name?: unknown; details?: { attempts?: unknown } };
  return rec.name === 'ProviderFailoverExhaustedError' && Array.isArray(rec.details?.attempts);
}

export function formatFailoverAttemptLine(attempt: FailoverAttemptDetail): string {
  if (attempt.status === 'skipped') {
    return `${attempt.target} ignorée (${attempt.message})`;
  }
  return `${attempt.target} → ${attempt.message}`;
}

export function describeFailoverAttempt(target: string, err: unknown): FailoverAttemptDetail {
  const classified = classifyProviderError(err);
  const rec = err && typeof err === 'object' ? err as { status?: unknown } : undefined;
  const status = typeof rec?.status === 'number' ? rec.status : classified.status;
  const raw = err instanceof Error ? err.message : String(err ?? '');
  if (
    status === 400
    && /context (size|length)|exceeds the available context/i.test(raw)
  ) {
    return { target, status, message: '400 context length' };
  }
  if (typeof status === 'number') {
    return { target, status, message: `${status} ${raw}`.trim() };
  }
  return { target, message: raw };
}
