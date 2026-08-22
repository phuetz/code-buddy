/**
 * Active-LLM registry — OmniRoute gateway enrolment.
 *
 * OmniRoute (`authMode: 'local'` in the catalog, loopback proxy to 90+ cloud
 * free tiers) must behave like a probed runtime: ACTIVE only when its
 * `/v1/models` answered, NEVER when the gateway is absent — but reported as
 * NOT local (cloud inference) so privacy escape hatches skip it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const getLocalCapabilities = vi.fn();
vi.mock('../../src/fleet/capability-registry.js', () => ({
  getLocalCapabilities: (...args: unknown[]) => getLocalCapabilities(...args),
}));

vi.mock('../../src/providers/codex-oauth.js', () => ({
  hasCodexCredentials: () => false,
}));

vi.mock('../../src/providers/xai-oauth.js', () => ({
  hasXaiCredentials: () => false,
  getValidXaiAccessToken: async () => null,
}));

import { buildActiveLlmRegistry } from '../../src/providers/active-llm-registry.js';

beforeEach(() => {
  getLocalCapabilities.mockReset();
  getLocalCapabilities.mockResolvedValue({ models: [] });
});

describe('buildActiveLlmRegistry — OmniRoute gateway', () => {
  it('enrols omniroute when the gateway answered the probe: $0, cloud (not local), catalog default combo', async () => {
    getLocalCapabilities.mockResolvedValue({
      models: [
        { id: 'auto/best-free', provider: 'omniroute', egress: 'cloud' },
        { id: 'nvidia/nemotron-3-nano', provider: 'omniroute', egress: 'cloud' },
      ],
    });

    const reg = await buildActiveLlmRegistry({ env: {} });
    const omni = reg.all.find((p) => p.provider === 'omniroute');
    expect(omni).toBeDefined();
    expect(omni!.model).toBe('auto/best-free');
    expect(omni!.baseURL).toBe('http://localhost:20128/v1');
    expect(omni!.apiKey).toBe('omniroute');
    expect(omni!.costInputUsdPerMtok).toBe(0);
    expect(omni!.isLocal).toBe(false);
    expect(omni!.priority).toBe(23);
  });

  it('keeps the OMNIROUTE_MODEL / OMNIROUTE_BASE_URL overrides (the gateway routes any id it lists)', async () => {
    getLocalCapabilities.mockResolvedValue({
      models: [{ id: 'auto/best-free', provider: 'omniroute', egress: 'cloud' }],
    });

    const reg = await buildActiveLlmRegistry({
      env: {
        OMNIROUTE_MODEL: 'auto/best-coding',
        OMNIROUTE_BASE_URL: 'omni.lan:20128',
        OMNIROUTE_API_KEY: 'sk-omni',
      },
    });
    const omni = reg.all.find((p) => p.provider === 'omniroute');
    expect(omni).toMatchObject({
      model: 'auto/best-coding',
      baseURL: 'http://omni.lan:20128/v1',
      apiKey: 'sk-omni',
    });
  });

  it('does NOT enrol omniroute when the gateway is absent (probe returned nothing)', async () => {
    getLocalCapabilities.mockResolvedValue({ models: [] });
    const reg = await buildActiveLlmRegistry({ env: { OMNIROUTE_BASE_URL: 'http://localhost:20128/v1' } });
    expect(reg.all.find((p) => p.provider === 'omniroute')).toBeUndefined();
  });

  it('does NOT enrol omniroute when the probe itself fails (never blocks the registry)', async () => {
    getLocalCapabilities.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:20128'));
    const reg = await buildActiveLlmRegistry({ env: {} });
    expect(reg.all.find((p) => p.provider === 'omniroute')).toBeUndefined();
  });

  it('localOnly (privacy) excludes the gateway even when reachable — inference leaves the box', async () => {
    getLocalCapabilities.mockResolvedValue({
      models: [
        { id: 'auto/best-free', provider: 'omniroute', egress: 'cloud' },
        { id: 'qwen3:8b', provider: 'ollama', egress: 'local' },
      ],
    });

    const reg = await buildActiveLlmRegistry({ env: {}, localOnly: true });
    expect(reg.all.map((p) => p.provider)).toContain('ollama');
    expect(reg.all.map((p) => p.provider)).not.toContain('omniroute');
  });

  it('resilience ordering: omniroute sits with the cloud providers, before the on-box runtimes', async () => {
    getLocalCapabilities.mockResolvedValue({
      models: [
        { id: 'qwen3:8b', provider: 'ollama', egress: 'local' },
        { id: 'auto/best-free', provider: 'omniroute', egress: 'cloud' },
      ],
    });

    const reg = await buildActiveLlmRegistry({ env: { GROK_API_KEY: 'xai-k' } });
    const order = reg.fallbacks.map((p) => p.provider);
    expect(order.indexOf('omniroute')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('omniroute')).toBeLessThan(order.indexOf('ollama'));
  });
});
