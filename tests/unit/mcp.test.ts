/**
 * Tests for MCP Command
 *
 * Comprehensive tests covering:
 * - MCP server add command
 * - MCP server remove command
 * - MCP server list command
 * - MCP server test command
 * - Transport type handling
 * - Error handling
 */

import { Command } from 'commander';

// Mock dependencies before importing module under test
jest.mock('../../src/mcp/config.js', () => ({
  addMCPServer: jest.fn(),
  removeMCPServer: jest.fn(),
  loadMCPConfig: jest.fn(),
  PREDEFINED_SERVERS: {},
}));

jest.mock('../../src/codebuddy/tools.js', () => ({
  getMCPManager: jest.fn(),
}));

jest.mock('chalk', () => ({
  green: jest.fn((s: string) => s),
  red: jest.fn((s: string) => s),
  blue: jest.fn((s: string) => s),
  yellow: jest.fn((s: string) => s),
  bold: jest.fn((s: string) => s),
}));

jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { createMCPCommand } from '../../src/commands/mcp';
import * as mcpConfig from '../../src/mcp/config';
import * as tools from '../../src/codebuddy/tools';
import { logger } from '../../src/utils/logger.js';

const mockAddMCPServer = mcpConfig.addMCPServer as jest.Mock;
const mockRemoveMCPServer = mcpConfig.removeMCPServer as jest.Mock;
const mockLoadMCPConfig = mcpConfig.loadMCPConfig as jest.Mock;
const mockGetMCPManager = tools.getMCPManager as jest.Mock;
const loggerErrorSpy = logger.error as jest.Mock;

describe('MCP Command', () => {
  let command: Command;
  let mockManager: {
    addServer: jest.Mock;
    removeServer: jest.Mock;
    getTools: jest.Mock;
    getServers: jest.Mock;
    getTransportType: jest.Mock;
  };
  let consoleSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    mockManager = {
      addServer: jest.fn().mockResolvedValue(undefined),
      removeServer: jest.fn().mockResolvedValue(undefined),
      getTools: jest.fn().mockReturnValue([]),
      getServers: jest.fn().mockReturnValue([]),
      getTransportType: jest.fn().mockReturnValue('stdio'),
    };
    mockGetMCPManager.mockReturnValue(mockManager);
    mockLoadMCPConfig.mockReturnValue({ servers: [] });

    command = createMCPCommand();

    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error(`process.exit called`);
    }) as () => never);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('createMCPCommand', () => {
    test('should create command with name "mcp"', () => {
      expect(command.name()).toBe('mcp');
    });

    test('should have description', () => {
      expect(command.description()).toContain('MCP');
    });

    test('should have subcommands', () => {
      const subcommands = command.commands.map(cmd => cmd.name());
      expect(subcommands).toContain('add');
      expect(subcommands).toContain('add-json');
      expect(subcommands).toContain('remove');
      expect(subcommands).toContain('list');
      expect(subcommands).toContain('test');
    });
  });

  describe('add subcommand', () => {
    test('should have correct options', () => {
      const addCmd = command.commands.find(c => c.name() === 'add');
      const optionNames = addCmd?.options.map(o => o.long) || [];

      expect(optionNames).toContain('--transport');
      expect(optionNames).toContain('--command');
      expect(optionNames).toContain('--args');
      expect(optionNames).toContain('--url');
      expect(optionNames).toContain('--headers');
      expect(optionNames).toContain('--env');
    });

    test('should add stdio server with command', async () => {
      const addCmd = command.commands.find(c => c.name() === 'add');

      await addCmd?.parseAsync(['node', 'test', 'test-server', '-c', 'npx', '-a', 'server']);

      expect(mockAddMCPServer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-server',
          transport: expect.objectContaining({
            type: 'stdio',
            command: 'npx',
          }),
        })
      );
      expect(mockManager.addServer).toHaveBeenCalled();
    });

    test('should error when stdio transport lacks command', async () => {
      const addCmd = command.commands.find(c => c.name() === 'add');

      await expect(
        addCmd?.parseAsync(['node', 'test', 'test-server', '-t', 'stdio'])
      ).rejects.toThrow();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('--command is required')
      );
    });

    test('should add http server with url', async () => {
      const addCmd = command.commands.find(c => c.name() === 'add');

      await addCmd?.parseAsync([
        'node', 'test', 'http-server',
        '-t', 'http',
        '-u', 'http://localhost:3000'
      ]);

      expect(mockAddMCPServer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'http-server',
          transport: expect.objectContaining({
            type: 'http',
            url: 'http://localhost:3000',
          }),
        })
      );
    });

    test('should add sse server with url', async () => {
      const addCmd = command.commands.find(c => c.name() === 'add');

      await addCmd?.parseAsync([
        'node', 'test', 'sse-server',
        '-t', 'sse',
        '-u', 'http://localhost:3000/events'
      ]);

      expect(mockAddMCPServer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'sse-server',
          transport: expect.objectContaining({
            type: 'sse',
            url: 'http://localhost:3000/events',
          }),
        })
      );
    });

    test('should error when http transport lacks url', async () => {
      const addCmd = command.commands.find(c => c.name() === 'add');

      await expect(
        addCmd?.parseAsync(['node', 'test', 'http-server', '-t', 'http'])
      ).rejects.toThrow();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('--url is required')
      );
    });

    test('should error on invalid transport type', async () => {
      const addCmd = command.commands.find(c => c.name() === 'add');

      await expect(
        addCmd?.parseAsync(['node', 'test', 'bad-server', '-t', 'invalid'])
      ).rejects.toThrow();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Transport type must be')
      );
    });

    test('should parse environment variables', async () => {
      const addCmd = command.commands.find(c => c.name() === 'add');

      await addCmd?.parseAsync([
        'node', 'test', 'env-server',
        '-c', 'server',
        '-e', 'KEY=value',
        '-e', 'DEBUG=true'
      ]);

      expect(mockAddMCPServer).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: expect.objectContaining({
            env: { KEY: 'value', DEBUG: 'true' },
          }),
        })
      );
    });

    test('should parse headers', async () => {
      const addCmd = command.commands.find(c => c.name() === 'add');

      await addCmd?.parseAsync([
        'node', 'test', 'header-server',
        '-t', 'http',
        '-u', 'http://localhost:3000',
        '-h', 'Authorization=Bearer token'
      ]);

      expect(mockAddMCPServer).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: expect.objectContaining({
            headers: { Authorization: 'Bearer token' },
          }),
        })
      );
    });

    test('should handle connection error gracefully', async () => {
      mockManager.addServer.mockRejectedValue(new Error('Connection failed'));

      const addCmd = command.commands.find(c => c.name() === 'add');

      await expect(
        addCmd?.parseAsync(['node', 'test', 'fail-server', '-c', 'bad-cmd'])
      ).rejects.toThrow();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error adding MCP server')
      );
    });

    test('should show tool count after successful connection', async () => {
      mockManager.getTools.mockReturnValue([
        { serverName: 'tool-server', name: 'tool1' },
        { serverName: 'tool-server', name: 'tool2' },
      ]);

      const addCmd = command.commands.find(c => c.name() === 'add');

      await addCmd?.parseAsync(['node', 'test', 'tool-server', '-c', 'cmd']);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Available tools: 2')
      );
    });
  });

  describe('add-json subcommand', () => {
    test('should add server from valid JSON', async () => {
      const jsonConfig = JSON.stringify({
        command: 'npx',
        args: ['-y', '@example/mcp'],
        env: { NODE_ENV: 'test' },
      });

      const addJsonCmd = command.commands.find(c => c.name() === 'add-json');

      await addJsonCmd?.parseAsync(['node', 'test', 'json-server', jsonConfig]);

      expect(mockAddMCPServer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'json-server',
          transport: expect.objectContaining({
            command: 'npx',
            args: ['-y', '@example/mcp'],
          }),
        })
      );
    });

    test('should error on invalid JSON', async () => {
      const addJsonCmd = command.commands.find(c => c.name() === 'add-json');

      await expect(
        addJsonCmd?.parseAsync(['node', 'test', 'bad-json', '{invalid json}'])
      ).rejects.toThrow();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid JSON')
      );
    });

    test('should handle transport type in JSON', async () => {
      const jsonConfig = JSON.stringify({
        transport: 'http',
        url: 'http://localhost:3000',
      });

      const addJsonCmd = command.commands.find(c => c.name() === 'add-json');

      await addJsonCmd?.parseAsync(['node', 'test', 'http-json', jsonConfig]);

      expect(mockAddMCPServer).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: expect.objectContaining({
            type: 'http',
          }),
        })
      );
    });

    test('should handle transport object in JSON', async () => {
      const jsonConfig = JSON.stringify({
        transport: {
          type: 'sse',
          url: 'http://localhost:3000/sse',
        },
      });

      const addJsonCmd = command.commands.find(c => c.name() === 'add-json');

      await addJsonCmd?.parseAsync(['node', 'test', 'sse-json', jsonConfig]);

      expect(mockAddMCPServer).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: expect.objectContaining({
            type: 'sse',
          }),
        })
      );
    });
  });

  describe('remove subcommand', () => {
    test('should remove server', async () => {
      const removeCmd = command.commands.find(c => c.name() === 'remove');

      await removeCmd?.parseAsync(['node', 'test', 'server-to-remove']);

      expect(mockManager.removeServer).toHaveBeenCalledWith('server-to-remove');
      expect(mockRemoveMCPServer).toHaveBeenCalledWith('server-to-remove');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Removed MCP server')
      );
    });

    test('should handle removal error', async () => {
      mockManager.removeServer.mockRejectedValue(new Error('Not found'));

      const removeCmd = command.commands.find(c => c.name() === 'remove');

      await expect(
        removeCmd?.parseAsync(['node', 'test', 'missing-server'])
      ).rejects.toThrow();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error removing MCP server')
      );
    });
  });

  describe('list subcommand', () => {
    test('should show message when no servers configured', async () => {
      mockLoadMCPConfig.mockReturnValue({ servers: [] });

      const listCmd = command.commands.find(c => c.name() === 'list');
      await listCmd?.parseAsync(['node', 'test']);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No MCP servers configured')
      );
    });

    test('should list configured servers', async () => {
      mockLoadMCPConfig.mockReturnValue({
        servers: [
          {
            name: 'server1',
            transport: { type: 'stdio', command: 'npx', args: ['@example/mcp'] },
          },
          {
            name: 'server2',
            transport: { type: 'http', url: 'http://localhost:3000' },
          },
        ],
      });
      mockManager.getServers.mockReturnValue(['server1']);

      const listCmd = command.commands.find(c => c.name() === 'list');
      await listCmd?.parseAsync(['node', 'test']);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Configured MCP servers')
      );
    });

    test('should show connection status', async () => {
      mockLoadMCPConfig.mockReturnValue({
        servers: [{ name: 'test-server', transport: { type: 'stdio', command: 'cmd' } }],
      });
      mockManager.getServers.mockReturnValue(['test-server']);
      mockManager.getTools.mockReturnValue([
        { serverName: 'test-server', name: 'tool1', description: 'A tool' },
      ]);

      const listCmd = command.commands.find(c => c.name() === 'list');
      await listCmd?.parseAsync(['node', 'test']);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Connected')
      );
    });

    test('should show disconnected status', async () => {
      mockLoadMCPConfig.mockReturnValue({
        servers: [{ name: 'offline-server', transport: { type: 'stdio', command: 'cmd' } }],
      });
      mockManager.getServers.mockReturnValue([]);

      const listCmd = command.commands.find(c => c.name() === 'list');
      await listCmd?.parseAsync(['node', 'test']);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Disconnected')
      );
    });

    test('should show transport info for stdio servers', async () => {
      mockLoadMCPConfig.mockReturnValue({
        servers: [
          {
            name: 'stdio-server',
            transport: { type: 'stdio', command: 'npx', args: ['-y', 'server'] },
          },
        ],
      });

      const listCmd = command.commands.find(c => c.name() === 'list');
      await listCmd?.parseAsync(['node', 'test']);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Command:')
      );
    });

    test('should show URL for http servers', async () => {
      mockLoadMCPConfig.mockReturnValue({
        servers: [
          {
            name: 'http-server',
            transport: { type: 'http', url: 'http://localhost:3000' },
          },
        ],
      });

      const listCmd = command.commands.find(c => c.name() === 'list');
      await listCmd?.parseAsync(['node', 'test']);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('URL:')
      );
    });

    test('should show tool count for connected servers', async () => {
      mockLoadMCPConfig.mockReturnValue({
        servers: [{ name: 'tool-server', transport: { type: 'stdio', command: 'cmd' } }],
      });
      mockManager.getServers.mockReturnValue(['tool-server']);
      mockManager.getTools.mockReturnValue([
        { serverName: 'tool-server', name: 'mcp__tool-server__read', description: 'Read' },
        { serverName: 'tool-server', name: 'mcp__tool-server__write', description: 'Write' },
      ]);

      const listCmd = command.commands.find(c => c.name() === 'list');
      await listCmd?.parseAsync(['node', 'test']);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Tools: 2')
      );
    });

    test('should handle legacy server config format', async () => {
      mockLoadMCPConfig.mockReturnValue({
        servers: [
          {
            name: 'legacy-server',
            command: 'npx',
            args: ['legacy-cmd'],
          },
        ],
      });

      const listCmd = command.commands.find(c => c.name() === 'list');
      await listCmd?.parseAsync(['node', 'test']);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Command:')
      );
    });
  });

  describe('test subcommand', () => {
    test('should test connection to server', async () => {
      mockLoadMCPConfig.mockReturnValue({
        servers: [
          { name: 'test-server', transport: { type: 'stdio', command: 'cmd' } },
        ],
      });
      mockManager.getTools.mockReturnValue([
        { serverName: 'test-server', name: 'tool1' },
      ]);

      const testCmd = command.commands.find(c => c.name() === 'test');
      await testCmd?.parseAsync(['node', 'test', 'test-server']);

      expect(mockManager.addServer).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Successfully connected')
      );
    });

    test('should error when server not found in config', async () => {
      mockLoadMCPConfig.mockReturnValue({ servers: [] });

      const testCmd = command.commands.find(c => c.name() === 'test');

      await expect(
        testCmd?.parseAsync(['node', 'test', 'nonexistent'])
      ).rejects.toThrow();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('not found')
      );
    });

    test('should show tool list on successful connection', async () => {
      mockLoadMCPConfig.mockReturnValue({
        servers: [
          { name: 'test-server', transport: { type: 'stdio', command: 'cmd' } },
        ],
      });
      mockManager.getTools.mockReturnValue([
        { serverName: 'test-server', name: 'mcp__test-server__read_file', description: 'Read file' },
        { serverName: 'test-server', name: 'mcp__test-server__write_file', description: 'Write file' },
      ]);

      const testCmd = command.commands.find(c => c.name() === 'test');
      await testCmd?.parseAsync(['node', 'test', 'test-server']);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Tools:')
      );
    });

    test('should handle connection failure', async () => {
      mockLoadMCPConfig.mockReturnValue({
        servers: [
          { name: 'fail-server', transport: { type: 'stdio', command: 'bad-cmd' } },
        ],
      });
      mockManager.addServer.mockRejectedValue(new Error('Connection refused'));

      const testCmd = command.commands.find(c => c.name() === 'test');

      await expect(
        testCmd?.parseAsync(['node', 'test', 'fail-server'])
      ).rejects.toThrow();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to connect')
      );
    });
  });

  describe('Predefined servers', () => {
    beforeEach(() => {
      // Add a predefined server for testing
      (mcpConfig.PREDEFINED_SERVERS as any)['filesystem'] = {
        name: 'filesystem',
        transport: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem'],
        },
      };
    });

    afterEach(() => {
      delete (mcpConfig.PREDEFINED_SERVERS as any)['filesystem'];
    });

    test('should use predefined server config', async () => {
      const addCmd = command.commands.find(c => c.name() === 'add');

      await addCmd?.parseAsync(['node', 'test', 'filesystem']);

      expect(mockAddMCPServer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'filesystem',
          transport: expect.objectContaining({
            type: 'stdio',
            command: 'npx',
          }),
        })
      );
    });
  });
});
