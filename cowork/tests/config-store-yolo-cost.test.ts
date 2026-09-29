import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_YOLO_SESSION_COST_USD, YOLO_SESSION_COST_HARD_CAP_USD } from '@codebuddy/config/session-cost-defaults';

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-config-store-yolo-cost.json';
    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = { ...(options?.defaults || {}) };
    }
    get<K extends keyof T>(key: K): T[K] { return this.store[key as string] as T[K]; }
    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') this.store[key] = value;
      else this.store = { ...this.store, ...key };
    }
  }
  return { default: MockStore };
});

import { ConfigStore } from '../src/main/config/config-store';

describe('Cowork YOLO cost config', () => {
  it('persists the shared default and a custom capped budget', () => {
    const store = new ConfigStore();
    expect(store.getAll().yoloMaxCostUsd).toBe(DEFAULT_YOLO_SESSION_COST_USD);
    store.update({ yoloMode: true, yoloMaxCostUsd: 42, yoloMaxRounds: 200 });
    expect(store.getAll()).toMatchObject({ yoloMode: true, yoloMaxCostUsd: 42, yoloMaxRounds: 200 });
    store.update({ yoloMaxCostUsd: 2000 });
    expect(store.getAll().yoloMaxCostUsd).toBe(YOLO_SESSION_COST_HARD_CAP_USD);
  });
});
