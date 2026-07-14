import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CostBridge } from '../cost/cost-bridge';

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    electronMocks.handlers.set(channel, handler);
  }),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: electronMocks.handle },
}));

import { registerCostIpcHandlers } from './cost-ipc';

function handler(channel: string): (...args: unknown[]) => unknown {
  const registered = electronMocks.handlers.get(channel);
  if (!registered) throw new Error(`Missing IPC handler: ${channel}`);
  return registered;
}

describe('cost IPC', () => {
  beforeEach(() => {
    electronMocks.handlers.clear();
    electronMocks.handle.mockClear();
  });

  it('persists a valid monthly budget through the bridge', async () => {
    const setBudget = vi.fn().mockResolvedValue(true);
    const bridge = { setBudget } as unknown as CostBridge;
    registerCostIpcHandlers({ getCostBridge: () => bridge });

    await expect(handler('cost.setBudget')({}, 42)).resolves.toEqual({ success: true });
    expect(setBudget).toHaveBeenCalledWith(42);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1_000_001])(
    'rejects an invalid monthly budget: %s',
    async (limit) => {
      const getCostBridge = vi.fn<() => CostBridge | null>();
      registerCostIpcHandlers({ getCostBridge });

      await expect(handler('cost.setBudget')({}, limit)).resolves.toMatchObject({ success: false });
      expect(getCostBridge).not.toHaveBeenCalled();
    }
  );

  it('reports a persistence failure instead of claiming success', async () => {
    const bridge = { setDailyLimit: vi.fn().mockResolvedValue(false) } as unknown as CostBridge;
    registerCostIpcHandlers({ getCostBridge: () => bridge });

    await expect(handler('cost.setDailyLimit')({}, 5)).resolves.toEqual({
      success: false,
      error: 'Daily limit could not be persisted',
    });
  });
});
