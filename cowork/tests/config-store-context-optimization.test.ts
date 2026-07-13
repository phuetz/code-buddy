import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-config-store-context-optimization.json';

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = { ...(options?.defaults || {}) };
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key as string] as T[K];
    }

    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') {
        this.store[key] = value;
        return;
      }
      this.store = { ...this.store, ...key };
    }
  }
  return { default: MockStore };
});

import { ConfigStore } from '../src/main/config/config-store';

describe('ConfigStore context optimization', () => {
  const original = process.env.CODEBUDDY_LM_RESIZER;

  afterEach(() => {
    if (original === undefined) delete process.env.CODEBUDDY_LM_RESIZER;
    else process.env.CODEBUDDY_LM_RESIZER = original;
  });

  it('defaults Cowork to automatic recoverable optimization and persists opt-out', () => {
    const store = new ConfigStore();

    expect(store.get('contextOptimizationMode')).toBe('auto');
    expect(store.getAll().contextOptimizationMode).toBe('auto');

    store.update({ contextOptimizationMode: 'off' });

    expect(store.get('contextOptimizationMode')).toBe('off');
    expect(store.getAll().contextOptimizationMode).toBe('off');
  });

  it('maps the Cowork preference to the core lm-resizer runtime flag', () => {
    const store = new ConfigStore();

    store.applyToEnv();
    expect(process.env.CODEBUDDY_LM_RESIZER).toBe('true');

    store.update({ contextOptimizationMode: 'off' });
    store.applyToEnv();
    expect(process.env.CODEBUDDY_LM_RESIZER).toBe('false');
  });

  it('keeps the global preference isolated from concurrent provider config sets', () => {
    const store = new ConfigStore();
    const withSecondSet = store.createSet({ name: 'Second provider', mode: 'clone' });
    const configSetsBefore = structuredClone(withSecondSet.configSets);
    const setIds = configSetsBefore.map((set) => set.id);

    store.update({ contextOptimizationMode: 'off' });

    expect(store.getAll().configSets).toEqual(configSetsBefore);
    for (const setId of setIds) {
      expect(store.getConfigForSet(setId).contextOptimizationMode).toBe('off');
    }
  });
});
