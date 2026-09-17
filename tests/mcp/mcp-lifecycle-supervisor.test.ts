/** Independent pilot review oracles: preserve real retry, reject late discovery after removal.
 * SDK/transport are controlled here; real OAuth loopback is covered separately by Grok.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MCPManager, type MCPServerConfig } from '../../src/mcp/client.js';

const sdk = vi.hoisted(() => ({ connect: vi.fn(), listTools: vi.fn(), close: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class { constructor() { return sdk; } },
}));
vi.mock('../../src/mcp/transports.js', () => ({
  createTransport: () => ({
    connect: vi.fn().mockResolvedValue({}),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getType: () => 'stdio',
  }),
}));
vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const config: MCPServerConfig = {
  name: 'pilot-lifecycle', transport: { type: 'stdio', command: 'fixture-unused' },
  autoReconnect: true, maxRetries: 2,
};

describe('MCP lifecycle independent review', () => {
  let manager: MCPManager;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    sdk.connect.mockResolvedValue(undefined);
    sdk.listTools.mockResolvedValue({ tools: [] });
    sdk.close.mockResolvedValue(undefined);
    manager = new MCPManager();
  });
  afterEach(async () => {
    await manager.dispose();
    vi.useRealTimers();
  });

  it('reconnects after a genuine first connection failure without explicit removal', async () => {
    sdk.connect.mockRejectedValueOnce(new Error('transient fixture failure'));
    await expect(manager.addServer(config)).rejects.toThrow('transient fixture failure');
    expect(manager.getServerStatus(config.name)).toBe('error');
    await vi.advanceTimersByTimeAsync(1000);
    expect(sdk.connect).toHaveBeenCalledTimes(2);
    expect(manager.getServerStatus(config.name)).toBe('connected');
  });

  it('cancels an already scheduled retry when explicitly removed', async () => {
    sdk.connect.mockRejectedValueOnce(new Error('transient fixture failure'));
    await expect(manager.addServer(config)).rejects.toThrow();
    await manager.removeServer(config.name);
    await vi.advanceTimersByTimeAsync(5000);
    expect(sdk.connect).toHaveBeenCalledTimes(1);
    expect(manager.getServerStatus(config.name)).toBe('disconnected');
  });

  it('does not publish late tools or report connected after explicit removal', async () => {
    let publish!: (value: { tools: { name: string; inputSchema: { type: string } }[] }) => void;
    sdk.listTools.mockImplementationOnce(() => new Promise((resolve) => { publish = resolve; }));
    const added = vi.fn();
    manager.on('serverAdded', added);
    const connecting = manager.addServer(config).then(() => true, () => false);
    await vi.advanceTimersByTimeAsync(0);
    expect(sdk.listTools).toHaveBeenCalledTimes(1);
    await manager.removeServer(config.name);
    publish({ tools: [{ name: 'late', inputSchema: { type: 'object' } }] });
    expect(await connecting).toBe(false);
    expect(manager.getServerStatus(config.name)).toBe('disconnected');
    expect(manager.getTools()).toHaveLength(0);
    expect(added).not.toHaveBeenCalled();
  });
});
