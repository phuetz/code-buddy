import { beforeEach, describe, expect, it, vi } from 'vitest';

const { manager, loadMCPConfig } = vi.hoisted(() => ({
  manager: {
    getServers: vi.fn(),
    addServer: vi.fn(),
    removeServer: vi.fn(),
    callTool: vi.fn(),
  },
  loadMCPConfig: vi.fn(),
}));

vi.mock('../../src/codebuddy/tools.js', () => ({ getMCPManager: () => manager }));
vi.mock('../../src/mcp/config.js', () => ({ loadMCPConfig }));

import {
  PubCommanderBridge,
  resolvePubCommanderServer,
} from '../../src/integrations/pubcommander-bridge.js';

describe('PubCommander bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    manager.getServers.mockReturnValue([]);
    manager.addServer.mockResolvedValue(undefined);
    manager.removeServer.mockResolvedValue(undefined);
    loadMCPConfig.mockReturnValue({
      servers: [
        { name: 'pubcommander', transport: { type: 'stdio', command: 'node' } },
        {
          name: 'custom-editorial',
          transport: {
            type: 'stdio',
            command: 'node',
            env: { PUBCOMMANDER_MCP_MODULES: 'editorial' },
          },
        },
      ],
    });
  });

  it('discovers a module from data instead of requiring a fixed server name', () => {
    expect(resolvePubCommanderServer('editorial')).toBe('custom-editorial');
    expect(resolvePubCommanderServer('core')).toBe('pubcommander');
  });

  it('connects temporarily and unwraps JSON text results', async () => {
    manager.callTool.mockResolvedValue({
      content: [{ type: 'text', text: '{"count":3}' }],
    });
    const bridge = new PubCommanderBridge();

    await expect(bridge.call('editorial', 'browse_editorial_library', { kind: 'pillars' }))
      .resolves.toEqual({ count: 3 });
    expect(manager.callTool).toHaveBeenCalledWith(
      'mcp__custom-editorial__browse_editorial_library',
      { kind: 'pillars' },
    );
    expect(manager.removeServer).toHaveBeenCalledWith('custom-editorial');
  });
});
