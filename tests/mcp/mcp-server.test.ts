/**
 * Tests for CodeBuddyMCPServer
 *
 * Tests tool listing, schema definitions, tool execution mapping,
 * and server start/stop lifecycle.
 */

// Mock all tool dependencies before imports
jest.mock('../../src/tools/text-editor', () => {
  return {
    TextEditorTool: jest.fn().mockImplementation(() => ({
      view: jest.fn().mockResolvedValue({ success: true, output: 'file contents here' }),
      create: jest.fn().mockResolvedValue({ success: true, output: 'File created' }),
      strReplace: jest.fn().mockResolvedValue({ success: true, output: 'Replacement applied' }),
    })),
  };
});

jest.mock('../../src/tools/search', () => {
  return {
    SearchTool: jest.fn().mockImplementation(() => ({
      search: jest.fn().mockResolvedValue({ success: true, output: 'src/foo.ts:10: match found' }),
    })),
  };
});

jest.mock('../../src/tools/git-tool', () => {
  return {
    GitTool: jest.fn().mockImplementation(() => ({
      getStatus: jest.fn().mockResolvedValue({
        branch: 'main',
        ahead: 0,
        behind: 0,
        staged: [],
        unstaged: ['file.ts'],
        untracked: [],
      }),
      getDiff: jest.fn().mockResolvedValue('diff --git a/file.ts b/file.ts'),
      getLog: jest.fn().mockResolvedValue('abc1234 Initial commit'),
      add: jest.fn().mockResolvedValue({ success: true, output: 'Staged: all changes' }),
      commit: jest.fn().mockResolvedValue({ success: true, output: 'Committed' }),
      branch: jest.fn().mockResolvedValue({ success: true, output: '* main\n  dev' }),
      checkout: jest.fn().mockResolvedValue({ success: true, output: 'Switched to branch dev' }),
    })),
  };
});

jest.mock('../../src/tools/bash/index', () => {
  return {
    BashTool: jest.fn().mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({ success: true, output: 'command output' }),
    })),
  };
});

jest.mock('../../src/utils/confirmation-service', () => {
  return {
    ConfirmationService: {
      getInstance: jest.fn().mockReturnValue({
        setSessionFlag: jest.fn(),
        getSessionFlags: jest.fn().mockReturnValue({ allOperations: true }),
      }),
    },
  };
});

// Mock the MCP SDK to avoid actual stdio transport
jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  const registeredTools = new Map<string, { description: string; schema: unknown; handler: Function }>();

  return {
    McpServer: jest.fn().mockImplementation(() => ({
      tool: jest.fn((name: string, description: string, schema: unknown, handler: Function) => {
        registeredTools.set(name, { description, schema, handler });
      }),
      connect: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      _registeredTools: registeredTools,
    })),
  };
});

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  return {
    StdioServerTransport: jest.fn().mockImplementation(() => ({
      start: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

import { CodeBuddyMCPServer, MCPToolDefinition } from '../../src/mcp/mcp-server';

describe('CodeBuddyMCPServer', () => {
  let server: CodeBuddyMCPServer;

  beforeEach(() => {
    server = new CodeBuddyMCPServer();
  });

  afterEach(async () => {
    if (server.isRunning()) {
      await server.stop();
    }
  });

  // =========================================================================
  // Tool Listing
  // =========================================================================

  describe('getToolDefinitions', () => {
    it('should return all 7 tool definitions', () => {
      const tools = CodeBuddyMCPServer.getToolDefinitions();
      expect(tools).toHaveLength(7);
    });

    it('should include all expected tool names', () => {
      const tools = CodeBuddyMCPServer.getToolDefinitions();
      const names = tools.map((t: MCPToolDefinition) => t.name);
      expect(names).toContain('read_file');
      expect(names).toContain('write_file');
      expect(names).toContain('edit_file');
      expect(names).toContain('bash');
      expect(names).toContain('search_files');
      expect(names).toContain('list_files');
      expect(names).toContain('git');
    });

    it('should have descriptions for all tools', () => {
      const tools = CodeBuddyMCPServer.getToolDefinitions();
      for (const tool of tools) {
        expect(tool.description).toBeTruthy();
        expect(typeof tool.description).toBe('string');
      }
    });
  });

  // =========================================================================
  // Tool Schema Definitions
  // =========================================================================

  describe('tool schemas', () => {
    let tools: MCPToolDefinition[];

    beforeAll(() => {
      tools = CodeBuddyMCPServer.getToolDefinitions();
    });

    it('read_file should require path parameter', () => {
      const readFile = tools.find((t: MCPToolDefinition) => t.name === 'read_file')!;
      expect(readFile.inputSchema).toBeDefined();
      expect(readFile.inputSchema.required).toContain('path');
      const props = readFile.inputSchema.properties as Record<string, { type: string }>;
      expect(props.path.type).toBe('string');
    });

    it('write_file should require path and content parameters', () => {
      const writeFile = tools.find((t: MCPToolDefinition) => t.name === 'write_file')!;
      expect(writeFile.inputSchema.required).toContain('path');
      expect(writeFile.inputSchema.required).toContain('content');
    });

    it('edit_file should require path, old_string, and new_string', () => {
      const editFile = tools.find((t: MCPToolDefinition) => t.name === 'edit_file')!;
      const required = editFile.inputSchema.required as string[];
      expect(required).toContain('path');
      expect(required).toContain('old_string');
      expect(required).toContain('new_string');
    });

    it('bash should require command parameter', () => {
      const bash = tools.find((t: MCPToolDefinition) => t.name === 'bash')!;
      expect(bash.inputSchema.required).toContain('command');
    });

    it('search_files should require query parameter', () => {
      const search = tools.find((t: MCPToolDefinition) => t.name === 'search_files')!;
      expect(search.inputSchema.required).toContain('query');
    });

    it('git should require subcommand parameter with enum values', () => {
      const git = tools.find((t: MCPToolDefinition) => t.name === 'git')!;
      expect(git.inputSchema.required).toContain('subcommand');
      const props = git.inputSchema.properties as Record<string, { enum?: string[] }>;
      expect(props.subcommand.enum).toEqual(
        expect.arrayContaining(['status', 'diff', 'log', 'add', 'commit'])
      );
    });

    it('list_files should not require any parameters', () => {
      const listFiles = tools.find((t: MCPToolDefinition) => t.name === 'list_files')!;
      const required = listFiles.inputSchema.required as string[] | undefined;
      expect(!required || required.length === 0).toBe(true);
    });
  });

  // =========================================================================
  // Tool Execution Mapping
  // =========================================================================

  describe('tool execution', () => {
    // Access the internally registered tool handlers via the mock
    function getRegisteredHandler(name: string): Function | undefined {
      const mcpServer = (server as unknown as { mcpServer: { _registeredTools: Map<string, { handler: Function }> } }).mcpServer;
      const entry = mcpServer._registeredTools.get(name);
      return entry?.handler;
    }

    it('should register all tools with the MCP server', () => {
      const mcpServer = (server as unknown as { mcpServer: { tool: jest.Mock } }).mcpServer;
      // 7 tools should be registered
      expect(mcpServer.tool).toHaveBeenCalledTimes(7);
    });

    it('should map read_file to TextEditorTool.view', async () => {
      const handler = getRegisteredHandler('read_file');
      expect(handler).toBeDefined();

      const result = await handler!({ path: '/tmp/test.txt' });
      expect(result.content).toBeDefined();
      expect(result.content[0].text).toBe('file contents here');
    });

    it('should map read_file with line range', async () => {
      const handler = getRegisteredHandler('read_file');
      const result = await handler!({ path: '/tmp/test.txt', start_line: 5, end_line: 10 });
      expect(result.content[0].text).toBe('file contents here');
    });

    it('should map write_file to TextEditorTool.create', async () => {
      const handler = getRegisteredHandler('write_file');
      expect(handler).toBeDefined();

      const result = await handler!({ path: '/tmp/new.txt', content: 'hello world' });
      expect(result.content[0].text).toBe('File created');
    });

    it('should map edit_file to TextEditorTool.strReplace', async () => {
      const handler = getRegisteredHandler('edit_file');
      expect(handler).toBeDefined();

      const result = await handler!({ path: '/tmp/test.txt', old_string: 'foo', new_string: 'bar' });
      expect(result.content[0].text).toBe('Replacement applied');
    });

    it('should map bash to BashTool.execute', async () => {
      const handler = getRegisteredHandler('bash');
      expect(handler).toBeDefined();

      const result = await handler!({ command: 'echo hello' });
      expect(result.content[0].text).toBe('command output');
    });

    it('should map bash with custom timeout', async () => {
      const handler = getRegisteredHandler('bash');
      const result = await handler!({ command: 'sleep 1', timeout: 60000 });
      expect(result.content[0].text).toBe('command output');
    });

    it('should map search_files to SearchTool.search', async () => {
      const handler = getRegisteredHandler('search_files');
      expect(handler).toBeDefined();

      const result = await handler!({ query: 'TODO' });
      expect(result.content[0].text).toContain('match found');
    });

    it('should map list_files to TextEditorTool.view', async () => {
      const handler = getRegisteredHandler('list_files');
      expect(handler).toBeDefined();

      const result = await handler!({});
      expect(result.content).toBeDefined();
    });

    it('should map git status to GitTool.getStatus', async () => {
      const handler = getRegisteredHandler('git');
      expect(handler).toBeDefined();

      const result = await handler!({ subcommand: 'status' });
      expect(result.content[0].text).toContain('Branch: main');
      expect(result.content[0].text).toContain('file.ts');
    });

    it('should map git diff to GitTool.getDiff', async () => {
      const handler = getRegisteredHandler('git');
      const result = await handler!({ subcommand: 'diff', args: { staged: true } });
      expect(result.content[0].text).toContain('diff --git');
    });

    it('should map git log to GitTool.getLog', async () => {
      const handler = getRegisteredHandler('git');
      const result = await handler!({ subcommand: 'log', args: { count: 5 } });
      expect(result.content[0].text).toContain('Initial commit');
    });

    it('should map git add to GitTool.add', async () => {
      const handler = getRegisteredHandler('git');
      const result = await handler!({ subcommand: 'add', args: { files: ['file.ts'] } });
      expect(result.content[0].text).toContain('Staged');
    });

    it('should map git commit to GitTool.commit', async () => {
      const handler = getRegisteredHandler('git');
      const result = await handler!({ subcommand: 'commit', args: { message: 'test commit' } });
      expect(result.content[0].text).toBe('Committed');
    });

    it('should return error when git commit is missing message', async () => {
      const handler = getRegisteredHandler('git');
      const result = await handler!({ subcommand: 'commit', args: {} });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('commit message is required');
    });

    it('should map git branch to GitTool.branch', async () => {
      const handler = getRegisteredHandler('git');
      const result = await handler!({ subcommand: 'branch' });
      expect(result.content[0].text).toContain('main');
    });

    it('should map git checkout to GitTool.checkout', async () => {
      const handler = getRegisteredHandler('git');
      const result = await handler!({ subcommand: 'checkout', args: { branch_name: 'dev' } });
      expect(result.content[0].text).toContain('Switched to branch dev');
    });

    it('should return error when git checkout is missing branch_name', async () => {
      const handler = getRegisteredHandler('git');
      const result = await handler!({ subcommand: 'checkout', args: {} });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('branch_name is required');
    });
  });

  // =========================================================================
  // Server Lifecycle
  // =========================================================================

  describe('server lifecycle', () => {
    it('should not be running initially', () => {
      expect(server.isRunning()).toBe(false);
    });

    it('should start successfully', async () => {
      await server.start();
      expect(server.isRunning()).toBe(true);
    });

    it('should stop successfully after starting', async () => {
      await server.start();
      expect(server.isRunning()).toBe(true);

      await server.stop();
      expect(server.isRunning()).toBe(false);
    });

    it('should throw when starting twice', async () => {
      await server.start();
      await expect(server.start()).rejects.toThrow('MCP server is already running');
    });

    it('should be idempotent when stopping a non-running server', async () => {
      // Should not throw
      await server.stop();
      expect(server.isRunning()).toBe(false);
    });

    it('should allow restart after stop', async () => {
      await server.start();
      await server.stop();
      await server.start();
      expect(server.isRunning()).toBe(true);
    });
  });
});
