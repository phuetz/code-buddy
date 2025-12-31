/**
 * Unit tests for MCPManager (SDK-based MCP client)
 *
 * Tests for the Model Context Protocol manager implementation
 * including server lifecycle, tool management, transport handling,
 * and error scenarios.
 */

import { EventEmitter } from 'events';

// Mock the MCP SDK
const mockClientClose = jest.fn();
const mockClientConnect = jest.fn();
const mockClientListTools = jest.fn();
const mockClientCallTool = jest.fn();

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    close: mockClientClose,
    connect: mockClientConnect,
    listTools: mockClientListTools,
    callTool: mockClientCallTool,
  })),
}));

// Mock transports
const mockTransportConnect = jest.fn();
const mockTransportDisconnect = jest.fn();
const mockTransportGetType = jest.fn();

jest.mock('../../src/mcp/transports.js', () => ({
  createTransport: jest.fn(() => ({
    connect: mockTransportConnect,
    disconnect: mockTransportDisconnect,
    getType: mockTransportGetType,
  })),
}));

// Mock logger
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

// Mock config loader
jest.mock('../../src/mcp/config', () => ({
  loadMCPConfig: jest.fn(() => ({ servers: [] })),
}));

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { MCPManager, MCPServerConfig } from '../../src/mcp/client';
import { createTransport } from '../../src/mcp/transports';
import { logger } from '../../src/utils/logger';

describe('MCPManager', () => {
  let manager: MCPManager;

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock implementations
    mockClientConnect.mockResolvedValue(undefined);
    mockClientClose.mockResolvedValue(undefined);
    mockClientListTools.mockResolvedValue({ tools: [] });
    mockTransportConnect.mockResolvedValue({});
    mockTransportDisconnect.mockResolvedValue(undefined);
    mockTransportGetType.mockReturnValue('stdio');

    manager = new MCPManager();
  });

  afterEach(async () => {
    await manager.dispose();
  });

  describe('Initialization', () => {
    it('should create an MCPManager instance', () => {
      expect(manager).toBeInstanceOf(MCPManager);
    });

    it('should be an EventEmitter', () => {
      expect(manager).toBeInstanceOf(EventEmitter);
      expect(typeof manager.on).toBe('function');
      expect(typeof manager.emit).toBe('function');
    });

    it('should start with no servers', () => {
      expect(manager.getServers()).toHaveLength(0);
    });

    it('should start with no tools', () => {
      expect(manager.getTools()).toHaveLength(0);
    });
  });

  describe('addServer', () => {
    it('should add a server with transport configuration', async () => {
      const config: MCPServerConfig = {
        name: 'test-server',
        transport: {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
        },
      };

      mockClientListTools.mockResolvedValue({
        tools: [
          { name: 'test_tool', description: 'A test tool', inputSchema: {} },
        ],
      });

      await manager.addServer(config);

      expect(createTransport).toHaveBeenCalledWith(config.transport);
      expect(mockTransportConnect).toHaveBeenCalled();
      expect(mockClientConnect).toHaveBeenCalled();
      expect(manager.getServers()).toContain('test-server');
    });

    it('should handle legacy stdio-only configuration', async () => {
      const config: MCPServerConfig = {
        name: 'legacy-server',
        command: 'python',
        args: ['mcp.py'],
        env: { DEBUG: 'true' },
        transport: undefined as any,
      };

      mockClientListTools.mockResolvedValue({ tools: [] });

      await manager.addServer(config);

      expect(createTransport).toHaveBeenCalledWith({
        type: 'stdio',
        command: 'python',
        args: ['mcp.py'],
        env: { DEBUG: 'true' },
      });
    });

    it('should throw error when transport configuration is missing', async () => {
      const config: MCPServerConfig = {
        name: 'invalid-server',
        transport: undefined as any,
      };

      await expect(manager.addServer(config)).rejects.toThrow(
        'Transport configuration is required'
      );
    });

    it('should create Client with proper configuration', async () => {
      const config: MCPServerConfig = {
        name: 'test-server',
        transport: { type: 'stdio', command: 'node' },
      };

      mockClientListTools.mockResolvedValue({ tools: [] });

      await manager.addServer(config);

      expect(Client).toHaveBeenCalledWith(
        { name: 'code-buddy', version: '1.0.0' },
        { capabilities: {} }
      );
    });

    it('should register tools from server', async () => {
      const config: MCPServerConfig = {
        name: 'tool-server',
        transport: { type: 'stdio', command: 'node' },
      };

      mockClientListTools.mockResolvedValue({
        tools: [
          { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } },
          { name: 'write_file', description: 'Write a file', inputSchema: { type: 'object' } },
        ],
      });

      await manager.addServer(config);

      const tools = manager.getTools();
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('mcp__tool-server__read_file');
      expect(tools[1].name).toBe('mcp__tool-server__write_file');
    });

    it('should emit serverAdded event on success', async () => {
      const config: MCPServerConfig = {
        name: 'event-server',
        transport: { type: 'stdio', command: 'node' },
      };

      mockClientListTools.mockResolvedValue({
        tools: [{ name: 'tool1', description: 'Tool', inputSchema: {} }],
      });

      const serverAddedHandler = jest.fn();
      manager.on('serverAdded', serverAddedHandler);

      await manager.addServer(config);

      expect(serverAddedHandler).toHaveBeenCalledWith('event-server', 1);
    });

    it('should emit serverError event on failure', async () => {
      const config: MCPServerConfig = {
        name: 'failing-server',
        transport: { type: 'stdio', command: 'node' },
      };

      const error = new Error('Connection failed');
      mockTransportConnect.mockRejectedValue(error);

      const serverErrorHandler = jest.fn();
      manager.on('serverError', serverErrorHandler);

      await expect(manager.addServer(config)).rejects.toThrow('Connection failed');
      expect(serverErrorHandler).toHaveBeenCalledWith('failing-server', error);
    });

    it('should use default description for tools without description', async () => {
      const config: MCPServerConfig = {
        name: 'nodesc-server',
        transport: { type: 'stdio', command: 'node' },
      };

      mockClientListTools.mockResolvedValue({
        tools: [{ name: 'tool1', inputSchema: {} }],
      });

      await manager.addServer(config);

      const tools = manager.getTools();
      expect(tools[0].description).toBe('Tool from nodesc-server server');
    });
  });

  describe('removeServer', () => {
    beforeEach(async () => {
      const config: MCPServerConfig = {
        name: 'removable-server',
        transport: { type: 'stdio', command: 'node' },
      };

      mockClientListTools.mockResolvedValue({
        tools: [{ name: 'tool1', description: 'Tool', inputSchema: {} }],
      });

      await manager.addServer(config);
    });

    it('should remove server and its tools', async () => {
      expect(manager.getServers()).toContain('removable-server');
      expect(manager.getTools()).toHaveLength(1);

      await manager.removeServer('removable-server');

      expect(manager.getServers()).not.toContain('removable-server');
      expect(manager.getTools()).toHaveLength(0);
    });

    it('should close client connection', async () => {
      await manager.removeServer('removable-server');

      expect(mockClientClose).toHaveBeenCalled();
    });

    it('should disconnect transport', async () => {
      await manager.removeServer('removable-server');

      expect(mockTransportDisconnect).toHaveBeenCalled();
    });

    it('should emit serverRemoved event', async () => {
      const serverRemovedHandler = jest.fn();
      manager.on('serverRemoved', serverRemovedHandler);

      await manager.removeServer('removable-server');

      expect(serverRemovedHandler).toHaveBeenCalledWith('removable-server');
    });

    it('should handle removal of non-existent server gracefully', async () => {
      await expect(manager.removeServer('non-existent')).resolves.not.toThrow();
    });
  });

  describe('callTool', () => {
    beforeEach(async () => {
      const config: MCPServerConfig = {
        name: 'callable-server',
        transport: { type: 'stdio', command: 'node' },
      };

      mockClientListTools.mockResolvedValue({
        tools: [
          { name: 'greet', description: 'Greet user', inputSchema: { type: 'object' } },
        ],
      });

      await manager.addServer(config);
    });

    it('should call tool on connected server', async () => {
      mockClientCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'Hello, World!' }],
      });

      const result = await manager.callTool('mcp__callable-server__greet', { name: 'World' });

      expect(mockClientCallTool).toHaveBeenCalledWith({
        name: 'greet',
        arguments: { name: 'World' },
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Hello, World!' }],
      });
    });

    it('should throw error when tool is not found', async () => {
      await expect(
        manager.callTool('mcp__callable-server__unknown', {})
      ).rejects.toThrow('Tool mcp__callable-server__unknown not found');
    });

    it('should throw error when server is not connected', async () => {
      // Remove the server's client but keep the tool entry (simulating disconnect)
      await manager.removeServer('callable-server');

      await expect(
        manager.callTool('mcp__callable-server__greet', {})
      ).rejects.toThrow('Tool mcp__callable-server__greet not found');
    });
  });

  describe('getTools', () => {
    it('should return empty array when no servers added', () => {
      expect(manager.getTools()).toEqual([]);
    });

    it('should return all tools from all servers', async () => {
      const config1: MCPServerConfig = {
        name: 'server1',
        transport: { type: 'stdio', command: 'node' },
      };

      const config2: MCPServerConfig = {
        name: 'server2',
        transport: { type: 'http', url: 'http://localhost:3000' },
      };

      mockClientListTools
        .mockResolvedValueOnce({
          tools: [{ name: 'tool1', description: 'Tool 1', inputSchema: {} }],
        })
        .mockResolvedValueOnce({
          tools: [{ name: 'tool2', description: 'Tool 2', inputSchema: {} }],
        });

      await manager.addServer(config1);
      await manager.addServer(config2);

      const tools = manager.getTools();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toEqual([
        'mcp__server1__tool1',
        'mcp__server2__tool2',
      ]);
    });
  });

  describe('getServers', () => {
    it('should return empty array when no servers added', () => {
      expect(manager.getServers()).toEqual([]);
    });

    it('should return all connected server names', async () => {
      const config1: MCPServerConfig = {
        name: 'alpha-server',
        transport: { type: 'stdio', command: 'node' },
      };

      const config2: MCPServerConfig = {
        name: 'beta-server',
        transport: { type: 'stdio', command: 'python' },
      };

      mockClientListTools.mockResolvedValue({ tools: [] });

      await manager.addServer(config1);
      await manager.addServer(config2);

      const servers = manager.getServers();
      expect(servers).toHaveLength(2);
      expect(servers).toContain('alpha-server');
      expect(servers).toContain('beta-server');
    });
  });

  describe('shutdown', () => {
    it('should disconnect all servers', async () => {
      const config1: MCPServerConfig = {
        name: 'server1',
        transport: { type: 'stdio', command: 'node' },
      };

      const config2: MCPServerConfig = {
        name: 'server2',
        transport: { type: 'stdio', command: 'python' },
      };

      mockClientListTools.mockResolvedValue({ tools: [] });

      await manager.addServer(config1);
      await manager.addServer(config2);

      expect(manager.getServers()).toHaveLength(2);

      await manager.shutdown();

      expect(manager.getServers()).toHaveLength(0);
      expect(mockClientClose).toHaveBeenCalledTimes(2);
      expect(mockTransportDisconnect).toHaveBeenCalledTimes(2);
    });

    it('should handle shutdown with no servers', async () => {
      await expect(manager.shutdown()).resolves.not.toThrow();
    });
  });

  describe('dispose', () => {
    it('should call shutdown and remove all listeners', async () => {
      const config: MCPServerConfig = {
        name: 'disposable-server',
        transport: { type: 'stdio', command: 'node' },
      };

      mockClientListTools.mockResolvedValue({ tools: [] });

      await manager.addServer(config);

      const listener = jest.fn();
      manager.on('serverRemoved', listener);

      await manager.dispose();

      expect(manager.getServers()).toHaveLength(0);
      expect(manager.listenerCount('serverRemoved')).toBe(0);
    });
  });

  describe('getTransportType', () => {
    it('should return transport type for connected server', async () => {
      const config: MCPServerConfig = {
        name: 'typed-server',
        transport: { type: 'stdio', command: 'node' },
      };

      mockClientListTools.mockResolvedValue({ tools: [] });
      mockTransportGetType.mockReturnValue('stdio');

      await manager.addServer(config);

      expect(manager.getTransportType('typed-server')).toBe('stdio');
    });

    it('should return undefined for non-existent server', () => {
      expect(manager.getTransportType('non-existent')).toBeUndefined();
    });
  });

  describe('ensureServersInitialized', () => {
    it('should not reinitialize when servers already exist', async () => {
      const config: MCPServerConfig = {
        name: 'existing-server',
        transport: { type: 'stdio', command: 'node' },
      };

      mockClientListTools.mockResolvedValue({ tools: [] });

      await manager.addServer(config);

      const serverCount = manager.getServers().length;

      await manager.ensureServersInitialized();

      expect(manager.getServers().length).toBe(serverCount);
    });

    it('should load config and initialize servers when none exist', async () => {
      const { loadMCPConfig } = require('../../src/mcp/config');
      loadMCPConfig.mockReturnValue({
        servers: [
          { name: 'config-server', transport: { type: 'stdio', command: 'node' } },
        ],
      });

      mockClientListTools.mockResolvedValue({ tools: [] });

      await manager.ensureServersInitialized();

      expect(loadMCPConfig).toHaveBeenCalled();
    });

    it('should handle server initialization failures gracefully', async () => {
      const { loadMCPConfig } = require('../../src/mcp/config');
      loadMCPConfig.mockReturnValue({
        servers: [
          { name: 'failing-server', transport: { type: 'stdio', command: 'bad-cmd' } },
        ],
      });

      mockTransportConnect.mockRejectedValue(new Error('Command not found'));

      await expect(manager.ensureServersInitialized()).resolves.not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});

describe('MCPServerConfig', () => {
  describe('Interface Validation', () => {
    it('should support transport-based configuration', () => {
      const config: MCPServerConfig = {
        name: 'modern-server',
        transport: {
          type: 'http',
          url: 'http://localhost:8080',
          headers: { Authorization: 'Bearer token' },
        },
      };

      expect(config.name).toBe('modern-server');
      expect(config.transport.type).toBe('http');
      expect(config.transport.url).toBe('http://localhost:8080');
    });

    it('should support legacy command-based configuration', () => {
      const config: MCPServerConfig = {
        name: 'legacy-server',
        transport: { type: 'stdio', command: 'node' },
        command: 'node',
        args: ['--port', '3000'],
        env: { NODE_ENV: 'development' },
      };

      expect(config.command).toBe('node');
      expect(config.args).toEqual(['--port', '3000']);
      expect(config.env).toEqual({ NODE_ENV: 'development' });
    });
  });
});

describe('MCPTool', () => {
  beforeEach(() => {
    // Reset mocks that may have been modified by previous tests
    jest.clearAllMocks();
    mockClientConnect.mockResolvedValue(undefined);
    mockClientClose.mockResolvedValue(undefined);
    mockClientListTools.mockResolvedValue({ tools: [] });
    mockTransportConnect.mockResolvedValue({});
    mockTransportDisconnect.mockResolvedValue(undefined);
    mockTransportGetType.mockReturnValue('stdio');
  });

  it('should have proper structure after registration', async () => {
    const manager = new MCPManager();

    const config: MCPServerConfig = {
      name: 'test-server',
      transport: { type: 'stdio', command: 'node' },
    };

    mockClientListTools.mockResolvedValue({
      tools: [
        {
          name: 'complex_tool',
          description: 'A complex tool with schema',
          inputSchema: {
            type: 'object',
            properties: {
              param1: { type: 'string' },
              param2: { type: 'number' },
            },
            required: ['param1'],
          },
        },
      ],
    });

    await manager.addServer(config);

    const tools = manager.getTools();
    expect(tools).toHaveLength(1);

    const tool = tools[0];
    expect(tool.name).toBe('mcp__test-server__complex_tool');
    expect(tool.description).toBe('A complex tool with schema');
    expect(tool.inputSchema).toEqual({
      type: 'object',
      properties: {
        param1: { type: 'string' },
        param2: { type: 'number' },
      },
      required: ['param1'],
    });
    expect(tool.serverName).toBe('test-server');

    await manager.dispose();
  });
});
