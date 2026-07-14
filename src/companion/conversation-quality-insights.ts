import { existsSync, readFileSync } from 'node:fs';

import type {
  ConversationEpisodeIssue,
  ConversationEpisodeMetrics,
  ConversationQualityDimension,
} from '../conversation/conversation-evaluator.js';
import type { ConversationTurn } from '../conversation/types.js';
import {
  defaultConversationQualityJournalPath,
  defaultConversationQualityStatePath,
  loadConversationImprovementState,
  runConversationImprovementCycle,
} from './conversation-improvement-loop.js';

export const CONVERSATION_QUALITY_INSIGHTS_SCHEMA_VERSION = 1 as const;
export const DEFAULT_CONVERSATION_QUALITY_WINDOW = 30;

export type ConversationQualityTrendDirection =
  | 'improving'
  | 'stable'
  | 'declining'
  | 'insufficient';

export interface ConversationQualitySnapshot {
  at: number;
  overallScore: number;
  passes: boolean;
  dimensions: Record<ConversationQualityDimension, number>;
  issues: ConversationEpisodeIssue[];
  relationalSafety: { score: number; passes: boolean };
  metrics: Pick<
    ConversationEpisodeMetrics,
    | 'turnCount'
    | 'exchangeCount'
    | 'assistantQuestionRate'
    | 'averageAssistantSentences'
    | 'repeatedOpeningRate'
    | 'interTurnProgressionScore'
    | 'stalledProgressionRate'
  >;
}

export interface ConversationQualityInsights {
  schemaVersion: typeof CONVERSATION_QUALITY_INSIGHTS_SCHEMA_VERSION;
  available: boolean;
  sampleCount: number;
  windowSize: number;
  latest?: ConversationQualitySnapshot;
  trend: {
    direction: ConversationQualityTrendDirection;
    scoreDelta: number;
    passRate: number;
  };
  recurringIssues: Array<{ issue: ConversationEpisodeIssue; count: number }>;
  activeGuidance?: {
    issue: ConversationEpisodeIssue;
    baselineScore: number;
    appliedAt: number;
    evaluationCount: number;
  };
  privacy: {
    verbatimIncluded: false;
    fingerprintsIncluded: false;
  };
}

export interface ConversationQualityInsightsOptions {
  journalPath?: string;
  statePath?: string;
  windowSize?: number;
}

export interface MeasureConversationQualityOptions {
  readConversation?: (limit: number) => Promise<ConversationTurn[]>;
  limit?: number;
  now?: number;
}

const DIMENSIONS: readonly ConversationQualityDimension[] = [
  'responsiveness',
  'depth',
  'reasoning',
  'continuity',
  'variety',
  'balance',
  'attunement',
  'reciprocity',
];

const ISSUES: readonly ConversationEpisodeIssue[] = [
  'insufficient_sample',
  'incomplete_exchange',
  'too_shallow',
  'weak_reasoning',
  'topic_drift',
  'continuity_break',
  'repetitive',
  'monologue',
  'interrogative',
  'poor_attunement',
  'dependency_pressure',
  'human_disparagement',
  'false_subjective_claim',
  'emotional_coercion',
];

const ISSUE_SET = new Set<ConversationEpisodeIssue>(ISSUES);

function clamp01(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0;
}

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function dimensionsFrom(value: unknown): Record<ConversationQualityDimension, number> {
  const source = objectValue(value);
  return Object.fromEntries(
    DIMENSIONS.map((dimension) => [dimension, clamp01(source[dimension])]),
  ) as Record<ConversationQualityDimension, number>;
}

function issuesFrom(value: unknown): ConversationEpisodeIssue[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(
    (issue): issue is ConversationEpisodeIssue =>
      typeof issue === 'string' && ISSUE_SET.has(issue as ConversationEpisodeIssue),
  ))];
}

function snapshotFrom(value: unknown): ConversationQualitySnapshot | null {
  const source = objectValue(value);
  if (typeof source.at !== 'number' || !Number.isFinite(source.at)) return null;
  const safety = objectValue(source.relationalSafety);
  const metrics = objectValue(source.metrics);
  return {
    at: source.at,
    overallScore: clamp01(source.overallScore),
    passes: source.passes === true,
    dimensions: dimensionsFrom(source.dimensions),
    issues: issuesFrom(source.issues),
    relationalSafety: {
      score: clamp01(safety.score),
      passes: safety.passes === true,
    },
    metrics: {
      turnCount: finiteNonNegative(metrics.turnCount),
      exchangeCount: finiteNonNegative(metrics.exchangeCount),
      assistantQuestionRate: clamp01(metrics.assistantQuestionRate),
      averageAssistantSentences: finiteNonNegative(metrics.averageAssistantSentences),
      repeatedOpeningRate: clamp01(metrics.repeatedOpeningRate),
      interTurnProgressionScore: clamp01(metrics.interTurnProgressionScore),
      stalledProgressionRate: clamp01(metrics.stalledProgressionRate),
    },
  };
}

function directionFor(scoreDelta: number, samples: number): ConversationQualityTrendDirection {
  if (samples < 2) return 'insufficient';
  if (scoreDelta >= 0.04) return 'improving';
  if (scoreDelta <= -0.04) return 'declining';
  return 'stable';
}

function buildInsights(
  snapshots: ConversationQualitySnapshot[],
  options: ConversationQualityInsightsOptions,
): ConversationQualityInsights {
  const issueCounts = new Map<ConversationEpisodeIssue, number>();
  for (const snapshot of snapshots) {
    for (const issue of snapshot.issues) {
      issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + 1);
    }
  }
  const first = snapshots[0];
  const latest = snapshots.at(-1);
  const scoreDelta = first && latest ? latest.overallScore - first.overallScore : 0;
  const state = loadConversationImprovementState(
    options.statePath ?? defaultConversationQualityStatePath(),
  );
  return {
    schemaVersion: CONVERSATION_QUALITY_INSIGHTS_SCHEMA_VERSION,
    available: snapshots.length > 0,
    sampleCount: snapshots.length,
    windowSize: Math.max(1, Math.min(200, options.windowSize ?? DEFAULT_CONVERSATION_QUALITY_WINDOW)),
    ...(latest ? { latest } : {}),
    trend: {
      direction: directionFor(scoreDelta, snapshots.length),
      scoreDelta,
      passRate: snapshots.length
        ? snapshots.filter((snapshot) => snapshot.passes).length / snapshots.length
        : 0,
    },
    recurringIssues: [...issueCounts.entries()]
      .map(([issue, count]) => ({ issue, count }))
      .sort((left, right) => right.count - left.count || left.issue.localeCompare(right.issue)),
    ...(state.activeGuidance
      ? {
          activeGuidance: {
            issue: state.activeGuidance.issue,
            baselineScore: clamp01(state.activeGuidance.baselineScore),
            appliedAt: finiteNonNegative(state.activeGuidance.appliedAt),
            evaluationCount: finiteNonNegative(state.activeGuidance.evaluationCount),
          },
        }
      : {}),
    privacy: { verbatimIncluded: false, fingerprintsIncluded: false },
  };
}

export function readConversationQualityInsights(
  options: ConversationQualityInsightsOptions = {},
): ConversationQualityInsights {
  const windowSize = Math.max(
    1,
    Math.min(200, Math.floor(options.windowSize ?? DEFAULT_CONVERSATION_QUALITY_WINDOW)),
  );
  const journalPath = options.journalPath ?? defaultConversationQualityJournalPath();
  if (!existsSync(journalPath)) return buildInsights([], { ...options, windowSize });
  let lines: string[] = [];
  try {
    lines = readFileSync(journalPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-windowSize);
  } catch {
    return buildInsights([], { ...options, windowSize });
  }
  const snapshots: ConversationQualitySnapshot[] = [];
  for (const line of lines) {
    try {
      const snapshot = snapshotFrom(JSON.parse(line));
      if (snapshot) snapshots.push(snapshot);
    } catch {
      // A torn/corrupt line does not hide the surrounding valid measurements.
    }
  }
  return buildInsights(snapshots, { ...options, windowSize });
}

/** Deterministic, side-effect-free measurement of the current shared thread. */
export async function measureConversationQualityNow(
  options: MeasureConversationQualityOptions = {},
): Promise<ConversationQualitySnapshot | null> {
  const result = await runConversationImprovementCycle({
    mode: 'dry',
    ...(options.readConversation ? { readConversation: options.readConversation } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
  if (!result) return null;
  return snapshotFrom({
    at: result.at,
    overallScore: result.report.overallScore,
    passes: result.report.passes,
    dimensions: result.report.dimensions,
    issues: result.report.issues,
    relationalSafety: result.report.relationalSafety,
    metrics: result.report.metrics,
  });
}
