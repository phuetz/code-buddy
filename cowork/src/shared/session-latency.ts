import type { SessionIntelligence, SessionLatencyMetrics } from '../renderer/types';

export const SESSION_LATENCY_HISTORY_LIMIT = 20;

export interface SessionLatencySummary {
  samples: number;
  p50Ms?: number;
  p95Ms?: number;
  consecutiveBudgetBreaches: number;
}

function signalLatency(sample: SessionLatencyMetrics): number | undefined {
  return sample.firstTokenMs ?? sample.totalMs;
}

function percentile(values: number[], ratio: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

export function appendLatencyMeasurement(
  intelligence: SessionIntelligence,
  measurement: SessionLatencyMetrics,
): SessionIntelligence {
  const merged = { ...intelligence.lastLatency, ...measurement };
  const latencyHistory = [...(intelligence.latencyHistory ?? []), merged]
    .slice(-SESSION_LATENCY_HISTORY_LIMIT);
  return { ...intelligence, lastLatency: merged, latencyHistory };
}

export function summarizeLatencyHistory(
  intelligence: Pick<SessionIntelligence, 'latencyBudgetMs' | 'latencyHistory' | 'lastLatency'>,
  runtime?: { configSetId?: string; model?: string },
): SessionLatencySummary {
  let history = intelligence.latencyHistory?.length
    ? intelligence.latencyHistory
    : intelligence.lastLatency
      ? [intelligence.lastLatency]
      : [];
  if (runtime && history.some((sample) => sample.configSetId || sample.model)) {
    history = history.filter((sample) =>
      (!sample.configSetId || sample.configSetId === runtime.configSetId)
      && (!sample.model || sample.model === runtime.model));
  }
  const values = history.map(signalLatency).filter((value): value is number => value !== undefined);
  let consecutiveBudgetBreaches = 0;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value === undefined || value <= intelligence.latencyBudgetMs) break;
    consecutiveBudgetBreaches += 1;
  }
  return {
    samples: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    consecutiveBudgetBreaches,
  };
}
