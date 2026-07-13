import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const config = {
    gateway: {
      tunnel: {
        enabled: true,
        type: 'ngrok',
        ngrok: { authToken: 'test-token', region: 'eu' },
      },
    },
  };
  const close = vi.fn(async () => {});
  const listener = {
    url: vi.fn(() => 'https://assistant.example.ngrok.app'),
    close,
  };
  const forward = vi.fn(async () => listener);
  const disconnect = vi.fn(async () => {});

  return { close, config, disconnect, forward, listener };
});

vi.mock('@ngrok/ngrok', () => ({
  default: {
    forward: mocks.forward,
    disconnect: mocks.disconnect,
  },
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../src/main/remote/remote-config-store', () => ({
  remoteConfigStore: {
    getAll: vi.fn(() => mocks.config),
  },
}));

describe('TunnelManager', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.config.gateway.tunnel.enabled = true;
    mocks.config.gateway.tunnel.ngrok.authToken = 'test-token';
    mocks.listener.url.mockReturnValue('https://assistant.example.ngrok.app');

    const { tunnelManager } = await import('../src/main/remote/tunnel-manager');
    await tunnelManager.stop();
    vi.clearAllMocks();
  });

  it('opens one ngrok listener and reports its public endpoint', async () => {
    const { tunnelManager } = await import('../src/main/remote/tunnel-manager');
    const statuses: unknown[] = [];
    tunnelManager.setStatusCallback((status) => statuses.push(status));

    await expect(tunnelManager.start(18789)).resolves.toBe(
      'https://assistant.example.ngrok.app'
    );
    expect(mocks.forward).toHaveBeenCalledOnce();
    expect(mocks.forward).toHaveBeenCalledWith(
      expect.objectContaining({ addr: 18789, authtoken: 'test-token', region: 'eu' })
    );
    expect(tunnelManager.getStatus()).toEqual({
      connected: true,
      url: 'https://assistant.example.ngrok.app',
      provider: 'ngrok',
    });
    expect(tunnelManager.getWebhookUrl()).toBe(
      'https://assistant.example.ngrok.app/webhook/feishu'
    );
    expect(statuses).toContainEqual(tunnelManager.getStatus());
  });

  it('disconnects the original URL even when close immediately emits closed', async () => {
    const { tunnelManager } = await import('../src/main/remote/tunnel-manager');
    await tunnelManager.start(18789);

    const options = mocks.forward.mock.calls[0]?.[0];
    mocks.close.mockImplementationOnce(async () => {
      options?.onStatusChange?.('closed');
    });

    await tunnelManager.stop();

    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.disconnect).toHaveBeenCalledWith('https://assistant.example.ngrok.app');
    expect(tunnelManager.getStatus()).toEqual({
      connected: false,
      url: null,
      provider: 'none',
    });
  });

  it('does not contact ngrok when tunnels are disabled', async () => {
    mocks.config.gateway.tunnel.enabled = false;
    const { tunnelManager } = await import('../src/main/remote/tunnel-manager');

    await expect(tunnelManager.start(18789)).resolves.toBeNull();
    expect(mocks.forward).not.toHaveBeenCalled();
  });
});
