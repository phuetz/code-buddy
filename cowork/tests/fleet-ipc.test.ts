import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMock.handle,
  },
}));

vi.mock('../src/main/fleet/saga-runner', () => ({
  SagaRunner: class {
    start = vi.fn();
  },
}));

vi.mock('../src/main/ipc-main-bridge', () => ({
  sendToRenderer: vi.fn(),
}));

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { registerFleetIpcHandlers } from '../src/main/ipc/fleet-ipc';
import type { FleetBridge } from '../src/main/fleet/fleet-bridge';

describe('registerFleetIpcHandlers', () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.handle.mockClear();
  });

  it('wires manual Fleet capability refresh through IPC', async () => {
    const refreshCapabilities = vi.fn(async (peerId?: string) => ({
      success: true,
      peer: peerId ? { id: peerId } : undefined,
    }));
    const bridge = { refreshCapabilities } as unknown as FleetBridge;

    registerFleetIpcHandlers(bridge);

    const handler = electronMock.handlers.get('fleet.refreshCapabilities');
    expect(handler).toBeDefined();

    const result = await handler?.({}, 'ministar-linux');
    expect(refreshCapabilities).toHaveBeenCalledWith('ministar-linux');
    expect(result).toEqual({ success: true, peer: { id: 'ministar-linux' } });
  });

  it('returns a structured refresh error when FleetBridge is unavailable', async () => {
    registerFleetIpcHandlers(null);

    const handler = electronMock.handlers.get('fleet.refreshCapabilities');
    expect(handler).toBeDefined();

    await expect(handler?.({})).resolves.toEqual({
      success: false,
      error: 'FleetBridge not initialized',
    });
  });
});
