export const completeFiche = {
  schemaVersion: 1,
  lane: 'usage',
  problem: {
    statement: 'The context benchmark misses the required answer.',
    evidence: { kind: 'capability-benchmark', reference: 'run-42/case-7', observedAt: '2026-09-26T10:00:00.000Z' },
  },
  research: { articleId: 'arxiv:2605.01664', method: 'Contextual reranking' },
  feature: { id: 'context-rag', files: ['src/context/context-manager-v2.ts'] },
  hypothesis: { metric: 'recall_at_5', direction: 'increase', minimumImprovement: 0.05 },
  comparison: {
    currentMethod: 'Existing ranker', proposedMethod: 'Contextual reranking',
    equalBudget: { runsPerArm: 5, maxDurationMsPerArm: 60000, maxCostUsdPerArm: 0.1 },
  },
  acceptance: { minResult: 0.8, maxDurationMs: 120000, maxCostUsd: 0.2 },
} as const;
