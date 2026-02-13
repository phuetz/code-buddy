/**
 * Tests for MCP Client implementations
 *
 * Tests both MCPManager (SDK-based) and MCPClient (manual/legacy)
 * covering initialization, server lifecycle, tool discovery/execution,
 * error handling, health checks, and reconnection logic.
 */

import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Mock the logger before any imports that use it
// ---------------------------------------------------------------------------
jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock the MCP SDK classes used by MCPManager (client.ts)
// ---------------------------------------------------------------------------
const mockListTools = jest.fn();
const mockCallTool = jest.fn();
const mockClientConnect = jest.fn();
const mockClientClose = jest.fn();

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    listTools: mockListTools,
    callTool: mockCallTool,
    connect: mockClientConnect,
    close: mockClientClose,
  })),
}));

// ---------------------------------------------------------------------------
// Mock transports used by MCPManager
// ---------------------------------------------------------------------------
const mockTransportConnect = jest.fn().mockResolvedValue({});
const mockTransportDisconnect = jest.fn().mockResolvedValue(undefined);
const mockTransportGetType = jest.fn().mockReturnValue('stdio');

jest.mock('../../src/mcp/transports', () => ({
  createTransport: jest.fn().mockImplementation(() => ({
    connect: mockTransportConnect,
    disconnect: mockTransportDisconnect,
    getType: mockTransportGetType,
  })),
}));

// ---------------------------------------------------------------------------
// Mock child_process for MCPClient (mcp-client.ts)
// ---------------------------------------------------------------------------
const mockStdinWrite = jest.fn().mockReturnValue(true);
const mockKill = jest.fn();

function createMockProcess(): EventEmitter & { stdin: any; stdout: EventEmitter; stderr: EventEmitter; kill: jest.Mock } {
  const proc = new EventEmitter() as any;
  proc.stdin = { write: mockStdinWrite };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = mockKill;
  proc.removeAllListeners = jest.fn();
  return proc;
}

let spawnedProcess: ReturnType<typeof createMockProcess>;

jest.mock('child_process', () => ({
  spawn: jest.fn().mockImplementation(() => {
    spawnedProcess = createMockProcess();
    // Simulate a successful initialization handshake on next tick
    process.nextTick(() => {
      // Respond to the initialize request (id: 1)
      const initResponse = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          serverInfo: { name: 'mock-server', version: '1.0.0' },
        },
      });
      spawnedProcess.stdout.emit('data', initResponse + '\n');
    });
    return spawnedProcess;
  }),
}));

// ---------------------------------------------------------------------------
// Mock fs for MCPClient config loading
// ---------------------------------------------------------------------------
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mock the types/index module for getErrorMessage
// ---------------------------------------------------------------------------
jest.mock('../../src/types/index', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { MCPManager } from '../../src/mcp/client';
import { MCPClient, getMCPClient, resetMCPClient } from '../../src/mcp/mcp-client';
import type { MCPServerConfig, MCPTool, ServerStatus } from '../../src/mcp/types';
import { createTransport } from '../../src/mcp/transports';
import fs from 'fs';

// ============================================================================
// MCPManager (SDK-based client) tests
// ============================================================================

describe('MCPManager', () => {
  let manager: MCPManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new MCPManager();
    mockListTools.mockResolvedValue({
      tools: [
        { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } },
        { name: 'write_file', description: 'Write a file', inputSchema: { type: 'object' } },
      ],
    });
  });

  afterEach(async () => {
    await manager.dispose();
  });

  // ---------- Initialization & Lifecycle ----------

  describe('addServer', () => {
    it('should connect to a server with transport config', async () => {
      const config: MCPServerConfig = {
        name: 'test-server',
        transport: { type: 'stdio', command: 'node', args: ['server.js'] },
      };

      await manager.addServer(config);

      expect(createTransport).toHaveBeenCalledWith(config.transport);
      expect(mockTransportConnect).toHaveBeenCalled();
      expect(mockClientConnect).toHaveBeenCalled();
      expect(manager.getServerStatus('test-server')).toBe('connected');
    });

    it('should support legacy stdio config (command/args at top level)', async () => {
      const config: MCPServerConfig = {
        name: 'legacy-server',
        transport: undefined as any,
        command: 'npx',
        args: ['-y', 'some-mcp-server'],
      };

      await manager.addServer(config);

      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'stdio', command: 'npx', args: ['-y', 'some-mcp-server'] })
      );
    });

    it('should throw if no transport config is provided', async () => {
      const config: MCPServerConfig = {
        name: 'bad-server',
        transport: undefined as any,
      };

      await expect(manager.addServer(config)).rejects.toThrow('Transport configuration is required');
      expect(manager.getServerStatus('bad-server')).toBe('error');
    });

    it('should register discovered tools with prefixed names', async () => {
      await manager.addServer({
        name: 'fs-server',
        transport: { type: 'stdio', command: 'node', args: [] },
      });

      const tools = manager.getTools();
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('mcp__fs-server__read_file');
      expect(tools[1].name).toBe('mcp__fs-server__write_file');
      expect(tools[0].serverName).toBe('fs-server');
    });

    it('should emit serverAdded event on successful connection', async () => {
      const listener = jest.fn();
      manager.on('serverAdded', listener);

      await manager.addServer({
        name: 'evt-server',
        transport: { type: 'stdio', command: 'node', args: [] },
      });

      expect(listener).toHaveBeenCalledWith('evt-server', 2);
    });

    it('should set status to error when connection fails', async () => {
      mockTransportConnect.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(
        manager.addServer({
          name: 'fail-server',
          transport: { type: 'http', url: 'http://localhost:9999' },
        })
      ).rejects.toThrow('Connection refused');

      expect(manager.getServerStatus('fail-server')).toBe('error');
    });
  });

  describe('removeServer', () => {
    it('should disconnect client, close transport, and remove tools', async () => {
      await manager.addServer({
        name: 'removable',
        transport: { type: 'stdio', command: 'node', args: [] },
      });
      expect(manager.getTools()).toHaveLength(2);

      await manager.removeServer('removable');

      expect(mockClientClose).toHaveBeenCalled();
      expect(mockTransportDisconnect).toHaveBeenCalled();
      expect(manager.getTools()).toHaveLength(0);
      expect(manager.getServers()).not.toContain('removable');
    });

    it('should emit serverRemoved event', async () => {
      await manager.addServer({
        name: 'rm-evt',
        transport: { type: 'stdio', command: 'node', args: [] },
      });

      const listener = jest.fn();
      manager.on('serverRemoved', listener);
      await manager.removeServer('rm-evt');

      expect(listener).toHaveBeenCalledWith('rm-evt');
    });

    it('should handle removing a server that does not exist gracefully', async () => {
      await expect(manager.removeServer('nonexistent')).resolves.toBeUndefined();
    });

    it('should set status to disconnected', async () => {
      await manager.addServer({
        name: 'disc-srv',
        transport: { type: 'stdio', command: 'node', args: [] },
      });

      await manager.removeServer('disc-srv');
      expect(manager.getServerStatus('disc-srv')).toBe('disconnected');
    });
  });

  // ---------- Tool Execution ----------

  describe('callTool', () => {
    it('should call tool on the correct server with original name', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'file contents here' }],
      });

      await manager.addServer({
        name: 'tool-server',
        transport: { type: 'stdio', command: 'node', args: [] },
      });

      const result = await manager.callTool('mcp__tool-server__read_file', { path: '/test.txt' });

      expect(mockCallTool).toHaveBeenCalledWith({
        name: 'read_file',
        arguments: { path: '/test.txt' },
      });
      expect(result).toEqual({ content: [{ type: 'text', text: 'file contents here' }] });
    });

    it('should throw if tool is not found', async () => {
      await expect(manager.callTool('mcp__missing__tool', {})).rejects.toThrow(
        'Tool mcp__missing__tool not found'
      );
    });

    it('should throw if server is not connected', async () => {
      // Manually add a tool entry pointing to a server that is not in the clients map
      (manager as any).tools.set('mcp__ghost__do_thing', {
        name: 'mcp__ghost__do_thing',
        description: 'phantom',
        inputSchema: {},
        serverName: 'ghost',
      });

      await expect(manager.callTool('mcp__ghost__do_thing', {})).rejects.toThrow(
        'Server ghost not connected'
      );
    });

    it('should propagate errors from the MCP SDK call', async () => {
      mockCallTool.mockRejectedValueOnce(new Error('Tool execution error'));

      await manager.addServer({
        name: 'err-srv',
        transport: { type: 'stdio', command: 'node', args: [] },
      });

      await expect(
        manager.callTool('mcp__err-srv__read_file', {})
      ).rejects.toThrow('Tool execution error');
    });
  });

  // ---------- Server Queries ----------

  describe('getServers', () => {
    it('should list connected server names', async () => {
      await manager.addServer({ name: 's1', transport: { type: 'stdio', command: 'a', args: [] } });
      await manager.addServer({ name: 's2', transport: { type: 'stdio', command: 'b', args: [] } });

      const servers = manager.getServers();
      expect(servers).toContain('s1');
      expect(servers).toContain('s2');
    });

    it('should return empty array when no servers are added', () => {
      expect(manager.getServers()).toEqual([]);
    });
  });

  describe('getServerStatus', () => {
    it('should return undefined for unknown server', () => {
      expect(manager.getServerStatus('unknown')).toBeUndefined();
    });
  });

  describe('getTransportType', () => {
    it('should return transport type for a connected server', async () => {
      await manager.addServer({ name: 'tt', transport: { type: 'stdio', command: 'x', args: [] } });
      expect(manager.getTransportType('tt')).toBe('stdio');
    });

    it('should return undefined for unknown server', () => {
      expect(manager.getTransportType('nope')).toBeUndefined();
    });
  });

  // ---------- Shutdown ----------

  describe('shutdown', () => {
    it('should remove all servers', async () => {
      await manager.addServer({ name: 'a', transport: { type: 'stdio', command: 'x', args: [] } });
      await manager.addServer({ name: 'b', transport: { type: 'stdio', command: 'y', args: [] } });

      await manager.shutdown();

      expect(manager.getServers()).toHaveLength(0);
      expect(manager.getTools()).toHaveLength(0);
    });
  });

  describe('dispose', () => {
    it('should shutdown and remove all listeners', async () => {
      const listener = jest.fn();
      manager.on('serverAdded', listener);

      await manager.addServer({ name: 'disp', transport: { type: 'stdio', command: 'x', args: [] } });
      await manager.dispose();

      expect(manager.getServers()).toHaveLength(0);
      expect(manager.listenerCount('serverAdded')).toBe(0);
    });
  });

  // ---------- Health Check & Reconnection ----------

  describe('health check', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should start health checks after connection', async () => {
      await manager.addServer({ name: 'hc', transport: { type: 'stdio', command: 'x', args: [] } });

      // listTools was called once during addServer for tool discovery
      expect(mockListTools).toHaveBeenCalledTimes(1);

      // Advance past one health-check interval (30s)
      jest.advanceTimersByTime(30000);
      // Allow async to flush
      await Promise.resolve();

      expect(mockListTools).toHaveBeenCalledTimes(2);
    });

    it('should stop health check when server is removed', async () => {
      await manager.addServer({ name: 'hc-rm', transport: { type: 'stdio', command: 'x', args: [] } });
      await manager.removeServer('hc-rm');

      mockListTools.mockClear();
      jest.advanceTimersByTime(60000);
      await Promise.resolve();

      expect(mockListTools).not.toHaveBeenCalled();
    });
  });

  describe('auto-reconnect', () => {
    it('should emit serverError event on connection failure in handleServerError', async () => {
      const listener = jest.fn();
      manager.on('serverError', listener);

      // Force an error via listTools failing during addServer
      mockListTools.mockRejectedValueOnce(new Error('list failed'));

      await expect(
        manager.addServer({ name: 'err-emit', transport: { type: 'stdio', command: 'x', args: [] } })
      ).rejects.toThrow();

      expect(listener).toHaveBeenCalledWith('err-emit', expect.any(Error));
    });
  });
});

// ============================================================================
// MCPClient (legacy manual client) tests
// ============================================================================

describe('MCPClient', () => {
  let client: MCPClient;

  beforeEach(async () => {
    jest.clearAllMocks();
    await resetMCPClient();
    client = new MCPClient();
  });

  afterEach(async () => {
    await client.dispose();
  });

  // ---------- Config Loading ----------

  describe('loadConfig', () => {
    it('should return empty array when no config files exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const configs = client.loadConfig();
      expect(configs).toEqual([]);
    });

    it('should load config from project-level file', () => {
      (fs.existsSync as jest.Mock).mockImplementation((path: string) => path.includes('.codebuddy'));
      (fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({
          servers: [
            { name: 'proj-server', command: 'node', args: ['server.js'] },
          ],
        })
      );

      const configs = client.loadConfig();
      expect(configs).toHaveLength(1);
      expect(configs[0].name).toBe('proj-server');
    });

    it('should return empty array for invalid config (servers not an array)', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ servers: 'not-an-array' }));

      const configs = client.loadConfig();
      expect(configs).toEqual([]);
    });

    it('should return empty array for unparseable JSON', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('{invalid json');

      const configs = client.loadConfig();
      expect(configs).toEqual([]);
    });
  });

  describe('saveConfig', () => {
    it('should write servers to config file', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const servers = [{ name: 'test', command: 'echo', args: [] }];
      client.saveConfig(servers);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('mcp-servers.json'),
        expect.stringContaining('"test"')
      );
    });

    it('should create directory if it does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      client.saveConfig([]);
      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    });

    it('should throw when write fails', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('EACCES');
      });

      expect(() => client.saveConfig([])).toThrow('Failed to save MCP configuration');
    });
  });

  // ---------- Connection Lifecycle ----------

  describe('connect', () => {
    it('should connect to a server and emit event', async () => {
      const listener = jest.fn();
      client.on('server-connected', listener);

      await client.connect({ name: 'conn-test', command: 'echo', args: [] });

      expect(client.isConnected('conn-test')).toBe(true);
      expect(listener).toHaveBeenCalledWith('conn-test');
    });

    it('should throw when connecting to an already-connected server', async () => {
      await client.connect({ name: 'dup', command: 'echo', args: [] });

      await expect(
        client.connect({ name: 'dup', command: 'echo', args: [] })
      ).rejects.toThrow('already connected');
    });
  });

  describe('disconnect', () => {
    it('should disconnect and emit event', async () => {
      await client.connect({ name: 'dc-test', command: 'echo', args: [] });

      const listener = jest.fn();
      client.on('server-disconnected', listener);
      await client.disconnect('dc-test');

      expect(client.isConnected('dc-test')).toBe(false);
      expect(listener).toHaveBeenCalledWith('dc-test');
    });

    it('should handle disconnecting a non-connected server gracefully', async () => {
      await expect(client.disconnect('missing')).resolves.toBeUndefined();
    });
  });

  describe('disconnectAll', () => {
    it('should disconnect all connected servers', async () => {
      await client.connect({ name: 's1', command: 'a', args: [] });
      await client.connect({ name: 's2', command: 'b', args: [] });

      await client.disconnectAll();

      expect(client.getConnectedServers()).toHaveLength(0);
    });
  });

  // ---------- Tool Discovery ----------

  describe('getAllTools', () => {
    it('should return tools from connected servers', async () => {
      await client.connect({ name: 'tool-srv', command: 'echo', args: [] });

      // Simulate the server responding to a tools/list request
      process.nextTick(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 2, // id 1 was used by initialize
          result: {
            tools: [
              { name: 'search', description: 'Search files', inputSchema: { type: 'object' } },
            ],
          },
        });
        spawnedProcess.stdout.emit('data', response + '\n');
      });

      const allTools = await client.getAllTools();
      expect(allTools.has('tool-srv')).toBe(true);
      const tools = allTools.get('tool-srv')!;
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('search');
    });
  });

  // ---------- Tool Execution ----------

  describe('callTool', () => {
    it('should throw if server is not connected', async () => {
      await expect(client.callTool('missing-server', 'tool', {})).rejects.toThrow(
        'not connected'
      );
    });

    it('should call tool on connected server and return result', async () => {
      await client.connect({ name: 'call-srv', command: 'echo', args: [] });

      const resultPromise = client.callTool('call-srv', 'read_file', { path: '/x' });

      // Respond to the tools/call request (id 2)
      process.nextTick(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: { content: [{ type: 'text', text: 'file data' }] },
        });
        spawnedProcess.stdout.emit('data', response + '\n');
      });

      const result = await resultPromise;
      expect(result).toEqual({ content: [{ type: 'text', text: 'file data' }] });
    });
  });

  // ---------- Resource Access ----------

  describe('readResource', () => {
    it('should throw if server is not connected', async () => {
      await expect(client.readResource('absent', 'file:///x')).rejects.toThrow('not connected');
    });
  });

  // ---------- Utility ----------

  describe('getConnectedServers', () => {
    it('should return list of connected server names', async () => {
      await client.connect({ name: 'u1', command: 'a', args: [] });
      expect(client.getConnectedServers()).toEqual(['u1']);
    });
  });

  describe('isConnected', () => {
    it('should return false for unknown server', () => {
      expect(client.isConnected('nope')).toBe(false);
    });
  });

  describe('formatStatus', () => {
    it('should show no servers message when none connected', () => {
      const status = client.formatStatus();
      expect(status).toContain('No MCP servers connected');
    });

    it('should list connected servers', async () => {
      await client.connect({ name: 'fmt-srv', command: 'echo', args: [] });
      const status = client.formatStatus();
      expect(status).toContain('fmt-srv');
    });
  });

  // ---------- Singleton ----------

  describe('getMCPClient / resetMCPClient', () => {
    it('should return the same singleton instance', () => {
      const a = getMCPClient();
      const b = getMCPClient();
      expect(a).toBe(b);
    });

    it('should create a new instance after reset', async () => {
      const before = getMCPClient();
      await resetMCPClient();
      const after = getMCPClient();
      expect(after).not.toBe(before);
    });
  });
});
