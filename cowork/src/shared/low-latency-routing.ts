import type { ApiConfigSet, Session, SessionLatencyMetrics } from '../renderer/types';

const SMALL_MODEL = /(^|[-_:])(0\.5|0\.8|1|1\.5|2|3)b($|[-_:])/;
const FAST_MODEL = /(flash|mini|haiku|fast|instant|small)/;
const HEAVY_MODEL = /(opus|ultra|550b|405b|reasoning|deep)/;

export interface LowLatencyRuntimeRecommendation {
  configSetId: string;
  profileId: string;
  model: string;
  score: number;
  sampleCount: number;
  p50Ms?: number;
  source: 'measured' | 'heuristic';
  executionLocation: 'local' | 'lan' | 'cloud';
}

export function inferExecutionLocation(set: ApiConfigSet): 'local' | 'lan' | 'cloud' {
  if (set.provider === 'ollama' || set.provider === 'lmstudio') return 'local';
  const baseUrl = set.profiles[set.activeProfileKey]?.baseUrl?.toLowerCase() ?? '';
  if (/localhost|127\.0\.0\.1|\[::1\]/.test(baseUrl)) return 'local';
  if (/\b10\.|\b192\.168\.|\b172\.(1[6-9]|2\d|3[01])\./.test(baseUrl)) return 'lan';
  return 'cloud';
}

function latencyValue(sample: SessionLatencyMetrics): number | undefined {
  return sample.firstTokenMs ?? sample.totalMs;
}

function heuristicScore(set: ApiConfigSet, model: string): number {
  const normalized = model.toLowerCase();
  // Runtime location matters more than the provider label. This covers
  // Lemonade, vLLM and future OpenAI-compatible loopback engines without
  // growing another hard-coded provider list.
  let score = inferExecutionLocation(set) === 'local' ? 100 : 0;
  if (SMALL_MODEL.test(normalized)) score += 60;
  if (FAST_MODEL.test(normalized)) score += 35;
  if (HEAVY_MODEL.test(normalized)) score -= 80;
  return score;
}

function measuredLatencies(setId: string, model: string, sessions: Session[]): number[] {
  const values: number[] = [];
  for (const session of sessions) {
    const intelligence = session.intelligence;
    if (!intelligence) continue;
    const samples = intelligence.latencyHistory?.length
      ? intelligence.latencyHistory
      : intelligence.lastLatency
        ? [intelligence.lastLatency]
        : [];
    for (const sample of samples) {
      const belongsToRuntime = sample.configSetId
        ? sample.configSetId === setId && (!sample.model || sample.model === model)
        : intelligence.configSetId === setId && (!session.model || session.model === model);
      const value = latencyValue(sample);
      if (belongsToRuntime && value !== undefined) values.push(value);
    }
  }
  return values;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const current = sorted[middle];
  if (current === undefined) return undefined;
  if (sorted.length % 2 === 1) return current;
  const previous = sorted[middle - 1];
  return previous === undefined ? current : (previous + current) / 2;
}

export function rankLowLatencyRuntimes(
  configSets: ApiConfigSet[],
  sessions: Session[] = [],
): LowLatencyRuntimeRecommendation[] {
  const recommendations: LowLatencyRuntimeRecommendation[] = [];
  for (const set of configSets) {
    const profile = set.profiles[set.activeProfileKey];
    const model = profile?.model?.trim();
    if (!model) continue;
    const values = measuredLatencies(set.id, model, sessions);
    const p50Ms = median(values);
    const confidence = Math.min(1, values.length / 5);
    const empiricalScore = p50Ms === undefined ? 0 : Math.max(-140, 180 - p50Ms / 5);
    recommendations.push({
      configSetId: set.id,
      profileId: set.activeProfileKey,
      model,
      score: heuristicScore(set, model) + empiricalScore * confidence,
      sampleCount: values.length,
      p50Ms,
      source: values.length >= 2 ? 'measured' : 'heuristic',
      executionLocation: inferExecutionLocation(set),
    });
  }
  return recommendations.sort((left, right) => right.score - left.score);
}

export function chooseLowLatencyRuntime(
  configSets: ApiConfigSet[],
  sessions: Session[] = [],
): LowLatencyRuntimeRecommendation | null {
  return rankLowLatencyRuntimes(configSets, sessions)[0] ?? null;
}
