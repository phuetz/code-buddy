import { describe, expect, it, vi } from 'vitest';

type IpcHandler = (...args: unknown[]) => unknown;

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, IpcHandler>();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: IpcHandler) => {
        handlers.set(channel, handler);
      }),
    },
  };
});

const serverBridgeMock = vi.hoisted(() => ({
  factoryCalls: 0,
  getServerBridge: vi.fn(),
  status: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: electronMock.ipcMain,
}));

vi.mock('../src/main/server/server-bridge', () => {
  serverBridgeMock.factoryCalls += 1;
  return {
    getServerBridge: serverBridgeMock.getServerBridge,
  };
});

import { registerMobileSupervisionIpcHandlers } from '../src/main/ipc/mobile-supervision-ipc';

describe('registerMobileSupervisionIpcHandlers', () => {
  it('lazy-loads ServerBridge only when a mobile supervision handler runs', async () => {
    expect(serverBridgeMock.factoryCalls).toBe(0);

    serverBridgeMock.status.mockResolvedValue({
      running: false,
      port: null,
      host: null,
      startedAt: null,
      websocket: false,
      error: null,
    });
    serverBridgeMock.getServerBridge.mockReturnValue({ status: serverBridgeMock.status });

    registerMobileSupervisionIpcHandlers();

    expect(serverBridgeMock.factoryCalls).toBe(0);

    const handler = electronMock.handlers.get('mobileSupervision.status');
    expect(handler).toBeDefined();

    const result = await handler?.({});

    expect(serverBridgeMock.factoryCalls).toBe(1);
    expect(serverBridgeMock.getServerBridge).toHaveBeenCalledTimes(1);
    expect(serverBridgeMock.status).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ running: false, port: null });
  });
});
