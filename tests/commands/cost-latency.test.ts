import { describe, expect, it } from 'vitest';
import { createCostCommand } from '../../src/commands/cost.js';
import type { TurnMetricsAggregate } from '../../src/observability/turn-metrics.js';

const aggregates: TurnMetricsAggregate[] = [
  {
    provider: 'ollama',
    model: 'qwen3:4b-instruct',
    turns: 4,
    ttftSamples: 4,
    ttftP50Ms: 120,
    ttftP95Ms: 190,
    ttfmSamples: 4,
    ttfmP50Ms: 640,
    ttfmP95Ms: 900,
    totalTokens: 88,
  },
];

describe('buddy cost --latency', () => {
  it('renders measured TTFT/TTFM percentiles without loading sessions', async () => {
    const output: string[] = [];
    await createCostCommand({
      loadSessions: async () => {
        throw new Error('cost sessions must not be loaded for latency view');
      },
      loadLatency: () => aggregates,
      stdout: (message) => output.push(message),
    })
      .exitOverride()
      .parseAsync(['node', 'cost', '--latency']);

    expect(output[0]).toContain('Latence LLM mesurée');
    expect(output[0]).toContain('qwen3:4b-instruct');
    expect(output[0]).toContain('120ms');
    expect(output[0]).toContain('190ms');
    expect(output[0]).toContain('640ms');
    expect(output[0]).toContain('900ms');
  });

  it('emits machine-readable latency JSON', async () => {
    const output: string[] = [];
    await createCostCommand({
      loadLatency: () => aggregates,
      stdout: (message) => output.push(message),
    })
      .exitOverride()
      .parseAsync(['node', 'cost', '--latency', '--json']);

    expect(JSON.parse(output[0] ?? '{}')).toMatchObject({
      metric: 'turn-latency',
      models: [{
        provider: 'ollama',
        model: 'qwen3:4b-instruct',
        ttftP50Ms: 120,
        ttfmP95Ms: 900,
      }],
    });
  });

  it('reports an empty journal clearly', async () => {
    const output: string[] = [];
    await createCostCommand({
      loadLatency: () => [],
      stdout: (message) => output.push(message),
    })
      .exitOverride()
      .parseAsync(['node', 'cost', '--latency']);

    expect(output).toEqual(['Aucune mesure de latence LLM enregistrée.']);
  });
});
