// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CompanionConversationQuality } from '../src/renderer/components/companion/CompanionConversationQuality';
import type { CompanionConversationQualityInsights } from '../src/renderer/types';

const insights: CompanionConversationQualityInsights = {
  schemaVersion: 1,
  available: true,
  sampleCount: 4,
  windowSize: 30,
  latest: {
    at: 2_000,
    overallScore: 0.82,
    passes: true,
    dimensions: {
      responsiveness: 0.9,
      depth: 0.78,
      reasoning: 0.81,
      continuity: 0.86,
      variety: 0.75,
      balance: 0.8,
      attunement: 0.84,
      reciprocity: 0.79,
    },
    issues: ['repetitive'],
    relationalSafety: { score: 1, passes: true },
    metrics: {
      turnCount: 10,
      exchangeCount: 5,
      assistantQuestionRate: 0.2,
      averageAssistantSentences: 4,
      repeatedOpeningRate: 0.1,
      interTurnProgressionScore: 0.76,
      stalledProgressionRate: 0,
    },
  },
  trend: { direction: 'improving', scoreDelta: 0.08, passRate: 0.75 },
  recurringIssues: [{ issue: 'repetitive', count: 2 }],
  activeGuidance: {
    issue: 'repetitive',
    baselineScore: 0.7,
    appliedAt: 1_500,
    evaluationCount: 1,
  },
  privacy: { verbatimIncluded: false, fingerprintsIncluded: false },
};

describe('CompanionConversationQuality', () => {
  it('renders actionable aggregate quality without private dialogue', () => {
    const onMeasure = vi.fn();
    const { container } = render(
      <CompanionConversationQuality insights={insights} onMeasure={onMeasure} />,
    );

    expect(screen.getByText('82 %')).toBeTruthy();
    expect(screen.getByText('en progression')).toBeTruthy();
    expect(screen.getByText('répétition · 2')).toBeTruthy();
    expect(screen.getByText(/1\/3 vérification/)).toBeTruthy();
    expect(screen.getAllByRole('progressbar')).toHaveLength(8);
    expect(container.textContent).toContain('agrégats sans verbatim');
    expect(container.textContent).not.toContain('PRIVATE_DIALOGUE');

    fireEvent.click(screen.getByRole('button', { name: 'Mesurer maintenant' }));
    expect(onMeasure).toHaveBeenCalledOnce();
  });

  it('shows an honest empty state and disables a measurement in progress', () => {
    render(
      <CompanionConversationQuality
        insights={{
          ...insights,
          available: false,
          sampleCount: 0,
          latest: undefined,
          recurringIssues: [],
          trend: { direction: 'insufficient', scoreDelta: 0, passRate: 0 },
        }}
        busy
        onMeasure={() => undefined}
      />,
    );

    expect(screen.getByText(/Pas encore assez d’échanges complets/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mesure…' }).hasAttribute('disabled')).toBe(true);
  });
});
