import { describe, expect, it, vi } from 'vitest';
import { buildModelInventory, summarizeInventoryByProvider } from '../../src/fleet/model-inventory.js';

vi.mock('../../src/fleet/capability-registry.js', () => ({
  getLocalCapabilities: vi.fn(async () => ({
    machineLabel: 'workstation',
    machineSpec: { cpu: 'Ryzen 9', gpu: 'RTX 4090', ramGb: 128 },
    models: [
      {
        id: 'local-model',
        provider: 'lm-studio',
        contextWindow: 8192,
        strengths: ['tool-calling'],
      },
      {
        id: 'gpt-5.5',
        provider: 'chatgpt-oauth',
        contextWindow: 200000,
        strengths: ['reasoning', 'tool-calling'],
      },
    ],
  })),
}));

vi.mock('../../src/integrations/tailscale.js', () => ({
  TailscaleManager: {
    getInstance: () => ({
      discoverOllamaPeers: vi.fn(async () => [
        {
          hostname: 'gpuNode',
          ip: '192.0.2.42',
          baseURL: 'http://192.0.2.42:11434/v1',
          models: ['qwen3.6:35b-a3b-q4_K_M', 'phi4:latest'],
        },
      ]),
    }),
  },
}));

vi.mock('../../src/agent/model-benchmark.js', () => ({
  loadBenchmarkScoreMap: vi.fn(async () => new Map<string, number>([
    ['http://localhost:1234/v1::local-model', 55],
    ['https://chatgpt.com/backend-api/codex::gpt-5.5', 98],
    ['http://192.0.2.42:11434/v1::qwen3.6:35b-a3b-q4_K_M', 91],
  ])),
}));

describe('model inventory', () => {
  it('merges local capabilities, machine data, and tailnet peers', async () => {
    const snapshot = await buildModelInventory({ includeTailnetPeers: true, env: {} });

    expect(snapshot.machineLabel).toBe('workstation');
    expect(snapshot.entries.length).toBeGreaterThanOrEqual(4);

    const grouped = summarizeInventoryByProvider(snapshot);
    expect(grouped['lm-studio']?.[0]?.machineLabel).toBe('workstation');
    expect(grouped['chatgpt-oauth']?.[0]?.executionLocation).toBe('cloud');
    expect(grouped.ollama?.some((entry) => entry.machineLabel === 'gpuNode')).toBe(true);
  });

  it('annotates launch hints, best-for tags, and benchmark scores', async () => {
    const snapshot = await buildModelInventory({ includeTailnetPeers: true, env: {} });
    const local = snapshot.entries.find((entry) => entry.model === 'local-model');
    const remote = snapshot.entries.find((entry) => entry.model === 'qwen3.6:35b-a3b-q4_K_M');

    expect(local).toMatchObject({
      provider: 'lm-studio',
      executionLocation: 'local',
      benchmarkScore: 55,
    });
    expect(local?.launchHint).toContain('LM Studio');
    expect(local?.bestFor).toContain('coding');

    expect(remote).toMatchObject({
      provider: 'ollama',
      executionLocation: 'lan',
      benchmarkScore: 91,
    });
    expect(remote?.launchHint).toContain('gpuNode');
    expect(remote?.bestFor).toContain('coding');
  });
});
