import { afterEach, describe, expect, it, vi } from 'vitest';

const sandboxMock = vi.hoisted(() => ({
  bootstrapFactoryCalls: 0,
  configGet: vi.fn(),
  nativeInitialize: vi.fn(),
  nativeShutdown: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: class BrowserWindow {},
  dialog: {
    showMessageBox: vi.fn(),
  },
}));

vi.mock('../src/main/config/config-store', () => ({
  configStore: {
    get: sandboxMock.configGet,
  },
}));

vi.mock('../src/main/sandbox/native-executor', () => ({
  NativeExecutor: class NativeExecutor {
    initialize = sandboxMock.nativeInitialize;
    shutdown = sandboxMock.nativeShutdown;
  },
}));

vi.mock('../src/main/sandbox/wsl-bridge', () => ({
  WSLBridge: class WSLBridge {},
  pathConverter: {
    toWSL: (path: string) => path,
    toWindows: (path: string) => path,
  },
}));

vi.mock('../src/main/sandbox/lima-bridge', () => ({
  LimaBridge: class LimaBridge {},
  limaPathConverter: {
    toWSL: (path: string) => path,
    toWindows: (path: string) => path,
  },
}));

vi.mock('../src/main/sandbox/sandbox-bootstrap', () => {
  sandboxMock.bootstrapFactoryCalls += 1;
  return {
    getSandboxBootstrap: vi.fn(),
  };
});

import { initializeSandbox, shutdownSandbox } from '../src/main/sandbox/sandbox-adapter';

describe('sandbox-adapter bootstrap loading', () => {
  afterEach(async () => {
    await shutdownSandbox();
    sandboxMock.configGet.mockReset();
    sandboxMock.nativeInitialize.mockReset();
    sandboxMock.nativeShutdown.mockReset();
  });

  it('does not load sandbox-bootstrap when sandbox is disabled', async () => {
    sandboxMock.configGet.mockReturnValue(false);

    expect(sandboxMock.bootstrapFactoryCalls).toBe(0);

    const adapter = await initializeSandbox({ workspacePath: 'D:\\workspace' });

    expect(adapter.mode).toBe('native');
    expect(sandboxMock.nativeInitialize).toHaveBeenCalledTimes(1);
    expect(sandboxMock.bootstrapFactoryCalls).toBe(0);
  });
});
