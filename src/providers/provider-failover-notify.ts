/**
 * Visibility for a declared provider failover: log line, event bus,
 * RunStore decision (trajectory), last-failover memory.
 */
import { logger } from '../utils/logger.js';
import { getGlobalEventBus } from '../events/event-bus.js';
import { RunStore } from '../observability/run-store.js';
import type { FailoverKind } from '../codebuddy/provider-failover-kind.js';
import { recordLastFailover } from './provider-health.js';

export interface FallbackNotice {
  fromProvider: string;
  fromModel?: string;
  toProvider: string;
  toModel: string;
  kind: FailoverKind;
  resetsAt?: number;
  nowMs?: number;
}

export function formatResetHint(resetsAt: number | undefined, nowMs: number = Date.now()): string {
  if (!resetsAt || resetsAt <= nowMs) return '';
  const remaining = resetsAt - nowMs;
  if (remaining >= 3_600_000) return `, reset dans ${Math.round(remaining / 3_600_000)} h`;
  return `, reset dans ${Math.max(1, Math.round(remaining / 60_000))} min`;
}

export function formatFallbackLogLine(notice: FallbackNotice): string {
  const to = `${notice.toProvider}:${notice.toModel}`;
  return `[fallback] ${notice.fromProvider} → ${to} (${notice.kind}${formatResetHint(notice.resetsAt, notice.nowMs)})`;
}

export function notifyProviderFallback(notice: FallbackNotice): void {
  const line = formatFallbackLogLine(notice);
  logger.warn(line, {
    source: 'CodeBuddyClient',
    fromProvider: notice.fromProvider,
    toProvider: notice.toProvider,
    toModel: notice.toModel,
    kind: notice.kind,
    resetsAt: notice.resetsAt,
  });
  try {
    getGlobalEventBus().emit('provider:fallback', {
      fromProvider: notice.fromProvider,
      toProvider: notice.toProvider,
      reason: notice.kind,
      ...(notice.resetsAt !== undefined
        ? { resetsAt: notice.resetsAt, resets_at: notice.resetsAt }
        : {}),
    });
  } catch {
    /* bus must never break the turn */
  }
  try {
    RunStore.getInstance().appendEvent('decision', {
      kind: 'provider_fallback',
      from: notice.fromProvider,
      to: notice.toProvider,
      toModel: notice.toModel,
      reason: notice.kind,
      resetsAt: notice.resetsAt,
    });
  } catch {
    /* no active run is fine */
  }
  recordLastFailover({
    from: notice.fromProvider,
    to: notice.toProvider,
    toModel: notice.toModel,
    kind: notice.kind,
  });
}

export function notifyProviderReturn(providerId: string): void {
  logger.warn(`[fallback] return ${providerId} (healthy again)`, {
    source: 'CodeBuddyClient',
    provider: providerId,
  });
  try {
    getGlobalEventBus().emit('provider:switched', {
      toProvider: providerId,
    });
  } catch {
    /* ignore */
  }
}

export function notifyAuthFailure(providerId: string, message: string): void {
  logger.error(
    `[fallback] auth failure on ${providerId} — no silent failover. Re-authenticate.`,
    { source: 'CodeBuddyClient', provider: providerId, error: message },
  );
  try {
    getGlobalEventBus().emit('provider:error', {
      providerId,
      error: message,
    });
  } catch {
    /* ignore */
  }
}
