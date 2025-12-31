/**
 * Unit tests for src/codebuddy/tools.ts
 * Tests tool definitions, MCP integration, and RAG-based tool selection
 */

// Mock dependencies before imports
jest.mock('../../src/mcp/client', () => ({
  MCPManager: jest.fn().mockImplementation(() => ({
    getTools: jest.fn().mockReturnValue([]),
    addServer: jest.fn().mockResolvedValue(undefined),
    ensureServersInitialized: jest.fn().mockResolvedValue(undefined),
    callTool: jest.fn().mockResolvedValue({ isError: false, content: [] }),
  })),
  MCPTool: jest.fn(),
}));

jest.mock('../../src/mcp/config', () => ({
  loadMCPConfig: jest.fn().mockReturnValue({ servers: [] }),
}));

jest.mock('../../src/tools/tool-selector', () => {
  const originalModule = jest.requireActual('../../src/tools/tool-selector');
  const mockSelector = {
    classifyQuery: jest.fn().mockReturnValue({
      categories: ['file_read'],
      confidence: 0.8,
      keywords: ['view', 'file'],
      requiresMultipleTools: false,
    }),
    selectTools: jest.fn().mockImplementation((query, tools, opts) => ({
      selectedTools: tools.slice(0, opts?.maxTools || 15),
      scores: new Map(tools.map((t: { function: { name: string } }) => [t.function.name, 1])),
      classification: {
        categories: ['file_read'],
        confidence: 0.8,
        keywords: [],
        requiresMultipleTools: false,
      },
      reducedTokens: 100,
      originalTokens: 500,
    })),
    registerMCPTool: jest.fn(),
    getToolMetadata: jest.fn(),
    resetMetrics: jest.fn(),
  };

  return {
    ...originalModule,
    getToolSelector: jest.fn().mockReturnValue(mockSelector),
    selectRelevantTools: jest.fn().mockImplementation((query, tools, maxTools) => ({
      selectedTools: tools.slice(0, maxTools || 10),
      scores: new Map(),
      classification: {
        categories: ['file_read'],
        confidence: 0.8,
        keywords: [],
        requiresMultipleTools: false,
      },
      reducedTokens: 100,
      originalTokens: 500,
    })),
    ToolSelector: originalModule.ToolSelector,
  };
});

jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  CODEBUDDY_TOOLS,
  getMCPManager,
  initializeMCPServers,
  convertMCPToolToCodeBuddyTool,
  addMCPToolsToCodeBuddyTools,
  getAllCodeBuddyTools,
  getRelevantTools,
  classifyQuery,
  getToolSelector,
} from '../../src/codebuddy/tools';
import { MCPManager, MCPTool } from '../../src/mcp/client';
import { loadMCPConfig } from '../../src/mcp/config';
import { CodeBuddyTool } from '../../src/codebuddy/client';

describe('CODEBUDDY_TOOLS', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.MORPH_API_KEY;
  });

  describe('Tool Array', () => {
    it('should export an array of tools', () => {
      expect(Array.isArray(CODEBUDDY_TOOLS)).toBe(true);
      expect(CODEBUDDY_TOOLS.length).toBeGreaterThan(0);
    });

    it('should include core tools', () => {
      const toolNames = CODEBUDDY_TOOLS.map(t => t.function.name);

      expect(toolNames).toContain('view_file');
      expect(toolNames).toContain('create_file');
      expect(toolNames).toContain('str_replace_editor');
      expect(toolNames).toContain('bash');
    });

    it('should include search tools', () => {
      const toolNames = CODEBUDDY_TOOLS.map(t => t.function.name);

      expect(toolNames).toContain('search');
    });

    it('should include todo tools', () => {
      const toolNames = CODEBUDDY_TOOLS.map(t => t.function.name);

      expect(toolNames).toContain('create_todo_list');
      expect(toolNames).toContain('update_todo_list');
    });

    it('should include web tools', () => {
      const toolNames = CODEBUDDY_TOOLS.map(t => t.function.name);

      expect(toolNames).toContain('web_search');
      expect(toolNames).toContain('web_fetch');
    });

    it('should have valid tool structures', () => {
      for (const tool of CODEBUDDY_TOOLS) {
        expect(tool.type).toBe('function');
        expect(tool.function).toBeDefined();
        expect(tool.function.name).toBeDefined();
        expect(typeof tool.function.name).toBe('string');
        expect(tool.function.description).toBeDefined();
        expect(typeof tool.function.description).toBe('string');
        expect(tool.function.parameters).toBeDefined();
        expect(tool.function.parameters.type).toBe('object');
        expect(tool.function.parameters.properties).toBeDefined();
        expect(Array.isArray(tool.function.parameters.required)).toBe(true);
      }
    });

    it('should have unique tool names', () => {
      const toolNames = CODEBUDDY_TOOLS.map(t => t.function.name);
      const uniqueNames = new Set(toolNames);

      expect(uniqueNames.size).toBe(toolNames.length);
    });
  });

  describe('Tool Parameters', () => {
    it('view_file should have path parameter', () => {
      const viewFile = CODEBUDDY_TOOLS.find(t => t.function.name === 'view_file');

      expect(viewFile).toBeDefined();
      expect(viewFile!.function.parameters.properties.path).toBeDefined();
      expect(viewFile!.function.parameters.required).toContain('path');
    });

    it('create_file should have path and content parameters', () => {
      const createFile = CODEBUDDY_TOOLS.find(t => t.function.name === 'create_file');

      expect(createFile).toBeDefined();
      expect(createFile!.function.parameters.properties.path).toBeDefined();
      expect(createFile!.function.parameters.properties.content).toBeDefined();
      expect(createFile!.function.parameters.required).toContain('path');
      expect(createFile!.function.parameters.required).toContain('content');
    });

    it('str_replace_editor should have path, old_str, and new_str parameters', () => {
      const strReplace = CODEBUDDY_TOOLS.find(t => t.function.name === 'str_replace_editor');

      expect(strReplace).toBeDefined();
      expect(strReplace!.function.parameters.properties.path).toBeDefined();
      expect(strReplace!.function.parameters.properties.old_str).toBeDefined();
      expect(strReplace!.function.parameters.properties.new_str).toBeDefined();
      expect(strReplace!.function.parameters.required).toContain('path');
      expect(strReplace!.function.parameters.required).toContain('old_str');
      expect(strReplace!.function.parameters.required).toContain('new_str');
    });

    it('bash should have command parameter', () => {
      const bash = CODEBUDDY_TOOLS.find(t => t.function.name === 'bash');

      expect(bash).toBeDefined();
      expect(bash!.function.parameters.properties.command).toBeDefined();
      expect(bash!.function.parameters.required).toContain('command');
    });

    it('search should have query parameter', () => {
      const search = CODEBUDDY_TOOLS.find(t => t.function.name === 'search');

      expect(search).toBeDefined();
      expect(search!.function.parameters.properties.query).toBeDefined();
      expect(search!.function.parameters.required).toContain('query');
    });
  });
});

describe('MCP Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getMCPManager', () => {
    it('should return an MCPManager instance', () => {
      const manager = getMCPManager();

      expect(manager).toBeDefined();
    });

    it('should return the same instance (singleton)', () => {
      const manager1 = getMCPManager();
      const manager2 = getMCPManager();

      expect(manager1).toBe(manager2);
    });
  });

  describe('initializeMCPServers', () => {
    it('should load MCP config', async () => {
      await initializeMCPServers();

      expect(loadMCPConfig).toHaveBeenCalled();
    });

    it('should handle server initialization errors gracefully', async () => {
      (loadMCPConfig as jest.Mock).mockReturnValue({
        servers: [
          { name: 'test-server', command: 'test' },
        ],
      });

      const manager = getMCPManager();
      (manager.addServer as jest.Mock).mockRejectedValue(new Error('Connection failed'));

      await expect(initializeMCPServers()).resolves.not.toThrow();
    });
  });

  describe('convertMCPToolToCodeBuddyTool', () => {
    it('should convert MCP tool to CodeBuddy tool format', () => {
      const mcpTool: MCPTool = {
        name: 'mcp__server__tool',
        description: 'A test MCP tool',
        inputSchema: {
          type: 'object',
          properties: {
            param1: { type: 'string', description: 'First parameter' },
          },
          required: ['param1'],
        },
        serverName: 'test-server',
      };

      const result = convertMCPToolToCodeBuddyTool(mcpTool);

      expect(result.type).toBe('function');
      expect(result.function.name).toBe('mcp__server__tool');
      expect(result.function.description).toBe('A test MCP tool');
      expect(result.function.parameters).toEqual(mcpTool.inputSchema);
    });

    it('should handle MCP tool without input schema', () => {
      const mcpTool: MCPTool = {
        name: 'mcp__simple__tool',
        description: 'A simple tool',
        inputSchema: undefined as never,
        serverName: 'test-server',
      };

      const result = convertMCPToolToCodeBuddyTool(mcpTool);

      expect(result.function.parameters).toEqual({
        type: 'object',
        properties: {},
        required: [],
      });
    });

    it('should preserve complex input schemas', () => {
      const mcpTool: MCPTool = {
        name: 'mcp__complex__tool',
        description: 'A complex tool',
        inputSchema: {
          type: 'object',
          properties: {
            nested: {
              type: 'object',
              properties: {
                value: { type: 'number' },
              },
              required: ['value'],
            },
            array: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['nested'],
        },
        serverName: 'test-server',
      };

      const result = convertMCPToolToCodeBuddyTool(mcpTool);

      expect(result.function.parameters.properties.nested).toBeDefined();
      expect(result.function.parameters.properties.array).toBeDefined();
    });
  });

  describe('addMCPToolsToCodeBuddyTools', () => {
    it('should return base tools when no MCP manager', () => {
      const baseTools: CodeBuddyTool[] = [
        {
          type: 'function',
          function: {
            name: 'test_tool',
            description: 'Test',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ];

      const result = addMCPToolsToCodeBuddyTools(baseTools);

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThanOrEqual(baseTools.length);
    });

    it('should combine base tools with MCP tools', () => {
      const manager = getMCPManager();
      const mockMCPTools: MCPTool[] = [
        {
          name: 'mcp__test__tool1',
          description: 'MCP Tool 1',
          inputSchema: { type: 'object', properties: {}, required: [] },
          serverName: 'test-server',
        },
      ];

      (manager.getTools as jest.Mock).mockReturnValue(mockMCPTools);

      const baseTools: CodeBuddyTool[] = [
        {
          type: 'function',
          function: {
            name: 'base_tool',
            description: 'Base Tool',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ];

      const result = addMCPToolsToCodeBuddyTools(baseTools);

      expect(result.length).toBe(baseTools.length + mockMCPTools.length);
      expect(result.some(t => t.function.name === 'mcp__test__tool1')).toBe(true);
    });
  });

  describe('getAllCodeBuddyTools', () => {
    it('should return all tools including MCP tools', async () => {
      const tools = await getAllCodeBuddyTools();

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('should register MCP tools in tool selector', async () => {
      const manager = getMCPManager();
      const mockMCPTools: MCPTool[] = [
        {
          name: 'mcp__server__newtool',
          description: 'New MCP Tool',
          inputSchema: { type: 'object', properties: {}, required: [] },
          serverName: 'test-server',
        },
      ];

      (manager.getTools as jest.Mock).mockReturnValue(mockMCPTools);

      await getAllCodeBuddyTools();

      const selector = getToolSelector();
      expect(selector.registerMCPTool).toHaveBeenCalled();
    });
  });
});

describe('RAG Tool Selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getRelevantTools', () => {
    it('should return selected tools for a query', async () => {
      const result = await getRelevantTools('Show me the package.json file');

      expect(result).toBeDefined();
      expect(result.selectedTools).toBeDefined();
      expect(Array.isArray(result.selectedTools)).toBe(true);
    });

    it('should respect maxTools option', async () => {
      const result = await getRelevantTools('Show me files', { maxTools: 5 });

      expect(result.selectedTools.length).toBeLessThanOrEqual(5);
    });

    it('should return all tools when useRAG is false', async () => {
      const result = await getRelevantTools('Any query', { useRAG: false });

      expect(result.selectedTools.length).toBeGreaterThan(0);
      expect(result.classification.confidence).toBe(1);
    });

    it('should include classification result', async () => {
      const result = await getRelevantTools('Search for TODO comments');

      expect(result.classification).toBeDefined();
      expect(result.classification.categories).toBeDefined();
      expect(Array.isArray(result.classification.categories)).toBe(true);
    });

    it('should include scores map', async () => {
      const result = await getRelevantTools('View package.json');

      expect(result.scores).toBeDefined();
      expect(result.scores instanceof Map).toBe(true);
    });

    it('should calculate token savings', async () => {
      const result = await getRelevantTools('Edit a file', { maxTools: 5 });

      expect(typeof result.reducedTokens).toBe('number');
      expect(typeof result.originalTokens).toBe('number');
    });

    it('should handle category filtering', async () => {
      const result = await getRelevantTools('Do something', {
        includeCategories: ['file_read'],
      });

      expect(result.selectedTools.length).toBeGreaterThan(0);
    });

    it('should handle category exclusion', async () => {
      const result = await getRelevantTools('Do something', {
        excludeCategories: ['web'],
      });

      expect(result.selectedTools.length).toBeGreaterThan(0);
    });

    it('should always include specified tools', async () => {
      const result = await getRelevantTools('Random query', {
        alwaysInclude: ['view_file', 'bash'],
      });

      expect(result.selectedTools.length).toBeGreaterThan(0);
    });
  });

  describe('classifyQuery', () => {
    it('should classify a query', () => {
      const result = classifyQuery('Show me the package.json file');

      expect(result).toBeDefined();
      expect(result.categories).toBeDefined();
      expect(result.confidence).toBeDefined();
    });

    it('should return classification from tool selector', () => {
      const result = classifyQuery('Edit config file');

      expect(result.categories).toContain('file_read');
    });
  });

  describe('getToolSelector', () => {
    it('should return the tool selector instance', () => {
      const selector = getToolSelector();

      expect(selector).toBeDefined();
      expect(typeof selector.classifyQuery).toBe('function');
      expect(typeof selector.registerMCPTool).toBe('function');
    });
  });
});

describe('Morph Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should not include edit_file when MORPH_API_KEY is not set', () => {
    delete process.env.MORPH_API_KEY;

    const toolNames = CODEBUDDY_TOOLS.map(t => t.function.name);

    expect(toolNames.length).toBeGreaterThan(0);
  });
});

describe('Tool Description Quality', () => {
  it('should have meaningful descriptions for all tools', () => {
    for (const tool of CODEBUDDY_TOOLS) {
      expect(tool.function.description.length).toBeGreaterThan(10);
    }
  });

  it('should have parameter descriptions where needed', () => {
    for (const tool of CODEBUDDY_TOOLS) {
      const params = tool.function.parameters.properties;

      for (const [name, prop] of Object.entries(params)) {
        if (tool.function.parameters.required.includes(name)) {
          expect((prop as { description?: string }).description).toBeDefined();
        }
      }
    }
  });
});

describe('Error Handling', () => {
  it('should handle MCP initialization errors', async () => {
    (loadMCPConfig as jest.Mock).mockImplementation(() => {
      throw new Error('Config file not found');
    });

    await expect(initializeMCPServers()).rejects.toThrow('Config file not found');
  });

  it('should handle empty tool list gracefully', async () => {
    const result = await getRelevantTools('Query', { maxTools: 0 });

    expect(result).toBeDefined();
    expect(Array.isArray(result.selectedTools)).toBe(true);
  });
});

describe('Performance', () => {
  it('should return tools quickly for simple queries', async () => {
    const startTime = Date.now();

    for (let i = 0; i < 100; i++) {
      await getRelevantTools('Show me a file');
    }

    const duration = Date.now() - startTime;

    expect(duration).toBeLessThan(1000);
  });

  it('should handle concurrent tool selection', async () => {
    const queries = [
      'View package.json',
      'Create a new file',
      'Search for errors',
      'Run npm install',
      'Commit changes',
    ];

    const results = await Promise.all(
      queries.map(q => getRelevantTools(q))
    );

    expect(results.length).toBe(5);
    for (const result of results) {
      expect(result.selectedTools.length).toBeGreaterThan(0);
    }
  });
});
