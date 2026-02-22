/**
 * Tests for MCP Agent Intelligence Layer
 *
 * Tests agent tools, memory tools, session tools, resources, and prompts
 * registered by the new MCP modules.
 */

// =========================================================================
// Mocks
// =========================================================================

const mockProcessUserMessage = jest.fn().mockResolvedValue([
  { type: 'assistant', content: 'Hello from agent', timestamp: new Date() },
]);

const mockExecutePlan = jest.fn().mockResolvedValue([
  { type: 'assistant', content: 'Plan executed', timestamp: new Date() },
  { type: 'tool_call', content: '', toolCall: { id: 'call_1', type: 'function' as const, function: { name: 'read_file', arguments: '{}' } }, timestamp: new Date() },
  { type: 'tool_result', content: '', toolResult: { success: true, output: 'file content' }, timestamp: new Date() },
]);

const mockNeedsOrchestration = jest.fn().mockReturnValue(false);
const mockDispose = jest.fn();

jest.mock('../../src/agent/codebuddy-agent', () => ({
  CodeBuddyAgent: jest.fn().mockImplementation(() => ({
    processUserMessage: mockProcessUserMessage,
    executePlan: mockExecutePlan,
    needsOrchestration: mockNeedsOrchestration,
    dispose: mockDispose,
    agentMode: 'code',
  })),
}));

jest.mock('../../src/utils/confirmation-service', () => ({
  ConfirmationService: {
    getInstance: jest.fn().mockReturnValue({
      setSessionFlag: jest.fn(),
      getSessionFlags: jest.fn().mockReturnValue({ allOperations: true }),
    }),
  },
}));

const mockSearchAndRetrieve = jest.fn().mockResolvedValue([
  {
    result: {
      entry: { metadata: { source: 'test.md' } },
      score: 0.95,
      snippet: 'test snippet',
    },
    content: 'Full content of the match',
  },
]);

jest.mock('../../src/memory/semantic-memory-search', () => ({
  searchAndRetrieve: (...args: unknown[]) => mockSearchAndRetrieve(...args),
}));

const mockRemember = jest.fn().mockResolvedValue(undefined);
const mockFormatMemories = jest.fn().mockReturnValue('## Memories\n- key1: value1');
const mockInitialize = jest.fn().mockResolvedValue(undefined);

jest.mock('../../src/memory/persistent-memory', () => ({
  getMemoryManager: jest.fn().mockReturnValue({
    initialize: mockInitialize,
    remember: mockRemember,
    formatMemories: mockFormatMemories,
  }),
}));

const mockGetRecentSessions = jest.fn().mockResolvedValue([
  {
    id: 'session-1',
    name: 'Test Session',
    model: 'grok-2',
    workingDirectory: '/home/test',
    messages: [
      { type: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
      { type: 'assistant', content: 'Hi there', timestamp: '2024-01-01T00:00:01Z' },
    ],
    createdAt: new Date('2024-01-01'),
    lastAccessedAt: new Date('2024-01-01'),
  },
]);

const mockLoadSession = jest.fn().mockResolvedValue({
  id: 'session-1',
  name: 'Test Session',
  model: 'grok-2',
  workingDirectory: '/home/test',
  messages: [
    { type: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
    { type: 'assistant', content: 'Hi there', timestamp: '2024-01-01T00:00:01Z' },
  ],
  createdAt: new Date('2024-01-01'),
  lastAccessedAt: new Date('2024-01-01'),
});

jest.mock('../../src/persistence/session-store', () => ({
  getSessionStore: jest.fn().mockReturnValue({
    getRecentSessions: mockGetRecentSessions,
    loadSession: mockLoadSession,
  }),
}));

const mockWebSearch = jest.fn().mockResolvedValue({
  success: true,
  output: '1. Result Title - https://example.com\nSnippet text here',
});

jest.mock('../../src/tools/web-search', () => ({
  WebSearchTool: jest.fn().mockImplementation(() => ({
    search: mockWebSearch,
  })),
}));

jest.mock('../../src/context/context-files', () => ({
  loadContext: jest.fn().mockResolvedValue({
    files: [{ path: 'CLAUDE.md', content: '# Instructions', source: 'project', priority: 1 }],
    combinedContent: '# Instructions',
    totalSize: 100,
  }),
  formatContextForPrompt: jest.fn().mockReturnValue('## Project Context\n# Instructions'),
}));

// Mock tools used by the original server
jest.mock('../../src/tools/text-editor', () => ({
  TextEditorTool: jest.fn().mockImplementation(() => ({
    view: jest.fn().mockResolvedValue({ success: true, output: 'file contents' }),
    create: jest.fn().mockResolvedValue({ success: true, output: 'File created' }),
    strReplace: jest.fn().mockResolvedValue({ success: true, output: 'Replaced' }),
  })),
}));

jest.mock('../../src/tools/search', () => ({
  SearchTool: jest.fn().mockImplementation(() => ({
    search: jest.fn().mockResolvedValue({ success: true, output: 'match' }),
  })),
}));

jest.mock('../../src/tools/git-tool', () => ({
  GitTool: jest.fn().mockImplementation(() => ({
    getStatus: jest.fn().mockResolvedValue({ branch: 'main', ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [] }),
  })),
}));

jest.mock('../../src/tools/bash/index', () => ({
  BashTool: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true, output: 'ok' }),
  })),
}));

// Mock MCP SDK
const registeredTools = new Map<string, { description: string; schema: unknown; handler: Function }>();
const registeredResources = new Map<string, { uri: string; options: unknown; handler: Function }>();
const registeredPrompts = new Map<string, { description: string; schema: unknown; handler: Function }>();

jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: jest.fn().mockImplementation(() => ({
    tool: jest.fn((name: string, description: string, schema: unknown, handler: Function) => {
      registeredTools.set(name, { description, schema, handler });
    }),
    resource: jest.fn((name: string, uri: string, options: unknown, handler: Function) => {
      registeredResources.set(name, { uri, options, handler });
    }),
    prompt: jest.fn((name: string, description: string, schema: unknown, handler: Function) => {
      registeredPrompts.set(name, { description, schema, handler });
    }),
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn().mockImplementation(() => ({})),
}));

import { CodeBuddyMCPServer } from '../../src/mcp/mcp-server';
import { formatAgentResponse } from '../../src/mcp/mcp-agent-tools';

// =========================================================================
// Tests
// =========================================================================

describe('MCP Agent Intelligence Layer', () => {
  let server: CodeBuddyMCPServer;

  beforeEach(() => {
    registeredTools.clear();
    registeredResources.clear();
    registeredPrompts.clear();
    jest.clearAllMocks();

    // Set env for agent init
    process.env.GROK_API_KEY = 'test-key-123';

    server = new CodeBuddyMCPServer();
  });

  afterEach(async () => {
    if (server.isRunning()) {
      await server.stop();
    }
    delete process.env.GROK_API_KEY;
  });

  // =========================================================================
  // Tool Registration
  // =========================================================================

  describe('tool registration', () => {
    it('should register all 15 tools', () => {
      expect(registeredTools.size).toBe(15);
    });

    it('should register agent_chat tool', () => {
      expect(registeredTools.has('agent_chat')).toBe(true);
    });

    it('should register agent_task tool', () => {
      expect(registeredTools.has('agent_task')).toBe(true);
    });

    it('should register agent_plan tool', () => {
      expect(registeredTools.has('agent_plan')).toBe(true);
    });

    it('should register memory_search tool', () => {
      expect(registeredTools.has('memory_search')).toBe(true);
    });

    it('should register memory_save tool', () => {
      expect(registeredTools.has('memory_save')).toBe(true);
    });

    it('should register session_list tool', () => {
      expect(registeredTools.has('session_list')).toBe(true);
    });

    it('should register session_resume tool', () => {
      expect(registeredTools.has('session_resume')).toBe(true);
    });

    it('should register web_search tool', () => {
      expect(registeredTools.has('web_search')).toBe(true);
    });
  });

  // =========================================================================
  // Resource Registration
  // =========================================================================

  describe('resource registration', () => {
    it('should register 4 resources', () => {
      expect(registeredResources.size).toBe(4);
    });

    it('should register project_context resource', () => {
      expect(registeredResources.has('project_context')).toBe(true);
      expect(registeredResources.get('project_context')!.uri).toBe('codebuddy://project/context');
    });

    it('should register project_instructions resource', () => {
      expect(registeredResources.has('project_instructions')).toBe(true);
      expect(registeredResources.get('project_instructions')!.uri).toBe('codebuddy://project/instructions');
    });

    it('should register sessions_latest resource', () => {
      expect(registeredResources.has('sessions_latest')).toBe(true);
      expect(registeredResources.get('sessions_latest')!.uri).toBe('codebuddy://sessions/latest');
    });

    it('should register memory_all resource', () => {
      expect(registeredResources.has('memory_all')).toBe(true);
      expect(registeredResources.get('memory_all')!.uri).toBe('codebuddy://memory/all');
    });
  });

  // =========================================================================
  // Prompt Registration
  // =========================================================================

  describe('prompt registration', () => {
    it('should register 5 prompts', () => {
      expect(registeredPrompts.size).toBe(5);
    });

    it('should register code_review prompt', () => {
      expect(registeredPrompts.has('code_review')).toBe(true);
    });

    it('should register explain_code prompt', () => {
      expect(registeredPrompts.has('explain_code')).toBe(true);
    });

    it('should register generate_tests prompt', () => {
      expect(registeredPrompts.has('generate_tests')).toBe(true);
    });

    it('should register refactor prompt', () => {
      expect(registeredPrompts.has('refactor')).toBe(true);
    });

    it('should register fix_bugs prompt', () => {
      expect(registeredPrompts.has('fix_bugs')).toBe(true);
    });
  });

  // =========================================================================
  // Agent Tool Handlers
  // =========================================================================

  describe('agent_chat handler', () => {
    it('should send message to agent and return response', async () => {
      const handler = registeredTools.get('agent_chat')!.handler;
      const result = await handler({ message: 'Hello' });

      expect(result.content).toBeDefined();
      expect(result.content[0].text).toContain('Hello from agent');
    });

    it('should handle errors gracefully', async () => {
      mockProcessUserMessage.mockRejectedValueOnce(new Error('API down'));
      const handler = registeredTools.get('agent_chat')!.handler;
      const result = await handler({ message: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('API down');
    });
  });

  describe('agent_task handler', () => {
    it('should process simple task directly', async () => {
      mockNeedsOrchestration.mockReturnValueOnce(false);
      const handler = registeredTools.get('agent_task')!.handler;
      const result = await handler({ task: 'read a file' });

      expect(result.content).toBeDefined();
      expect(result.content[0].text).toContain('Hello from agent');
    });

    it('should use executePlan for complex tasks', async () => {
      mockNeedsOrchestration.mockReturnValueOnce(true);
      const handler = registeredTools.get('agent_task')!.handler;
      const result = await handler({ task: 'refactor the entire module' });

      expect(result.content).toBeDefined();
      expect(result.content[0].text).toContain('Plan executed');
    });

    it('should handle errors gracefully', async () => {
      mockNeedsOrchestration.mockImplementationOnce(() => { throw new Error('Agent error'); });
      const handler = registeredTools.get('agent_task')!.handler;
      const result = await handler({ task: 'fail' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Agent error');
    });
  });

  describe('agent_plan handler', () => {
    it('should create plan without executing', async () => {
      const handler = registeredTools.get('agent_plan')!.handler;
      const result = await handler({ task: 'build a feature' });

      expect(result.content).toBeDefined();
      expect(mockProcessUserMessage).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Memory Tool Handlers
  // =========================================================================

  describe('memory_search handler', () => {
    it('should search memories and return formatted results', async () => {
      const handler = registeredTools.get('memory_search')!.handler;
      const result = await handler({ query: 'test pattern' });

      expect(result.content[0].text).toContain('Result 1');
      expect(result.content[0].text).toContain('test snippet');
      expect(mockSearchAndRetrieve).toHaveBeenCalledWith('test pattern', { maxResults: 5 });
    });

    it('should return message when no results found', async () => {
      mockSearchAndRetrieve.mockResolvedValueOnce([]);
      const handler = registeredTools.get('memory_search')!.handler;
      const result = await handler({ query: 'nonexistent' });

      expect(result.content[0].text).toContain('No matching memories');
    });

    it('should handle errors gracefully', async () => {
      mockSearchAndRetrieve.mockRejectedValueOnce(new Error('Index not ready'));
      const handler = registeredTools.get('memory_search')!.handler;
      const result = await handler({ query: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Index not ready');
    });
  });

  describe('memory_save handler', () => {
    it('should save memory entry', async () => {
      const handler = registeredTools.get('memory_save')!.handler;
      const result = await handler({ key: 'test-key', value: 'test-value' });

      expect(result.content[0].text).toContain('Memory saved');
      expect(result.content[0].text).toContain('test-key');
      expect(mockRemember).toHaveBeenCalledWith('test-key', 'test-value', {
        category: undefined,
        scope: undefined,
      });
    });

    it('should pass category and scope', async () => {
      const handler = registeredTools.get('memory_save')!.handler;
      await handler({ key: 'k', value: 'v', category: 'patterns', scope: 'user' });

      expect(mockRemember).toHaveBeenCalledWith('k', 'v', {
        category: 'patterns',
        scope: 'user',
      });
    });

    it('should handle errors gracefully', async () => {
      mockRemember.mockRejectedValueOnce(new Error('Write failed'));
      const handler = registeredTools.get('memory_save')!.handler;
      const result = await handler({ key: 'k', value: 'v' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Write failed');
    });
  });

  // =========================================================================
  // Session Tool Handlers
  // =========================================================================

  describe('session_list handler', () => {
    it('should list recent sessions', async () => {
      const handler = registeredTools.get('session_list')!.handler;
      const result = await handler({});

      expect(result.content[0].text).toContain('Recent Sessions');
      expect(result.content[0].text).toContain('Test Session');
      expect(result.content[0].text).toContain('session-1');
    });

    it('should handle empty sessions', async () => {
      mockGetRecentSessions.mockResolvedValueOnce([]);
      const handler = registeredTools.get('session_list')!.handler;
      const result = await handler({});

      expect(result.content[0].text).toContain('No sessions found');
    });
  });

  describe('session_resume handler', () => {
    it('should resume session by ID', async () => {
      const handler = registeredTools.get('session_resume')!.handler;
      const result = await handler({ session_id: 'session-1' });

      expect(result.content[0].text).toContain('Resumed Session');
      expect(result.content[0].text).toContain('Test Session');
    });

    it('should handle session not found', async () => {
      mockLoadSession.mockResolvedValueOnce(null);
      const handler = registeredTools.get('session_resume')!.handler;
      const result = await handler({ session_id: 'nonexistent' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Session not found');
    });
  });

  describe('web_search handler', () => {
    it('should search the web', async () => {
      const handler = registeredTools.get('web_search')!.handler;
      const result = await handler({ query: 'TypeScript tips' });

      expect(result.content[0].text).toContain('Result Title');
      expect(mockWebSearch).toHaveBeenCalledWith('TypeScript tips', {
        maxResults: 5,
        provider: undefined,
      });
    });

    it('should pass provider option', async () => {
      const handler = registeredTools.get('web_search')!.handler;
      await handler({ query: 'test', provider: 'brave' });

      expect(mockWebSearch).toHaveBeenCalledWith('test', {
        maxResults: 5,
        provider: 'brave',
      });
    });
  });

  // =========================================================================
  // Resource Handlers
  // =========================================================================

  describe('resource handlers', () => {
    it('project_context should return formatted context', async () => {
      const handler = registeredResources.get('project_context')!.handler;
      const result = await handler();

      expect(result.contents).toBeDefined();
      expect(result.contents[0].uri).toBe('codebuddy://project/context');
      expect(result.contents[0].text).toContain('Project Context');
    });

    it('project_instructions should scan for instruction files', async () => {
      const handler = registeredResources.get('project_instructions')!.handler;
      const result = await handler();

      expect(result.contents).toBeDefined();
      expect(result.contents[0].uri).toBe('codebuddy://project/instructions');
    });

    it('sessions_latest should return latest session as JSON', async () => {
      const handler = registeredResources.get('sessions_latest')!.handler;
      const result = await handler();

      expect(result.contents).toBeDefined();
      expect(result.contents[0].uri).toBe('codebuddy://sessions/latest');
      expect(result.contents[0].mimeType).toBe('application/json');
      const data = JSON.parse(result.contents[0].text);
      expect(data.id).toBe('session-1');
    });

    it('sessions_latest should handle no sessions', async () => {
      mockGetRecentSessions.mockResolvedValueOnce([]);
      const handler = registeredResources.get('sessions_latest')!.handler;
      const result = await handler();

      const data = JSON.parse(result.contents[0].text);
      expect(data.message).toBe('No sessions found');
    });

    it('memory_all should return formatted memories', async () => {
      const handler = registeredResources.get('memory_all')!.handler;
      const result = await handler();

      expect(result.contents).toBeDefined();
      expect(result.contents[0].uri).toBe('codebuddy://memory/all');
      expect(result.contents[0].text).toContain('Memories');
    });
  });

  // =========================================================================
  // Prompt Handlers
  // =========================================================================

  describe('prompt handlers', () => {
    it('code_review should generate review prompt', () => {
      const handler = registeredPrompts.get('code_review')!.handler;
      const result = handler({ path: 'src/test.ts' });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content.text).toContain('src/test.ts');
      expect(result.messages[0].content.text).toContain('Bugs');
    });

    it('code_review without path should reference staged changes', () => {
      const handler = registeredPrompts.get('code_review')!.handler;
      const result = handler({});

      expect(result.messages[0].content.text).toContain('staged git changes');
    });

    it('explain_code should generate explanation prompt', () => {
      const handler = registeredPrompts.get('explain_code')!.handler;
      const result = handler({ path: 'src/agent.ts', function_name: 'processMessage' });

      expect(result.messages[0].content.text).toContain('processMessage');
      expect(result.messages[0].content.text).toContain('src/agent.ts');
    });

    it('generate_tests should use specified framework', () => {
      const handler = registeredPrompts.get('generate_tests')!.handler;
      const result = handler({ path: 'src/util.ts', framework: 'vitest' });

      expect(result.messages[0].content.text).toContain('vitest');
    });

    it('refactor should include strategy', () => {
      const handler = registeredPrompts.get('refactor')!.handler;
      const result = handler({ path: 'src/big.ts', strategy: 'extract-function' });

      expect(result.messages[0].content.text).toContain('extract-function');
    });

    it('fix_bugs should include description when provided', () => {
      const handler = registeredPrompts.get('fix_bugs')!.handler;
      const result = handler({ path: 'src/broken.ts', description: 'crashes on empty input' });

      expect(result.messages[0].content.text).toContain('crashes on empty input');
    });
  });

  // =========================================================================
  // Agent Lazy Initialization
  // =========================================================================

  describe('agent lazy initialization', () => {
    it('should not initialize agent on construction', () => {
      const { CodeBuddyAgent } = require('../../src/agent/codebuddy-agent');
      // Agent is only initialized when a tool handler is called
      // The constructor creates the MCP server but not the agent
      expect(CodeBuddyAgent).not.toHaveBeenCalled();
    });

    it('should initialize agent on first agent tool call', async () => {
      const handler = registeredTools.get('agent_chat')!.handler;
      await handler({ message: 'test' });

      const { CodeBuddyAgent } = require('../../src/agent/codebuddy-agent');
      expect(CodeBuddyAgent).toHaveBeenCalled();
      expect(CodeBuddyAgent.mock.calls[0][0]).toBe('test-key-123');
    });

    it('should throw when no API key is set', async () => {
      delete process.env.GROK_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      // Create new server without API key
      registeredTools.clear();
      const noKeyServer = new CodeBuddyMCPServer();

      const handler = registeredTools.get('agent_chat')!.handler;
      const result = await handler({ message: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('No API key found');

      // Restore for other tests
      process.env.GROK_API_KEY = 'test-key-123';
    });
  });

  // =========================================================================
  // Concurrency Lock
  // =========================================================================

  describe('concurrency lock', () => {
    it('should serialize concurrent agent calls', async () => {
      const callOrder: number[] = [];
      let callCount = 0;

      mockProcessUserMessage.mockImplementation(async () => {
        const myCall = ++callCount;
        callOrder.push(myCall);
        // Simulate some async work
        await new Promise(r => setTimeout(r, 10));
        callOrder.push(myCall * 10); // 10 = first call done, 20 = second call done
        return [{ type: 'assistant', content: `Response ${myCall}`, timestamp: new Date() }];
      });

      const handler = registeredTools.get('agent_chat')!.handler;

      // Fire two calls concurrently
      const [result1, result2] = await Promise.all([
        handler({ message: 'first' }),
        handler({ message: 'second' }),
      ]);

      // Both should succeed
      expect(result1.content[0].text).toContain('Response');
      expect(result2.content[0].text).toContain('Response');

      // Calls should be serialized: first call starts and finishes before second starts
      expect(callOrder[0]).toBe(1);  // First call started
      expect(callOrder[1]).toBe(10); // First call finished
      expect(callOrder[2]).toBe(2);  // Second call started
      expect(callOrder[3]).toBe(20); // Second call finished
    });
  });

  // =========================================================================
  // formatAgentResponse
  // =========================================================================

  describe('formatAgentResponse', () => {
    it('should format assistant entries', () => {
      const result = formatAgentResponse([
        { type: 'assistant', content: 'Hello world', timestamp: new Date() },
      ]);
      expect(result).toBe('Hello world');
    });

    it('should format tool calls and results', () => {
      const result = formatAgentResponse([
        { type: 'tool_call', content: '', toolCall: { id: 'call_1', type: 'function' as const, function: { name: 'read_file', arguments: '{}' } }, timestamp: new Date() },
        { type: 'tool_result', content: '', toolResult: { success: true, output: 'file data' }, timestamp: new Date() },
      ]);
      expect(result).toContain('[Tool Call: read_file]');
      expect(result).toContain('[Tool Result: Success]');
      expect(result).toContain('file data');
    });

    it('should format error results', () => {
      const result = formatAgentResponse([
        { type: 'tool_result', content: '', toolResult: { success: false, error: 'File not found' }, timestamp: new Date() },
      ]);
      expect(result).toContain('[Tool Result: Error]');
      expect(result).toContain('File not found');
    });

    it('should format reasoning entries', () => {
      const result = formatAgentResponse([
        { type: 'reasoning', content: 'Thinking about it...', timestamp: new Date() },
      ]);
      expect(result).toContain('[Reasoning]');
      expect(result).toContain('Thinking about it...');
    });

    it('should return fallback for empty entries', () => {
      const result = formatAgentResponse([]);
      expect(result).toBe('No response generated.');
    });
  });

  // =========================================================================
  // Server Lifecycle with Agent Cleanup
  // =========================================================================

  describe('server lifecycle with agent', () => {
    it('should dispose agent on stop', async () => {
      // Trigger agent initialization
      const handler = registeredTools.get('agent_chat')!.handler;
      await handler({ message: 'init' });

      await server.start();
      await server.stop();

      expect(mockDispose).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Static Tool Definitions
  // =========================================================================

  describe('getToolDefinitions includes new tools', () => {
    it('should list all 15 tools', () => {
      const defs = CodeBuddyMCPServer.getToolDefinitions();
      expect(defs).toHaveLength(15);
    });

    it('should include agent tools in definitions', () => {
      const defs = CodeBuddyMCPServer.getToolDefinitions();
      const names = defs.map(d => d.name);
      expect(names).toContain('agent_chat');
      expect(names).toContain('agent_task');
      expect(names).toContain('agent_plan');
      expect(names).toContain('memory_search');
      expect(names).toContain('memory_save');
      expect(names).toContain('session_list');
      expect(names).toContain('session_resume');
      expect(names).toContain('web_search');
    });

    it('agent_chat should require message parameter', () => {
      const defs = CodeBuddyMCPServer.getToolDefinitions();
      const agentChat = defs.find(d => d.name === 'agent_chat')!;
      expect(agentChat.inputSchema.required).toContain('message');
    });

    it('memory_save should require key and value', () => {
      const defs = CodeBuddyMCPServer.getToolDefinitions();
      const memorySave = defs.find(d => d.name === 'memory_save')!;
      expect(memorySave.inputSchema.required).toContain('key');
      expect(memorySave.inputSchema.required).toContain('value');
    });
  });
});
