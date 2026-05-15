import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const gatewayStart = vi.fn(async () => {});

  class MockGateway {
    public running = false;
    start = gatewayStart;
    stop = vi.fn();
    on = vi.fn();
    setMessageInterceptor = vi.fn();
    registerChannel = vi.fn();
    getStatus = vi.fn(() => ({
      running: false,
      channels: [],
      activeSessions: 0,
      pendingPairings: 0,
    }));
  }

  return {
    gatewayStart,
    MockGateway,
  };
});

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../src/main/remote/gateway', () => ({
  RemoteGateway: mocks.MockGateway,
}));

vi.mock('../src/main/remote/remote-config-store', () => ({
  remoteConfigStore: {
    getAll: vi.fn(() => ({
      gateway: {
        enabled: true,
        port: 18789,
        bind: '127.0.0.1',
        auth: { mode: 'allowlist', allowlist: [] },
      },
      channels: {
        telegram: {
          type: 'telegram',
          botToken: 'token',
          dm: { policy: 'open' },
        },
      },
    })),
    getPairedUsers: vi.fn(() => []),
  },
}));

vi.mock('../src/main/remote/tunnel-manager', () => ({
  tunnelManager: {
    start: vi.fn(),
    stop: vi.fn(),
    getStatus: vi.fn(() => ({ connected: false })),
    getWebhookUrl: vi.fn(() => null),
  },
  TunnelStatus: {},
}));

vi.mock('../src/main/remote/channels/feishu', () => ({
  FeishuChannel: vi.fn(),
}));

vi.mock('../src/main/remote/message-router', () => ({
  MessageRouter: class {
    onResponse = vi.fn();
    setAgentCallback = vi.fn();
    setWorkingDirectoryValidator = vi.fn();
    setDefaultWorkingDirectory = vi.fn();
    getActiveSessionCount = vi.fn(() => 0);
    getAllSessionMappings = vi.fn(() => []);
    clearSession = vi.fn(() => false);
  },
}));

describe('RemoteManager unsupported channels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails startup instead of silently ignoring configured unsupported channels', async () => {
    const { RemoteManager } = await import('../src/main/remote/remote-manager');
    const manager = new RemoteManager();

    await expect(manager.start()).rejects.toThrow('Remote channel(s) not implemented: telegram');
    expect(mocks.gatewayStart).not.toHaveBeenCalled();
  });
});
