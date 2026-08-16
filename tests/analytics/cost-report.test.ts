import { describe, expect, it } from 'vitest';
import {
  aggregateCostReport,
  inferCostProvider,
  parseCostSince,
  type CostPricingResolver,
  type CostSessionEntry,
} from '../../src/analytics/cost-report.js';

const pricing: CostPricingResolver = (model) => {
  if (model === 'gpt-fixture') return { inputPerMillion: 2, outputPerMillion: 8 };
  if (model === 'claude-fixture') return { inputPerMillion: 3, outputPerMillion: 15 };
  return undefined;
};

function sessionFixtures(): CostSessionEntry[] {
  return [
    {
      id: 'session-openai',
      model: 'gpt-fixture',
      provider: 'openai',
      createdAt: '2026-08-10T08:00:00.000Z',
      lastAccessedAt: '2026-08-11T09:00:00.000Z',
      turns: [
        {
          timestamp: '2026-08-10T08:00:00.000Z',
          inputTokens: 1_000,
          outputTokens: 500,
          costUsd: 0.01,
        },
        {
          timestamp: '2026-08-11T09:00:00.000Z',
          inputTokens: 1_000_000,
          outputTokens: 100_000,
        },
      ],
    },
    {
      id: 'session-anthropic',
      model: 'claude-fixture',
      provider: 'anthropic',
      createdAt: '2026-08-11T10:00:00.000Z',
      lastAccessedAt: '2026-08-12T10:00:00.000Z',
      messages: [
        {
          type: 'user',
          content: 'Premier tour',
          timestamp: '2026-08-11T10:00:00.000Z',
        },
        {
          type: 'assistant',
          content: 'Réponse',
          timestamp: '2026-08-11T10:01:00.000Z',
          usage: {
            input_tokens: 2_000,
            completion_tokens: 1_000,
            cost: 0.02,
          },
        },
        {
          type: 'user',
          content: 'Second tour sans télémétrie',
          timestamp: '2026-08-12T10:00:00.000Z',
        },
        {
          type: 'assistant',
          content: 'Ancienne session : aucune donnée de coût',
          timestamp: '2026-08-12T10:01:00.000Z',
        },
      ],
    },
  ];
}

describe('aggregateCostReport', () => {
  it('aggregates cost, tokens and turns by model, provider and day', () => {
    const report = aggregateCostReport(sessionFixtures(), {
      now: new Date('2026-08-16T12:00:00.000Z'),
      resolvePricing: pricing,
    });

    expect(report.sessions).toBe(2);
    expect(report.turns).toBe(4);
    expect(report.totalCost).toBeCloseTo(2.83);
    expect(report.averageCostPerTurn).toBeCloseTo(0.7075);
    expect(report.tokens).toEqual({ input: 1_003_000, output: 101_500, unattributed: 0 });
    expect(report.estimatedCost).toBeCloseTo(2.8);
    expect(report.estimatedTurns).toBe(1);
    expect(report.unknownCostSessions).toBe(1);
    expect(report.unknownCostTurns).toBe(1);

    expect(report.byModel['gpt-fixture']?.cost).toBeCloseTo(2.81);
    expect(report.byModel['gpt-fixture']).toMatchObject({
      turns: 2,
      estimatedCost: 2.8,
      estimatedTurns: 1,
      unknownCostTurns: 0,
    });
    expect(report.byModel['gpt-fixture']?.tokens).toEqual({
      input: 1_001_000,
      output: 100_500,
      unattributed: 0,
    });
    expect(report.byProvider.anthropic).toMatchObject({
      cost: 0.02,
      turns: 2,
      unknownCostTurns: 1,
    });
    expect(report.byDay['2026-08-10']).toMatchObject({ cost: 0.01, turns: 1 });
    expect(report.byDay['2026-08-11']?.cost).toBeCloseTo(2.82);
    expect(report.byDay['2026-08-11']).toMatchObject({ turns: 2 });
    expect(report.byDay['2026-08-12']).toMatchObject({
      cost: 0,
      turns: 1,
      unknownCostTurns: 1,
    });
  });

  it('applies an inclusive calendar --since filter at turn granularity', () => {
    const report = aggregateCostReport(sessionFixtures(), {
      now: new Date('2026-08-16T12:00:00.000Z'),
      since: '2026-08-11',
      resolvePricing: pricing,
    });

    expect(report.since).toBe('2026-08-11T00:00:00.000Z');
    expect(report.sessions).toBe(2);
    expect(report.turns).toBe(3);
    expect(report.totalCost).toBeCloseTo(2.82);
    expect(report.byDay['2026-08-10']).toBeUndefined();
    expect(report.byModel['gpt-fixture']).toMatchObject({ cost: 2.8, turns: 1 });
  });

  it('supports rolling Nd filters using the injected clock', () => {
    const report = aggregateCostReport(
      [
        {
          id: 'rolling',
          model: 'gpt-fixture',
          turns: [
            { timestamp: '2026-08-09T11:59:59.000Z', cost: 1 },
            { timestamp: '2026-08-09T12:00:00.000Z', cost: 2 },
          ],
        },
      ],
      {
        now: new Date('2026-08-16T12:00:00.000Z'),
        since: '7d',
        resolvePricing: pricing,
      }
    );

    expect(report.since).toBe('2026-08-09T12:00:00.000Z');
    expect(report.turns).toBe(1);
    expect(report.totalCost).toBe(2);
  });

  it('estimates a missing cost from directional tokens and injected model pricing', () => {
    const report = aggregateCostReport(
      [
        {
          id: 'estimated',
          model: 'gpt-fixture',
          provider: 'openai',
          createdAt: '2026-08-15T12:00:00.000Z',
          metadata: {
            totalTokensIn: 2_000,
            totalTokensOut: 1_000,
          },
        },
      ],
      {
        now: new Date('2026-08-16T12:00:00.000Z'),
        resolvePricing: pricing,
      }
    );

    expect(report.totalCost).toBeCloseTo(0.012);
    expect(report.estimatedCost).toBeCloseTo(0.012);
    expect(report.estimatedTurns).toBe(1);
    expect(report.unknownCostSessions).toBe(0);
    expect(report.byProvider.openai?.estimatedCost).toBeCloseTo(0.012);
  });

  it('keeps explicit zero cost as known and flags truly missing costs', () => {
    const report = aggregateCostReport(
      [
        {
          id: 'free-session',
          model: 'qwen3:8b',
          provider: 'ollama',
          createdAt: '2026-08-15T08:00:00.000Z',
          turnCount: 2,
          metadata: { totalCost: 0, totalTokensIn: 400, totalTokensOut: 100 },
        },
        {
          id: 'legacy-unknown',
          model: 'mystery-model',
          createdAt: '2026-08-15T09:00:00.000Z',
          messages: [
            { type: 'user', content: 'bonjour', timestamp: '2026-08-15T09:00:00.000Z' },
            { type: 'assistant', content: 'salut', timestamp: '2026-08-15T09:01:00.000Z' },
          ],
        },
      ],
      { now: new Date('2026-08-16T12:00:00.000Z'), resolvePricing: pricing }
    );

    expect(report.sessions).toBe(2);
    expect(report.turns).toBe(3);
    expect(report.totalCost).toBe(0);
    expect(report.unknownCostSessions).toBe(1);
    expect(report.unknownCostTurns).toBe(1);
    expect(report.byProvider.ollama?.unknownCostTurns).toBe(0);
  });

  it('does not invent a turn for an empty initialized session', () => {
    const report = aggregateCostReport(
      [
        {
          id: 'empty',
          model: 'gpt-fixture',
          createdAt: '2026-08-15T08:00:00.000Z',
          metadata: { totalCost: 0, tokenCount: 0 },
          messages: [],
        },
      ],
      { now: new Date('2026-08-16T12:00:00.000Z'), resolvePricing: pricing }
    );

    expect(report.sessions).toBe(1);
    expect(report.turns).toBe(0);
    expect(report.totalCost).toBe(0);
    expect(report.unknownCostSessions).toBe(0);
  });
});

describe('cost report helpers', () => {
  it('validates supported --since syntax', () => {
    expect(parseCostSince('2026-08-01').toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(() => parseCostSince('0d')).toThrow('durée positive');
    expect(() => parseCostSince('2026-02-30')).toThrow('YYYY-MM-DD');
  });

  it('infers common provider families without overriding explicit providers', () => {
    expect(inferCostProvider('grok-4-latest')).toBe('grok');
    expect(inferCostProvider('claude-sonnet-4')).toBe('anthropic');
    expect(inferCostProvider('qwen3:8b')).toBe('ollama');
    expect(inferCostProvider('openai/gpt-oss-120b:free')).toBe('openrouter');
  });
});
