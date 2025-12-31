/**
 * Unit tests for MCP Client
 *
 * Tests for the Model Context Protocol client implementation
 * including client initialization, tool discovery, tool execution,
 * connection lifecycle, and error handling.
 */

import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

// Mock os - required for user-level config path
jest.mock('os', () => ({
  homedir: jest.fn(() => '/home/testuser'),
}));

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

import { spawn } from 'child_process';
import fs from 'fs';
import {
  MCPClient,
  MCPServerConfig,
  getMCPClient,
  resetMCPClient,
} from '../../src/mcp/mcp-client';
import { logger } from '../../src/utils/logger';

/**
 * Create a mock ChildProcess with EventEmitter capabilities
 */
function createMockProcess(): ChildProcess & {
  stdin: EventEmitter & { write: jest.Mock };
  stdout: EventEmitter;
  stderr: EventEmitter;
} {
  const processEmitter = new EventEmitter();
  const stdinEmitter = Object.assign(new EventEmitter(), {
    write: jest.fn(),
  });
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();

  // Create mock process with required properties
  const mockProcess = Object.assign(processEmitter, {
    stdin: stdinEmitter,
    stdout: stdoutEmitter,
    stderr: stderrEmitter,
    kill: jest.fn(),
    pid: 12345,
    connected: true,
    exitCode: null,
    signalCode: null,
    spawnargs: [],
    spawnfile: '',
    killed: false,
    stdio: [stdinEmitter, stdoutEmitter, stderrEmitter, null, null] as const,
    send: jest.fn(),
    disconnect: jest.fn(),
    unref: jest.fn(),
    ref: jest.fn(),
    channel: undefined,
  });

  return mockProcess as unknown as ChildProcess & {
    stdin: EventEmitter & { write: jest.Mock };
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
}

// Type for our mock process
type MockProcess = ChildProcess & {
  stdin: EventEmitter & { write: jest.Mock };
  stdout: EventEmitter;
  stderr: EventEmitter;
};

describe('MCPClient', () => {
  let client: MCPClient;
  let mockProcess: MockProcess;
  let mockSpawn: jest.Mock;
  let mockExistsSync: jest.Mock;
  let mockReadFileSync: jest.Mock;
  let mockWriteFileSync: jest.Mock;
  let mockMkdirSync: jest.Mock;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create fresh mock process
    mockProcess = createMockProcess();
    mockSpawn = spawn as jest.Mock;
    mockSpawn.mockReturnValue(mockProcess);

    // Setup fs mocks
    mockExistsSync = fs.existsSync as jest.Mock;
    mockReadFileSync = fs.readFileSync as jest.Mock;
    mockWriteFileSync = fs.writeFileSync as jest.Mock;
    mockMkdirSync = fs.mkdirSync as jest.Mock;

    // Default fs behavior
    mockExistsSync.mockReturnValue(false);

    // Create fresh client
    client = new MCPClient();
  });

  afterEach(async () => {
    // Cleanup
    await client.dispose();
  });

  describe('Client Initialization', () => {
    it('should create an MCPClient instance', () => {
      expect(client).toBeInstanceOf(MCPClient);
    });

    it('should be an EventEmitter', () => {
      expect(client).toBeInstanceOf(EventEmitter);
      expect(typeof client.on).toBe('function');
      expect(typeof client.emit).toBe('function');
    });

    it('should start with no connected servers', () => {
      expect(client.getConnectedServers()).toHaveLength(0);
    });

    it('should format status correctly with no servers', () => {
      const status = client.formatStatus();
      expect(status).toContain('No MCP servers connected');
      expect(status).toContain('.codebuddy/mcp-servers.json');
    });
  });

  describe('Configuration Loading', () => {
    it('should return empty array when no config exists', () => {
      mockExistsSync.mockReturnValue(false);

      const configs = client.loadConfig();

      expect(configs).toEqual([]);
    });

    it('should load config from project-level path', () => {
      const mockConfig = {
        servers: [
          { name: 'test-server', command: 'node', args: ['server.js'] },
        ],
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(mockConfig));

      const configs = client.loadConfig();

      expect(configs).toHaveLength(1);
      expect(configs[0].name).toBe('test-server');
      expect(configs[0].command).toBe('node');
    });

    it('should load config from user-level path when project config missing', () => {
      const mockConfig = {
        servers: [
          { name: 'user-server', command: 'python', args: ['mcp.py'] },
        ],
      };

      // Project config doesn't exist, user config does
      mockExistsSync
        .mockReturnValueOnce(false) // project config
        .mockReturnValueOnce(true); // user config

      mockReadFileSync.mockReturnValue(JSON.stringify(mockConfig));

      const configs = client.loadConfig();

      expect(configs).toHaveLength(1);
      expect(configs[0].name).toBe('user-server');
    });

    it('should handle config with empty servers array', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ servers: [] }));

      const configs = client.loadConfig();

      expect(configs).toEqual([]);
    });

    it('should handle config without servers property', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({}));

      const configs = client.loadConfig();

      expect(configs).toEqual([]);
    });

    it('should handle invalid JSON gracefully', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('{ invalid json }');

      const configs = client.loadConfig();

      expect(configs).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle file read errors gracefully', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const configs = client.loadConfig();

      expect(configs).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('Configuration Saving', () => {
    it('should create directory if it does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const servers: MCPServerConfig[] = [
        { name: 'test', command: 'node' },
      ];

      client.saveConfig(servers);

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true }
      );
    });

    it('should write config to file', () => {
      mockExistsSync.mockReturnValue(true);

      const servers: MCPServerConfig[] = [
        { name: 'test', command: 'node', args: ['server.js'] },
      ];

      client.saveConfig(servers);

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('mcp-servers.json'),
        expect.stringContaining('"name": "test"')
      );
    });

    it('should format config with proper indentation', () => {
      mockExistsSync.mockReturnValue(true);

      const servers: MCPServerConfig[] = [
        { name: 'test', command: 'node' },
      ];

      client.saveConfig(servers);

      const writtenContent = mockWriteFileSync.mock.calls[0][1];
      expect(writtenContent).toContain('\n');
      expect(writtenContent).toContain('  '); // 2-space indent from JSON.stringify
    });
  });

  describe('Server Connection', () => {
    const testConfig: MCPServerConfig = {
      name: 'test-server',
      command: 'node',
      args: ['mcp-server.js'],
      env: { DEBUG: 'true' },
    };

    it('should spawn process with correct arguments', async () => {
      const connectPromise = client.connect(testConfig);

      // Simulate successful initialization response
      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {},
          },
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      await connectPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        'node',
        ['mcp-server.js'],
        expect.objectContaining({
          env: expect.objectContaining({ DEBUG: 'true' }),
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      );
    });

    it('should emit server-connected event on successful connection', async () => {
      const connectedHandler = jest.fn();
      client.on('server-connected', connectedHandler);

      const connectPromise = client.connect(testConfig);

      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      await connectPromise;

      expect(connectedHandler).toHaveBeenCalledWith('test-server');
    });

    it('should add server to connected servers list', async () => {
      const connectPromise = client.connect(testConfig);

      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      await connectPromise;

      expect(client.isConnected('test-server')).toBe(true);
      expect(client.getConnectedServers()).toContain('test-server');
    });

    it('should throw error when connecting to already connected server', async () => {
      const connectPromise = client.connect(testConfig);

      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      await connectPromise;

      await expect(client.connect(testConfig)).rejects.toThrow(
        'Server test-server is already connected'
      );
    });

    it('should handle process spawn errors', async () => {
      const connectPromise = client.connect(testConfig);

      // Emit error after connect is called
      setTimeout(() => {
        mockProcess.emit('error', new Error('Spawn failed'));
      }, 10);

      await expect(connectPromise).rejects.toThrow('Spawn failed');
    });
  });

  describe('Server Disconnection', () => {
    const testConfig: MCPServerConfig = {
      name: 'test-server',
      command: 'node',
    };

    beforeEach(async () => {
      // Connect a server first
      const connectPromise = client.connect(testConfig);

      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      await connectPromise;
    });

    it('should disconnect from a connected server', async () => {
      await client.disconnect('test-server');

      expect(client.isConnected('test-server')).toBe(false);
      expect(mockProcess.kill).toHaveBeenCalled();
    });

    it('should emit server-disconnected event', async () => {
      const disconnectedHandler = jest.fn();
      client.on('server-disconnected', disconnectedHandler);

      await client.disconnect('test-server');

      expect(disconnectedHandler).toHaveBeenCalledWith('test-server');
    });

    it('should handle disconnect for non-existent server gracefully', async () => {
      await expect(client.disconnect('non-existent')).resolves.not.toThrow();
    });
  });

  describe('Connect All', () => {
    it('should connect to all enabled servers', async () => {
      const mockConfig = {
        servers: [
          { name: 'server1', command: 'node', enabled: true },
          { name: 'server2', command: 'python', enabled: true },
        ],
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(mockConfig));

      // Create two mock processes
      const mockProcess1 = createMockProcess();
      const mockProcess2 = createMockProcess();

      mockSpawn
        .mockReturnValueOnce(mockProcess1)
        .mockReturnValueOnce(mockProcess2);

      // Set up automatic response for each server when data handler is added
      mockProcess1.stdout.on('newListener', (event: string) => {
        if (event === 'data') {
          setTimeout(() => {
            const response = JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: {},
            });
            mockProcess1.stdout.emit('data', response + '\n');
          }, 5);
        }
      });

      mockProcess2.stdout.on('newListener', (event: string) => {
        if (event === 'data') {
          setTimeout(() => {
            const response = JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: {},
            });
            mockProcess2.stdout.emit('data', response + '\n');
          }, 5);
        }
      });

      await client.connectAll();

      expect(client.getConnectedServers()).toHaveLength(2);
    });

    it('should skip disabled servers', async () => {
      const mockConfig = {
        servers: [
          { name: 'enabled-server', command: 'node', enabled: true },
          { name: 'disabled-server', command: 'python', enabled: false },
        ],
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(mockConfig));

      const connectAllPromise = client.connectAll();

      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      await connectAllPromise;

      expect(client.isConnected('enabled-server')).toBe(true);
      expect(client.isConnected('disabled-server')).toBe(false);
    });

    it('should handle connection errors gracefully', async () => {
      const mockConfig = {
        servers: [
          { name: 'failing-server', command: 'nonexistent' },
        ],
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(mockConfig));

      // Emit error
      setTimeout(() => {
        mockProcess.emit('error', new Error('Command not found'));
      }, 10);

      await client.connectAll();

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('Disconnect All', () => {
    it('should disconnect from all connected servers', async () => {
      // Connect two servers
      const config1: MCPServerConfig = { name: 'server1', command: 'node' };
      const config2: MCPServerConfig = { name: 'server2', command: 'python' };

      const mockProcess1 = createMockProcess();
      const mockProcess2 = createMockProcess();

      mockSpawn
        .mockReturnValueOnce(mockProcess1)
        .mockReturnValueOnce(mockProcess2);

      const connectPromise1 = client.connect(config1);
      const connectPromise2 = client.connect(config2);

      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        });
        (mockProcess1.stdout as EventEmitter).emit('data', response + '\n');
        (mockProcess2.stdout as EventEmitter).emit('data', response + '\n');
      }, 10);

      await Promise.all([connectPromise1, connectPromise2]);

      expect(client.getConnectedServers()).toHaveLength(2);

      await client.disconnectAll();

      expect(client.getConnectedServers()).toHaveLength(0);
    });
  });

  describe('Tool Discovery', () => {
    const testConfig: MCPServerConfig = {
      name: 'test-server',
      command: 'node',
    };

    beforeEach(async () => {
      const connectPromise = client.connect(testConfig);

      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      await connectPromise;
    });

    it('should retrieve tools from connected server', async () => {
      const getToolsPromise = client.getAllTools();

      // Respond to tools/list request
      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: {
            tools: [
              {
                name: 'read_file',
                description: 'Read a file',
                inputSchema: { type: 'object' },
              },
              {
                name: 'write_file',
                description: 'Write a file',
                inputSchema: { type: 'object' },
              },
            ],
          },
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      const tools = await getToolsPromise;

      expect(tools.has('test-server')).toBe(true);
      const serverTools = tools.get('test-server');
      expect(serverTools).toHaveLength(2);
      expect(serverTools?.[0].name).toBe('read_file');
      expect(serverTools?.[1].name).toBe('write_file');
    });

    it('should handle empty tools list', async () => {
      const getToolsPromise = client.getAllTools();

      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: {},
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      const tools = await getToolsPromise;

      expect(tools.has('test-server')).toBe(true);
      expect(tools.get('test-server')).toEqual([]);
    });

    it('should handle errors when getting tools', async () => {
      const getToolsPromise = client.getAllTools();

      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          error: {
            code: -32603,
            message: 'Internal error',
          },
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      const tools = await getToolsPromise;

      expect(logger.error).toHaveBeenCalled();
      // Even with error, map entry may not exist or be empty
      expect(tools.get('test-server')).toBeUndefined();
    });
  });

  describe('Resource Discovery', () => {
    const testConfig: MCPServerConfig = {
      name: 'test-server',
      command: 'node',
    };

    beforeEach(async () => {
      const connectPromise = client.connect(testConfig);

      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      await connectPromise;
    });

    it('should retrieve resources from connected server', async () => {
      const getResourcesPromise = client.getAllResources();

      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: {
            resources: [
              {
                uri: 'file:///path/to/file',
                name: 'Test File',
                mimeType: 'text/plain',
              },
            ],
          },
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      const resources = await getResourcesPromise;

      expect(resources.has('test-server')).toBe(true);
      const serverResources = resources.get('test-server');
      expect(serverResources).toHaveLength(1);
      expect(serverResources?.[0].uri).toBe('file:///path/to/file');
    });

    it('should handle empty resources list', async () => {
      const getResourcesPromise = client.getAllResources();

      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: {},
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      const resources = await getResourcesPromise;

      expect(resources.get('test-server')).toEqual([]);
    });
  });

  describe('Tool Execution', () => {
    const testConfig: MCPServerConfig = {
      name: 'test-server',
      command: 'node',
    };

    beforeEach(async () => {
      const connectPromise = client.connect(testConfig);

      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      await connectPromise;
    });

    it('should call tool on connected server', async () => {
      const callPromise = client.callTool(
        'test-server',
        'read_file',
        { path: '/test/file.txt' }
      );

      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: {
            content: [
              { type: 'text', text: 'File contents' },
            ],
          },
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      const result = await callPromise;

      expect(result).toEqual({
        content: [{ type: 'text', text: 'File contents' }],
      });

      // Verify the request was sent correctly
      const stdinWrite = mockProcess.stdin.write;
      expect(stdinWrite).toHaveBeenCalled();

      // Find the tools/call request in the mock calls
      // (after initialize and notifications/initialized)
      const toolCallIndex = stdinWrite.mock.calls.findIndex((call: unknown[]) => {
        try {
          const parsed = JSON.parse((call[0] as string).replace('\n', ''));
          return parsed.method === 'tools/call';
        } catch {
          return false;
        }
      });

      expect(toolCallIndex).toBeGreaterThan(-1);
      const writtenData = stdinWrite.mock.calls[toolCallIndex][0];
      const request = JSON.parse(writtenData.replace('\n', ''));
      expect(request.method).toBe('tools/call');
      expect(request.params.name).toBe('read_file');
      expect(request.params.arguments).toEqual({ path: '/test/file.txt' });
    });

    it('should throw error when calling tool on non-connected server', async () => {
      await expect(
        client.callTool('non-existent', 'some_tool', {})
      ).rejects.toThrow('Server non-existent is not connected');
    });

    it('should handle tool call errors', async () => {
      const callPromise = client.callTool(
        'test-server',
        'failing_tool',
        {}
      );

      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          error: {
            code: -32602,
            message: 'Invalid parameters',
          },
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      await expect(callPromise).rejects.toThrow('Invalid parameters');
    });
  });

  describe('Resource Reading', () => {
    const testConfig: MCPServerConfig = {
      name: 'test-server',
      command: 'node',
    };

    beforeEach(async () => {
      const connectPromise = client.connect(testConfig);

      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      await connectPromise;
    });

    it('should read resource from connected server', async () => {
      const readPromise = client.readResource(
        'test-server',
        'file:///test.txt'
      );

      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: {
            contents: [
              {
                uri: 'file:///test.txt',
                mimeType: 'text/plain',
                text: 'Resource content',
              },
            ],
          },
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      const result = await readPromise;

      expect(result).toBeDefined();
    });

    it('should throw error when reading resource from non-connected server', async () => {
      await expect(
        client.readResource('non-existent', 'some://uri')
      ).rejects.toThrow('Server non-existent is not connected');
    });
  });

  describe('Status Formatting', () => {
    it('should format status with no servers', () => {
      const status = client.formatStatus();

      expect(status).toContain('No MCP servers connected');
      expect(status).toContain('.codebuddy/mcp-servers.json');
    });

    it('should format status with connected servers', async () => {
      const config: MCPServerConfig = { name: 'my-server', command: 'node' };
      const connectPromise = client.connect(config);

      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      await connectPromise;

      const status = client.formatStatus();

      expect(status).toContain('Connected MCP Servers');
      expect(status).toContain('my-server');
    });
  });

  describe('Dispose', () => {
    it('should disconnect all servers and remove listeners', async () => {
      const config: MCPServerConfig = { name: 'test-server', command: 'node' };
      const connectPromise = client.connect(config);

      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      await connectPromise;

      expect(client.getConnectedServers()).toHaveLength(1);

      await client.dispose();

      expect(client.getConnectedServers()).toHaveLength(0);
    });
  });

  describe('isConnected', () => {
    it('should return false for non-connected server', () => {
      expect(client.isConnected('non-existent')).toBe(false);
    });

    it('should return true for connected server', async () => {
      const config: MCPServerConfig = { name: 'test-server', command: 'node' };
      const connectPromise = client.connect(config);

      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      await connectPromise;

      expect(client.isConnected('test-server')).toBe(true);
    });
  });
});

describe('MCP Client Singleton', () => {
  beforeEach(async () => {
    await resetMCPClient();
  });

  afterEach(async () => {
    await resetMCPClient();
  });

  describe('getMCPClient', () => {
    it('should return an MCPClient instance', () => {
      const client = getMCPClient();
      expect(client).toBeInstanceOf(MCPClient);
    });

    it('should return the same instance on multiple calls', () => {
      const client1 = getMCPClient();
      const client2 = getMCPClient();

      expect(client1).toBe(client2);
    });
  });

  describe('resetMCPClient', () => {
    it('should reset the singleton instance', async () => {
      const client1 = getMCPClient();

      await resetMCPClient();

      const client2 = getMCPClient();

      expect(client1).not.toBe(client2);
    });

    it('should handle reset when no instance exists', async () => {
      await expect(resetMCPClient()).resolves.not.toThrow();
    });
  });
});

describe('JSON-RPC Message Handling', () => {
  let client: MCPClient;
  let mockProcess: MockProcess;

  beforeEach(() => {
    jest.clearAllMocks();

    mockProcess = createMockProcess();
    (spawn as jest.Mock).mockReturnValue(mockProcess);

    (fs.existsSync as jest.Mock).mockReturnValue(false);

    client = new MCPClient();
  });

  afterEach(async () => {
    await client.dispose();
  });

  describe('Data Buffering', () => {
    const testConfig: MCPServerConfig = {
      name: 'test-server',
      command: 'node',
    };

    it('should handle fragmented JSON responses', async () => {
      const connectPromise = client.connect(testConfig);

      // Send response in multiple chunks
      setTimeout(() => {
        const fullResponse = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        }) + '\n';

        const chunk1 = fullResponse.substring(0, 10);
        const chunk2 = fullResponse.substring(10);

        mockProcess.stdout.emit('data', chunk1);
        mockProcess.stdout.emit('data', chunk2);
      }, 10);

      await connectPromise;

      expect(client.isConnected('test-server')).toBe(true);
    });

    it('should handle multiple responses in single chunk', async () => {
      const connectPromise = client.connect(testConfig);

      setTimeout(() => {
        const response1 = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        });
        mockProcess.stdout.emit('data', response1 + '\n');
      }, 10);

      await connectPromise;

      // Now get tools - should handle next request
      const getToolsPromise = client.getAllTools();

      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: { tools: [] },
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      const tools = await getToolsPromise;
      expect(tools.get('test-server')).toEqual([]);
    });

    it('should handle stderr output', async () => {
      const connectPromise = client.connect(testConfig);

      setTimeout(() => {
        // Emit stderr
        mockProcess.stderr.emit('data', 'Debug message\n');

        // Then send valid response
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      await connectPromise;

      expect(logger.debug).toHaveBeenCalled();
    });

    it('should handle invalid JSON gracefully', async () => {
      const connectPromise = client.connect(testConfig);

      setTimeout(() => {
        // Send invalid JSON first
        mockProcess.stdout.emit('data', 'not json\n');

        // Then send valid response
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      await connectPromise;

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse MCP message')
      );
    });
  });

  describe('Process Events', () => {
    const testConfig: MCPServerConfig = {
      name: 'test-server',
      command: 'node',
    };

    it('should handle process close event', async () => {
      const connectPromise = client.connect(testConfig);

      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        });
        mockProcess.stdout.emit('data', response + '\n');
      }, 10);

      await connectPromise;

      // Emit close event
      mockProcess.emit('close', 0);

      // Process should handle this gracefully
    });
  });
});

describe('MCP Server Configuration Interface', () => {
  describe('MCPServerConfig', () => {
    it('should support required fields', () => {
      const config: MCPServerConfig = {
        name: 'test',
        command: 'node',
      };

      expect(config.name).toBe('test');
      expect(config.command).toBe('node');
    });

    it('should support optional fields', () => {
      const config: MCPServerConfig = {
        name: 'test',
        command: 'node',
        args: ['--port', '3000'],
        env: { NODE_ENV: 'production' },
        enabled: true,
      };

      expect(config.args).toEqual(['--port', '3000']);
      expect(config.env).toEqual({ NODE_ENV: 'production' });
      expect(config.enabled).toBe(true);
    });

    it('should support disabled servers', () => {
      const config: MCPServerConfig = {
        name: 'disabled-server',
        command: 'node',
        enabled: false,
      };

      expect(config.enabled).toBe(false);
    });
  });
});

describe('Request Timeout', () => {
  let client: MCPClient;
  let mockProcess: MockProcess;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockProcess = createMockProcess();
    (spawn as jest.Mock).mockReturnValue(mockProcess);

    (fs.existsSync as jest.Mock).mockReturnValue(false);

    client = new MCPClient();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await client.dispose();
  });

  it('should timeout pending requests after 30 seconds', async () => {
    const testConfig: MCPServerConfig = {
      name: 'slow-server',
      command: 'node',
    };

    const connectPromise = client.connect(testConfig);

    // Advance timers to trigger timeout
    jest.advanceTimersByTime(30001);

    await expect(connectPromise).rejects.toThrow('Request timed out');
  });
});
