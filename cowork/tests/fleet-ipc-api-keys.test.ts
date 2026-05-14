import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  createApiKey: vi.fn(),
  listApiKeys: vi.fn(),
  getApiKeyStorePath: vi.fn(() => '/tmp/server-api-keys.json'),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      state.handlers.set(channel, handler);
    }),
  },
}));

vi.mock('../src/main/ipc-main-bridge', () => ({
  sendToRenderer: vi.fn(),
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(async (relativePath: string) => {
    if (relativePath === 'server/auth/api-keys.js') {
      return {
        createApiKey: state.createApiKey,
        listApiKeys: state.listApiKeys,
        getApiKeyStorePath: state.getApiKeyStorePath,
      };
    }
    return null;
  }),
}));

import { registerFleetIpcHandlers } from '../src/main/ipc/fleet-ipc';

describe('fleet IPC API keys', () => {
  beforeEach(() => {
    state.handlers.clear();
    vi.clearAllMocks();
    state.createApiKey.mockReturnValue({
      key: 'cb_sk_plaintext',
      apiKey: {
        id: 'key-1',
        keyPreview: 'cb_sk_pl...text',
        name: 'Cowork Fleet key',
        userId: 'local',
        scopes: ['fleet:listen', 'peer:invoke'],
        active: true,
        createdAt: new Date('2026-05-14T10:00:00.000Z'),
      },
    });
    state.listApiKeys.mockReturnValue([
      {
        id: 'key-1',
        keyPreview: 'cb_sk_pl...text',
        name: 'Cowork Fleet key',
        userId: 'local',
        scopes: ['fleet:listen', 'peer:invoke'],
        active: true,
        createdAt: '2026-05-14T10:00:00.000Z',
      },
    ]);
  });

  it('creates a local Fleet-scoped server API key', async () => {
    registerFleetIpcHandlers(null);

    const handler = state.handlers.get('fleet.createApiKey');
    expect(handler).toBeDefined();

    const result = await handler?.({});

    expect(state.createApiKey).toHaveBeenCalledWith({
      name: 'Cowork Fleet key',
      userId: 'local',
      scopes: ['fleet:listen', 'peer:invoke'],
    });
    expect(result).toEqual({
      ok: true,
      key: 'cb_sk_plaintext',
      apiKey: {
        id: 'key-1',
        keyPreview: 'cb_sk_pl...text',
        name: 'Cowork Fleet key',
        userId: 'local',
        scopes: ['fleet:listen', 'peer:invoke'],
        active: true,
        createdAt: '2026-05-14T10:00:00.000Z',
        expiresAt: undefined,
        lastUsedAt: undefined,
      },
      store: '/tmp/server-api-keys.json',
    });
  });

  it('rejects non-Fleet scopes from the renderer bridge', async () => {
    registerFleetIpcHandlers(null);

    const handler = state.handlers.get('fleet.createApiKey');
    const result = await handler?.({}, { scopes: ['admin'] });

    expect(state.createApiKey).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: 'Unsupported Fleet API scope(s): admin',
    });
  });

  it('lists local Fleet keys without returning key hashes or plaintext keys', async () => {
    registerFleetIpcHandlers(null);

    const handler = state.handlers.get('fleet.listApiKeys');
    const result = await handler?.({}, { userId: 'local' });

    expect(state.listApiKeys).toHaveBeenCalledWith('local');
    expect(result).toEqual({
      ok: true,
      keys: [
        {
          id: 'key-1',
          keyPreview: 'cb_sk_pl...text',
          name: 'Cowork Fleet key',
          userId: 'local',
          scopes: ['fleet:listen', 'peer:invoke'],
          active: true,
          createdAt: '2026-05-14T10:00:00.000Z',
          expiresAt: undefined,
          lastUsedAt: undefined,
        },
      ],
      store: '/tmp/server-api-keys.json',
    });
  });
});
