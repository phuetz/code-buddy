import { describe, it, expect, vi } from 'vitest';
import { buildAggregatorClientGetter } from '../src/main/fleet/aggregator-wiring';

class FakeClient {
  constructor(
    public apiKey: string,
    public model?: string,
    public baseURL?: string,
  ) {}
}

describe('buildAggregatorClientGetter', () => {
  it('builds a client from config when an API key is present', () => {
    const configStore = { getAll: () => ({ apiKey: 'sk-test', model: 'grok-4', baseUrl: 'https://x' }) };
    const getter = buildAggregatorClientGetter(configStore, FakeClient);
    const client = getter() as FakeClient;
    expect(client).toBeInstanceOf(FakeClient);
    expect(client.apiKey).toBe('sk-test');
    expect(client.model).toBe('grok-4');
    expect(client.baseURL).toBe('https://x');
  });

  it('returns null when no API key is configured (aggregator falls back to concat)', () => {
    const prev = process.env.GROK_API_KEY;
    delete process.env.GROK_API_KEY;
    try {
      const configStore = { getAll: () => ({ model: 'grok-4' }) };
      const getter = buildAggregatorClientGetter(configStore, FakeClient);
      expect(getter()).toBeNull();
    } finally {
      if (prev !== undefined) process.env.GROK_API_KEY = prev;
    }
  });

  it('is lazy — re-reads config on every call (picks up a model switch)', () => {
    let model = 'grok-4';
    const configStore = { getAll: vi.fn(() => ({ apiKey: 'sk', model })) };
    const getter = buildAggregatorClientGetter(configStore, FakeClient);
    expect((getter() as FakeClient).model).toBe('grok-4');
    model = 'claude-opus-4-7';
    expect((getter() as FakeClient).model).toBe('claude-opus-4-7');
    expect(configStore.getAll).toHaveBeenCalledTimes(2);
  });
});
