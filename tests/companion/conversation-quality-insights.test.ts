import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  measureConversationQualityNow,
  readConversationQualityInsights,
} from '../../src/companion/conversation-quality-insights.js';

function aggregate(
  at: number,
  overallScore: number,
  passes: boolean,
  issues: string[],
): Record<string, unknown> {
  return {
    at,
    overallScore,
    passes,
    dimensions: {
      responsiveness: overallScore,
      depth: overallScore,
      reasoning: overallScore,
      continuity: overallScore,
      variety: overallScore,
      balance: overallScore,
      attunement: overallScore,
      reciprocity: overallScore,
    },
    relationalSafety: { score: 1, passes: true, privateDetail: 'SECRET_RELATIONSHIP_TEXT' },
    issues,
    metrics: {
      turnCount: 8,
      exchangeCount: 4,
      assistantQuestionRate: 0.25,
      averageAssistantSentences: 4,
      repeatedOpeningRate: 0,
      interTurnProgressionScore: overallScore,
      stalledProgressionRate: 1 - overallScore,
      privateTranscript: 'SECRET_TRANSCRIPT',
    },
    conversationFingerprint: 'SECRET_FINGERPRINT',
  };
}

describe('conversation quality insights', () => {
  it('builds a raw-free trend and recurring issue view from aggregate journal lines', () => {
    const directory = mkdtempSync(join(tmpdir(), 'quality-insights-'));
    const journalPath = join(directory, 'quality.jsonl');
    const statePath = join(directory, 'state.json');
    writeFileSync(journalPath, [
      JSON.stringify(aggregate(1_000, 0.55, false, ['too_shallow', 'PRIVATE_ISSUE'])),
      '{broken',
      JSON.stringify(aggregate(2_000, 0.72, true, ['too_shallow'])),
    ].join('\n'));
    writeFileSync(statePath, JSON.stringify({
      issueStreaks: { too_shallow: 2 },
      activeGuidance: {
        issue: 'too_shallow',
        text: 'SECRET_GUIDANCE_TEXT',
        baselineScore: 0.55,
        appliedAt: 1_500,
        evaluationCount: 1,
      },
    }));

    const insights = readConversationQualityInsights({ journalPath, statePath });

    expect(insights).toMatchObject({
      available: true,
      sampleCount: 2,
      trend: { direction: 'improving', passRate: 0.5 },
      recurringIssues: [{ issue: 'too_shallow', count: 2 }],
      activeGuidance: { issue: 'too_shallow', evaluationCount: 1 },
      privacy: { verbatimIncluded: false, fingerprintsIncluded: false },
    });
    expect(insights.trend.scoreDelta).toBeCloseTo(0.17);
    expect(insights.latest?.overallScore).toBe(0.72);
    expect(JSON.stringify(insights)).not.toContain('SECRET_');
    expect(JSON.stringify(insights)).not.toContain('PRIVATE_');
  });

  it('returns an honest empty state when no journal exists', () => {
    const directory = mkdtempSync(join(tmpdir(), 'quality-insights-empty-'));
    const insights = readConversationQualityInsights({
      journalPath: join(directory, 'missing.jsonl'),
      statePath: join(directory, 'missing-state.json'),
    });

    expect(insights.available).toBe(false);
    expect(insights.sampleCount).toBe(0);
    expect(insights.latest).toBeUndefined();
    expect(insights.trend.direction).toBe('insufficient');
  });

  it('measures the current shared thread without persisting or returning dialogue', async () => {
    const privateMarker = 'PRIVATE_CURRENT_DIALOGUE';
    const snapshot = await measureConversationQualityNow({
      now: 3_000,
      readConversation: async () => [
        { role: 'user', content: `${privateMarker} explique la conscience.` },
        { role: 'assistant', content: 'Je pose une thèse, une raison et une objection.' },
        { role: 'user', content: 'Continue cette analyse.' },
        { role: 'assistant', content: 'Je nuance la thèse puis je propose une synthèse.' },
      ],
    });

    expect(snapshot?.at).toBe(3_000);
    expect(snapshot?.metrics.exchangeCount).toBe(2);
    expect(JSON.stringify(snapshot)).not.toContain(privateMarker);
  });
});
