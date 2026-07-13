import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  userData: '',
  requestConfirmation: vi.fn(async () => ({ confirmed: true })),
  invokeTool: vi.fn(async () => ({ success: true, durationMs: 2, result: 'ok' })),
  saveServer: vi.fn(),
  updateServer: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => state.userData },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      state.handlers.set(channel, handler);
    }),
  },
}));

vi.mock('../src/main/mcp/mcp-config-store', () => ({
  mcpConfigStore: {
    getServers: () => [{ id: 'slack', name: 'Slack', type: 'stdio', command: 'slack', enabled: true }],
    getServer: () => undefined,
    saveServer: state.saveServer,
    deleteServer: vi.fn(),
    getOAuthState: () => undefined,
    getPresets: () => ({}),
  },
}));

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(async () => ({
    ConfirmationService: {
      getInstance: () => ({ requestConfirmation: state.requestConfirmation }),
    },
  })),
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

import { registerMcpIpcHandlers } from '../src/main/ipc/mcp-ipc';

describe('AgentBase IPC', () => {
  beforeAll(() => {
    state.userData = mkdtempSync(join(tmpdir(), 'agentbase-ipc-'));
    mkdirSync(join(state.userData, '.codebuddy'));
    writeFileSync(join(state.userData, '.codebuddy', 'mcp.json'), JSON.stringify({
      mcpServers: {
        'code-explorer': {
          type: 'stdio',
          command: '/usr/bin/true',
          env: { API_TOKEN: '${API_TOKEN}', LOG_LEVEL: 'silent' },
          enabled: true,
        },
      },
    }));
    const manager = {
      getServerStatus: () => [{ id: 'slack', status: 'connected' }],
      getTools: () => [{ name: 'mcp__Slack__send_message', serverId: 'slack' }],
      updateServer: state.updateServer,
      removeServer: vi.fn(),
      clearOAuthTokens: vi.fn(),
    };
    registerMcpIpcHandlers({
      getSessionManager: () => ({
        getMCPManager: () => manager,
        invalidateMcpServersCache: vi.fn(),
      } as never),
      getMarketplaceBridge: () => ({
        list: () => [{ id: 'slack', name: 'Slack', installed: true, installedServerId: 'slack' }],
        invokeTool: state.invokeTool,
      } as never),
      getWorkspaceRoots: () => [state.userData],
    });
  });

  afterAll(() => rmSync(state.userData, { recursive: true, force: true }));

  it('exposes honest connector discovery', async () => {
    const handler = state.handlers.get('agentbase.list');
    expect(handler).toBeDefined();
    const result = await handler!({}) as Array<{ id: string; status: string; installed: boolean }>;
    expect(result[0]).toMatchObject({ id: 'slack', status: 'connected', installed: true });
  });

  it('routes legacy playground calls through permission and forcePrompt confirmation', async () => {
    const setPermissions = state.handlers.get('agentbase.setPermissions');
    await setPermissions!({}, 'slack', { external: true });
    const invoke = state.handlers.get('mcp.invokeTool');
    const result = await invoke!({}, 'mcp__Slack__send_message', { channel: 'general' });
    expect(result).toMatchObject({ success: true });
    expect(state.requestConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ forcePrompt: true }),
      'file'
    );
    expect(state.invokeTool).toHaveBeenCalledWith('mcp__Slack__send_message', { channel: 'general' });
  });

  it('discovers Code Buddy MCP entries secret-free and imports them disabled', async () => {
    const discovery = await state.handlers.get('agentbase.discoverCodeBuddy')!({}) as {
      ok: boolean;
      candidates: Array<{ id: string; name: string; secretEnvKeys: string[] }>;
    };
    expect(discovery.ok).toBe(true);
    expect(discovery.candidates).toEqual([
      expect.objectContaining({ name: 'code-explorer', secretEnvKeys: ['API_TOKEN'] }),
    ]);
    expect(JSON.stringify(discovery)).not.toContain('${API_TOKEN}');

    const result = await state.handlers.get('agentbase.importCodeBuddy')!(
      {},
      discovery.candidates[0]!.id,
    );
    expect(result).toMatchObject({ ok: true, imported: { name: 'code-explorer', enabled: false } });
    expect(state.saveServer).toHaveBeenCalledWith(expect.objectContaining({
      name: 'code-explorer',
      enabled: false,
      env: { LOG_LEVEL: 'silent' },
    }));
    // Import is persistence-only. Runtime transport code is not invoked until
    // the user explicitly enables the reviewed connector later.
    expect(state.updateServer).not.toHaveBeenCalled();
  });
});
