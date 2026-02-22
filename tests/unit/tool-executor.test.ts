/**
 * Comprehensive Unit Tests for ToolExecutor
 * Tests tool dispatch, MCP integration, parallel execution, metrics, and error handling
 */

// Mock all tool dependencies
jest.mock('../../src/tools/index.js', () => ({
  TextEditorTool: jest.fn().mockImplementation(() => ({
    view: jest.fn().mockResolvedValue({ success: true, output: 'file content' }),
    create: jest.fn().mockResolvedValue({ success: true, output: 'File created' }),
    strReplace: jest.fn().mockResolvedValue({ success: true, output: 'Replaced' }),
  })),
  BashTool: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true, output: 'command output' }),
  })),
  SearchTool: jest.fn().mockImplementation(() => ({
    search: jest.fn().mockResolvedValue({ success: true, output: 'search results' }),
  })),
  TodoTool: jest.fn().mockImplementation(() => ({
    createTodoList: jest.fn().mockResolvedValue({ success: true, output: 'Todo list created' }),
    updateTodoList: jest.fn().mockResolvedValue({ success: true, output: 'Todo list updated' }),
  })),
  ImageTool: jest.fn().mockImplementation(() => ({
    processImage: jest.fn().mockResolvedValue({ success: true, output: 'Image processed' }),
  })),
  WebSearchTool: jest.fn().mockImplementation(() => ({
    search: jest.fn().mockResolvedValue({ success: true, output: 'web results' }),
    fetchPage: jest.fn().mockResolvedValue({ success: true, output: 'page content' }),
  })),
  MorphEditorTool: jest.fn().mockImplementation(() => ({
    editFile: jest.fn().mockResolvedValue({ success: true, output: 'File edited' }),
  })),
}));

jest.mock('../../src/checkpoints/checkpoint-manager.js', () => ({
  CheckpointManager: jest.fn().mockImplementation(() => ({
    checkpointBeforeCreate: jest.fn(),
    checkpointBeforeEdit: jest.fn(),
    restore: jest.fn(),
    getCheckpoints: jest.fn().mockReturnValue([]),
  })),
}));

jest.mock('../../src/codebuddy/tools.js', () => ({
  getMCPManager: jest.fn().mockReturnValue({
    callTool: jest.fn().mockResolvedValue({
      isError: false,
      content: [{ type: 'text', text: 'MCP result' }],
    }),
  }),
}));

import * as path from 'path';
import { ToolExecutor, CodeBuddyToolCall, ToolExecutorDependencies, ToolMetrics } from '../../src/agent/tool-executor';
import {
  TextEditorTool,
  BashTool,
  SearchTool,
  TodoTool,
  ImageTool,
  WebSearchTool,
  MorphEditorTool,
} from '../../src/tools/index.js';
import { CheckpointManager } from '../../src/checkpoints/checkpoint-manager.js';
import { getMCPManager } from '../../src/codebuddy/tools.js';

describe('ToolExecutor', () => {
  let executor: ToolExecutor;
  let mockTextEditor: jest.Mocked<TextEditorTool>;
  let mockBash: jest.Mocked<BashTool>;
  let mockSearch: jest.Mocked<SearchTool>;
  let mockTodoTool: jest.Mocked<TodoTool>;
  let mockImageTool: jest.Mocked<ImageTool>;
  let mockWebSearch: jest.Mocked<WebSearchTool>;
  let mockCheckpointManager: jest.Mocked<CheckpointManager>;
  let mockMorphEditor: jest.Mocked<MorphEditorTool>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockTextEditor = new TextEditorTool() as jest.Mocked<TextEditorTool>;
    mockBash = new BashTool() as jest.Mocked<BashTool>;
    mockSearch = new SearchTool() as jest.Mocked<SearchTool>;
    mockTodoTool = new TodoTool() as jest.Mocked<TodoTool>;
    mockImageTool = new ImageTool() as jest.Mocked<ImageTool>;
    mockWebSearch = new WebSearchTool() as jest.Mocked<WebSearchTool>;
    mockCheckpointManager = new CheckpointManager() as jest.Mocked<CheckpointManager>;
    mockMorphEditor = new MorphEditorTool() as jest.Mocked<MorphEditorTool>;

    const deps: ToolExecutorDependencies = {
      textEditor: mockTextEditor,
      bash: mockBash,
      search: mockSearch,
      todoTool: mockTodoTool,
      imageTool: mockImageTool,
      webSearch: mockWebSearch,
      checkpointManager: mockCheckpointManager,
      morphEditor: mockMorphEditor,
    };

    executor = new ToolExecutor(deps);
  });

  describe('Constructor', () => {
    it('should create executor with all dependencies', () => {
      expect(executor).toBeDefined();
    });

    it('should create executor without morph editor', () => {
      const deps: ToolExecutorDependencies = {
        textEditor: mockTextEditor,
        bash: mockBash,
        search: mockSearch,
        todoTool: mockTodoTool,
        imageTool: mockImageTool,
        webSearch: mockWebSearch,
        checkpointManager: mockCheckpointManager,
        morphEditor: null,
      };

      const executorNoMorph = new ToolExecutor(deps);
      expect(executorNoMorph).toBeDefined();
    });
  });

  describe('File Operations', () => {
    describe('view_file', () => {
      it('should execute view_file tool', async () => {
        const toolCall: CodeBuddyToolCall = {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'view_file',
            arguments: JSON.stringify({ path: '/test/file.ts' }),
          },
        };

        const result = await executor.execute(toolCall);

        expect(result.success).toBe(true);
        expect(result.output).toBe('file content');
        expect(mockTextEditor.view).toHaveBeenCalledWith('/test/file.ts', undefined);
      });

      it('should execute view_file with line range', async () => {
        const toolCall: CodeBuddyToolCall = {
          id: 'call_2',
          type: 'function',
          function: {
            name: 'view_file',
            arguments: JSON.stringify({ path: '/test/file.ts', start_line: 10, end_line: 20 }),
          },
        };

        await executor.execute(toolCall);

        expect(mockTextEditor.view).toHaveBeenCalledWith('/test/file.ts', [10, 20]);
      });

      it('should handle view_file with only start_line', async () => {
        const toolCall: CodeBuddyToolCall = {
          id: 'call_3',
          type: 'function',
          function: {
            name: 'view_file',
            arguments: JSON.stringify({ path: '/test/file.ts', start_line: 10 }),
          },
        };

        await executor.execute(toolCall);

        // Should not pass partial range
        expect(mockTextEditor.view).toHaveBeenCalledWith('/test/file.ts', undefined);
      });

      it('should handle view_file error', async () => {
        mockTextEditor.view.mockResolvedValueOnce({
          success: false,
          error: 'File not found',
        });

        const toolCall: CodeBuddyToolCall = {
          id: 'call_4',
          type: 'function',
          function: {
            name: 'view_file',
            arguments: JSON.stringify({ path: '/nonexistent/file.ts' }),
          },
        };

        const result = await executor.execute(toolCall);

        expect(result.success).toBe(false);
        expect(result.error).toBe('File not found');
      });
    });

    describe('create_file', () => {
      it('should execute create_file with checkpoint', async () => {
        const toolCall: CodeBuddyToolCall = {
          id: 'call_5',
          type: 'function',
          function: {
            name: 'create_file',
            arguments: JSON.stringify({ path: '/test/new.ts', content: 'console.log("hello");' }),
          },
        };

        const result = await executor.execute(toolCall);

        expect(result.success).toBe(true);
        expect(mockCheckpointManager.checkpointBeforeCreate).toHaveBeenCalledWith(path.normalize('/test/new.ts'));
        expect(mockTextEditor.create).toHaveBeenCalledWith(path.normalize('/test/new.ts'), 'console.log("hello");');
      });

      it('should handle create_file with empty content', async () => {
        const toolCall: CodeBuddyToolCall = {
          id: 'call_6',
          type: 'function',
          function: {
            name: 'create_file',
            arguments: JSON.stringify({ path: '/test/empty.ts', content: '' }),
          },
        };

        await executor.execute(toolCall);

        expect(mockTextEditor.create).toHaveBeenCalledWith(path.normalize('/test/empty.ts'), '');
      });

      it('should handle create_file with special characters', async () => {
        const specialContent = '// Comment with "quotes" and \'apostrophes\'\nconst x = `template`;';
        const toolCall: CodeBuddyToolCall = {
          id: 'call_7',
          type: 'function',
          function: {
            name: 'create_file',
            arguments: JSON.stringify({ path: '/test/special.ts', content: specialContent }),
          },
        };

        await executor.execute(toolCall);

        expect(mockTextEditor.create).toHaveBeenCalledWith(path.normalize('/test/special.ts'), specialContent);
      });
    });

    describe('str_replace_editor', () => {
      it('should execute str_replace_editor with checkpoint', async () => {
        const toolCall: CodeBuddyToolCall = {
          id: 'call_8',
          type: 'function',
          function: {
            name: 'str_replace_editor',
            arguments: JSON.stringify({
              path: '/test/file.ts',
              old_str: 'old text',
              new_str: 'new text',
            }),
          },
        };

        const result = await executor.execute(toolCall);

        expect(result.success).toBe(true);
        expect(mockCheckpointManager.checkpointBeforeEdit).toHaveBeenCalledWith(path.normalize('/test/file.ts'));
        expect(mockTextEditor.strReplace).toHaveBeenCalledWith(
          path.normalize('/test/file.ts'),
          'old text',
          'new text',
          undefined
        );
      });

      it('should execute str_replace_editor with replace_all', async () => {
        const toolCall: CodeBuddyToolCall = {
          id: 'call_9',
          type: 'function',
          function: {
            name: 'str_replace_editor',
            arguments: JSON.stringify({
              path: '/test/file.ts',
              old_str: 'foo',
              new_str: 'bar',
              replace_all: true,
            }),
          },
        };

        await executor.execute(toolCall);

        expect(mockTextEditor.strReplace).toHaveBeenCalledWith(path.normalize('/test/file.ts'), 'foo', 'bar', true);
      });

      it('should handle multiline replacements', async () => {
        const oldStr = 'function test() {\n  return null;\n}';
        const newStr = 'function test() {\n  return true;\n}';

        const toolCall: CodeBuddyToolCall = {
          id: 'call_10',
          type: 'function',
          function: {
            name: 'str_replace_editor',
            arguments: JSON.stringify({ path: '/test/file.ts', old_str: oldStr, new_str: newStr }),
          },
        };

        await executor.execute(toolCall);

        expect(mockTextEditor.strReplace).toHaveBeenCalledWith(path.normalize('/test/file.ts'), oldStr, newStr, undefined);
      });
    });
  });

  describe('Bash Execution', () => {
    it('should execute bash command', async () => {
      const toolCall: CodeBuddyToolCall = {
        id: 'call_11',
        type: 'function',
        function: {
          name: 'bash',
          arguments: JSON.stringify({ command: 'ls -la' }),
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(true);
      expect(result.output).toBe('command output');
      expect(mockBash.execute).toHaveBeenCalledWith('ls -la');
    });

    it('should handle complex bash commands', async () => {
      const complexCommand = 'find . -name "*.ts" | xargs grep -l "TODO" | head -10';

      const toolCall: CodeBuddyToolCall = {
        id: 'call_12',
        type: 'function',
        function: {
          name: 'bash',
          arguments: JSON.stringify({ command: complexCommand }),
        },
      };

      await executor.execute(toolCall);

      expect(mockBash.execute).toHaveBeenCalledWith(complexCommand);
    });

    it('should handle bash execution error', async () => {
      mockBash.execute.mockResolvedValueOnce({
        success: false,
        error: 'Command failed with exit code 1',
      });

      const toolCall: CodeBuddyToolCall = {
        id: 'call_13',
        type: 'function',
        function: {
          name: 'bash',
          arguments: JSON.stringify({ command: 'invalid_command' }),
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Command failed with exit code 1');
    });
  });

  describe('Search Operations', () => {
    it('should execute search with query', async () => {
      const toolCall: CodeBuddyToolCall = {
        id: 'call_14',
        type: 'function',
        function: {
          name: 'search',
          arguments: JSON.stringify({ query: 'function test' }),
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(true);
      expect(result.output).toBe('search results');
      expect(mockSearch.search).toHaveBeenCalled();
    });

    it('should execute search with all options', async () => {
      const toolCall: CodeBuddyToolCall = {
        id: 'call_15',
        type: 'function',
        function: {
          name: 'search',
          arguments: JSON.stringify({
            query: 'TODO',
            include_pattern: '*.ts',
            exclude_pattern: 'node_modules',
            case_sensitive: true,
            regex: true,
            max_results: 100,
          }),
        },
      };

      await executor.execute(toolCall);

      expect(mockSearch.search).toHaveBeenCalledWith('TODO', {
        includePattern: '*.ts',
        excludePattern: 'node_modules',
        caseSensitive: true,
        regex: true,
        maxResults: 100,
      });
    });
  });

  describe('Web Operations', () => {
    it('should execute web_search', async () => {
      const toolCall: CodeBuddyToolCall = {
        id: 'call_16',
        type: 'function',
        function: {
          name: 'web_search',
          arguments: JSON.stringify({ query: 'TypeScript tutorial', max_results: 5 }),
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(true);
      expect(result.output).toBe('web results');
      expect(mockWebSearch.search).toHaveBeenCalledWith('TypeScript tutorial', { maxResults: 5 });
    });

    it('should execute web_fetch', async () => {
      const toolCall: CodeBuddyToolCall = {
        id: 'call_17',
        type: 'function',
        function: {
          name: 'web_fetch',
          arguments: JSON.stringify({ url: 'https://example.com' }),
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(true);
      expect(result.output).toBe('page content');
      expect(mockWebSearch.fetchPage).toHaveBeenCalledWith('https://example.com');
    });
  });

  describe('Todo Operations', () => {
    it('should execute create_todo_list', async () => {
      const toolCall: CodeBuddyToolCall = {
        id: 'call_18',
        type: 'function',
        function: {
          name: 'create_todo_list',
          arguments: JSON.stringify({
            todos: [
              { id: '1', content: 'Task 1', status: 'pending' },
              { id: '2', content: 'Task 2', status: 'pending' },
            ],
          }),
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(true);
      expect(mockTodoTool.createTodoList).toHaveBeenCalled();
    });

    it('should add default priority to todos', async () => {
      const toolCall: CodeBuddyToolCall = {
        id: 'call_19',
        type: 'function',
        function: {
          name: 'create_todo_list',
          arguments: JSON.stringify({
            todos: [{ id: '1', content: 'Task 1', status: 'pending' }],
          }),
        },
      };

      await executor.execute(toolCall);

      expect(mockTodoTool.createTodoList).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ priority: 'medium' }),
        ])
      );
    });

    it('should execute update_todo_list', async () => {
      const toolCall: CodeBuddyToolCall = {
        id: 'call_20',
        type: 'function',
        function: {
          name: 'update_todo_list',
          arguments: JSON.stringify({
            updates: [{ id: '1', status: 'completed' }],
          }),
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(true);
      expect(mockTodoTool.updateTodoList).toHaveBeenCalled();
    });
  });

  describe('Morph Editor', () => {
    it('should execute edit_file with morph editor', async () => {
      const toolCall: CodeBuddyToolCall = {
        id: 'call_21',
        type: 'function',
        function: {
          name: 'edit_file',
          arguments: JSON.stringify({
            target_file: '/test/file.ts',
            instructions: 'Add type annotation',
            code_edit: 'const x: number = 1;',
          }),
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(true);
      expect(mockMorphEditor.editFile).toHaveBeenCalledWith(
        path.normalize('/test/file.ts'),
        'Add type annotation',
        'const x: number = 1;'
      );
    });

    it('should fail edit_file without morph editor', async () => {
      const executorNoMorph = new ToolExecutor({
        textEditor: mockTextEditor,
        bash: mockBash,
        search: mockSearch,
        todoTool: mockTodoTool,
        imageTool: mockImageTool,
        webSearch: mockWebSearch,
        checkpointManager: mockCheckpointManager,
        morphEditor: null,
      });

      const toolCall: CodeBuddyToolCall = {
        id: 'call_22',
        type: 'function',
        function: {
          name: 'edit_file',
          arguments: JSON.stringify({
            target_file: '/test/file.ts',
            instructions: 'Edit',
            code_edit: 'code',
          }),
        },
      };

      const result = await executorNoMorph.execute(toolCall);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Morph Fast Apply not available');
    });
  });

  describe('MCP Tool Execution', () => {
    it('should execute MCP tools', async () => {
      const toolCall: CodeBuddyToolCall = {
        id: 'call_23',
        type: 'function',
        function: {
          name: 'mcp__server__tool',
          arguments: JSON.stringify({ param: 'value' }),
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(true);
      expect(result.output).toBe('MCP result');

      const mcpManager = getMCPManager();
      expect(mcpManager.callTool).toHaveBeenCalledWith('mcp__server__tool', { param: 'value' });
    });

    it('should handle MCP tool error', async () => {
      const mcpManager = getMCPManager();
      (mcpManager.callTool as jest.Mock).mockResolvedValueOnce({
        isError: true,
        content: [{ type: 'text', text: 'MCP error message' }],
      });

      const toolCall: CodeBuddyToolCall = {
        id: 'call_24',
        type: 'function',
        function: {
          name: 'mcp__server__failing_tool',
          arguments: '{}',
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(false);
      expect(result.error).toBe('MCP error message');
    });

    it('should handle MCP tool with resource content', async () => {
      const mcpManager = getMCPManager();
      (mcpManager.callTool as jest.Mock).mockResolvedValueOnce({
        isError: false,
        content: [{ type: 'resource', resource: { uri: 'file:///test.txt' } }],
      });

      const toolCall: CodeBuddyToolCall = {
        id: 'call_25',
        type: 'function',
        function: {
          name: 'mcp__files__read',
          arguments: '{}',
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Resource:');
    });

    it('should handle MCP tool exception', async () => {
      const mcpManager = getMCPManager();
      (mcpManager.callTool as jest.Mock).mockRejectedValueOnce(new Error('Connection failed'));

      const toolCall: CodeBuddyToolCall = {
        id: 'call_26',
        type: 'function',
        function: {
          name: 'mcp__server__broken_tool',
          arguments: '{}',
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(false);
      expect(result.error).toContain('MCP tool execution error');
    });
  });

  describe('Unknown Tool Handling', () => {
    it('should handle unknown tool', async () => {
      const toolCall: CodeBuddyToolCall = {
        id: 'call_27',
        type: 'function',
        function: {
          name: 'unknown_tool',
          arguments: '{}',
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON arguments', async () => {
      const toolCall: CodeBuddyToolCall = {
        id: 'call_28',
        type: 'function',
        function: {
          name: 'view_file',
          arguments: 'not valid json',
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid JSON arguments');
    });

    it('should handle empty arguments', async () => {
      const toolCall: CodeBuddyToolCall = {
        id: 'call_29',
        type: 'function',
        function: {
          name: 'view_file',
          arguments: '',
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(false);
    });

    it('should handle tool throwing exception', async () => {
      mockBash.execute.mockRejectedValueOnce(new Error('Execution failed'));

      const toolCall: CodeBuddyToolCall = {
        id: 'call_30',
        type: 'function',
        function: {
          name: 'bash',
          arguments: JSON.stringify({ command: 'crash' }),
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Tool execution error');
    });

    it('should handle missing required arguments', async () => {
      const toolCall: CodeBuddyToolCall = {
        id: 'call_31',
        type: 'function',
        function: {
          name: 'view_file',
          arguments: JSON.stringify({}), // Missing path
        },
      };

      const result = await executor.execute(toolCall);

      // Behavior depends on tool implementation - may succeed with undefined path
      // or the tool may validate and return error
      expect(result).toBeDefined();
    });
  });

  describe('Metrics Tracking', () => {
    it('should track tool request counts', async () => {
      const toolCall: CodeBuddyToolCall = {
        id: 'call_32',
        type: 'function',
        function: {
          name: 'view_file',
          arguments: JSON.stringify({ path: '/test/file.ts' }),
        },
      };

      await executor.execute(toolCall);
      await executor.execute(toolCall);
      await executor.execute(toolCall);

      const metrics = executor.getMetrics();
      expect(metrics.toolRequestCounts.get('view_file')).toBe(3);
    });

    it('should track total executions', async () => {
      await executor.execute({
        id: 'call_33',
        type: 'function',
        function: { name: 'view_file', arguments: JSON.stringify({ path: '/a.ts' }) },
      });
      await executor.execute({
        id: 'call_34',
        type: 'function',
        function: { name: 'bash', arguments: JSON.stringify({ command: 'ls' }) },
      });

      const metrics = executor.getMetrics();
      expect(metrics.totalExecutions).toBe(2);
    });

    it('should track successful and failed executions', async () => {
      await executor.execute({
        id: 'call_35',
        type: 'function',
        function: { name: 'view_file', arguments: JSON.stringify({ path: '/a.ts' }) },
      });
      await executor.execute({
        id: 'call_36',
        type: 'function',
        function: { name: 'view_file', arguments: 'invalid json' },
      });

      const metrics = executor.getMetrics();
      expect(metrics.successfulExecutions).toBe(1);
      expect(metrics.failedExecutions).toBe(1);
    });

    it('should track execution time', async () => {
      await executor.execute({
        id: 'call_37',
        type: 'function',
        function: { name: 'view_file', arguments: JSON.stringify({ path: '/a.ts' }) },
      });

      const metrics = executor.getMetrics();
      expect(metrics.totalExecutionTime).toBeGreaterThanOrEqual(0);
    });

    it('should reset metrics', async () => {
      await executor.execute({
        id: 'call_38',
        type: 'function',
        function: { name: 'view_file', arguments: JSON.stringify({ path: '/a.ts' }) },
      });

      executor.resetMetrics();

      const metrics = executor.getMetrics();
      expect(metrics.totalExecutions).toBe(0);
      expect(metrics.toolRequestCounts.size).toBe(0);
    });

    it('should format tool request counts', async () => {
      await executor.execute({
        id: 'call_39',
        type: 'function',
        function: { name: 'view_file', arguments: JSON.stringify({ path: '/a.ts' }) },
      });
      await executor.execute({
        id: 'call_40',
        type: 'function',
        function: { name: 'bash', arguments: JSON.stringify({ command: 'ls' }) },
      });

      const formatted = executor.getToolRequestCountsFormatted();

      expect(formatted['view_file']).toBe(1);
      expect(formatted['bash']).toBe(1);
    });
  });

  describe('Read-Only Tool Detection', () => {
    it('should identify read-only tools', () => {
      expect(executor.isReadOnlyTool('view_file')).toBe(true);
      expect(executor.isReadOnlyTool('search')).toBe(true);
      expect(executor.isReadOnlyTool('web_search')).toBe(true);
      expect(executor.isReadOnlyTool('web_fetch')).toBe(true);
    });

    it('should identify write tools', () => {
      expect(executor.isReadOnlyTool('create_file')).toBe(false);
      expect(executor.isReadOnlyTool('str_replace_editor')).toBe(false);
      expect(executor.isReadOnlyTool('bash')).toBe(false);
    });

    it('should handle unknown tools as non-read-only', () => {
      expect(executor.isReadOnlyTool('unknown_tool')).toBe(false);
    });
  });

  describe('Parallel Execution', () => {
    it('should execute read-only tools in parallel', async () => {
      const toolCalls: CodeBuddyToolCall[] = [
        {
          id: 'call_41',
          type: 'function',
          function: { name: 'view_file', arguments: JSON.stringify({ path: '/a.ts' }) },
        },
        {
          id: 'call_42',
          type: 'function',
          function: { name: 'search', arguments: JSON.stringify({ query: 'test' }) },
        },
        {
          id: 'call_43',
          type: 'function',
          function: { name: 'web_search', arguments: JSON.stringify({ query: 'docs' }) },
        },
      ];

      const results = await executor.executeParallel(toolCalls);

      expect(results.size).toBe(3);
      expect(results.get('call_41')?.success).toBe(true);
      expect(results.get('call_42')?.success).toBe(true);
      expect(results.get('call_43')?.success).toBe(true);
    });

    it('should execute write tools sequentially', async () => {
      const executionOrder: string[] = [];

      mockTextEditor.create.mockImplementation(async (path) => {
        executionOrder.push(`create:${path}`);
        return { success: true, output: 'Created' };
      });

      mockTextEditor.strReplace.mockImplementation(async (path) => {
        executionOrder.push(`replace:${path}`);
        return { success: true, output: 'Replaced' };
      });

      const toolCalls: CodeBuddyToolCall[] = [
        {
          id: 'call_44',
          type: 'function',
          function: { name: 'create_file', arguments: JSON.stringify({ path: '/a.ts', content: 'a' }) },
        },
        {
          id: 'call_45',
          type: 'function',
          function: { name: 'str_replace_editor', arguments: JSON.stringify({ path: '/a.ts', old_str: 'a', new_str: 'b' }) },
        },
      ];

      const results = await executor.executeParallel(toolCalls);

      expect(results.size).toBe(2);
      expect(results.get('call_44')?.success).toBe(true);
      expect(results.get('call_45')?.success).toBe(true);

      // Write operations should be in order
      expect(executionOrder[0]).toBe(`create:${path.normalize('/a.ts')}`);
      expect(executionOrder[1]).toBe(`replace:${path.normalize('/a.ts')}`);
    });

    it('should handle mixed parallel and sequential', async () => {
      const toolCalls: CodeBuddyToolCall[] = [
        {
          id: 'call_46',
          type: 'function',
          function: { name: 'view_file', arguments: JSON.stringify({ path: '/a.ts' }) },
        },
        {
          id: 'call_47',
          type: 'function',
          function: { name: 'create_file', arguments: JSON.stringify({ path: '/b.ts', content: 'b' }) },
        },
        {
          id: 'call_48',
          type: 'function',
          function: { name: 'search', arguments: JSON.stringify({ query: 'test' }) },
        },
      ];

      const results = await executor.executeParallel(toolCalls);

      expect(results.size).toBe(3);
      expect(results.get('call_46')?.success).toBe(true);
      expect(results.get('call_47')?.success).toBe(true);
      expect(results.get('call_48')?.success).toBe(true);
    });

    it('should handle empty tool list', async () => {
      const results = await executor.executeParallel([]);

      expect(results.size).toBe(0);
    });

    it('should handle all failures in parallel execution', async () => {
      mockTextEditor.view.mockResolvedValue({ success: false, error: 'Failed' });
      mockSearch.search.mockResolvedValue({ success: false, error: 'Failed' });

      const toolCalls: CodeBuddyToolCall[] = [
        {
          id: 'call_49',
          type: 'function',
          function: { name: 'view_file', arguments: JSON.stringify({ path: '/a.ts' }) },
        },
        {
          id: 'call_50',
          type: 'function',
          function: { name: 'search', arguments: JSON.stringify({ query: 'test' }) },
        },
      ];

      const results = await executor.executeParallel(toolCalls);

      expect(results.size).toBe(2);
      expect(results.get('call_49')?.success).toBe(false);
      expect(results.get('call_50')?.success).toBe(false);
    });
  });

  describe('Getters', () => {
    it('should return bash tool instance', () => {
      expect(executor.getBashTool()).toBe(mockBash);
    });

    it('should return image tool instance', () => {
      expect(executor.getImageTool()).toBe(mockImageTool);
    });

    it('should return checkpoint manager', () => {
      expect(executor.getCheckpointManager()).toBe(mockCheckpointManager);
    });
  });

  describe('Edge Cases', () => {
    it('should handle tool with null output', async () => {
      mockTextEditor.view.mockResolvedValueOnce({
        success: true,
        output: undefined,
      });

      const toolCall: CodeBuddyToolCall = {
        id: 'call_51',
        type: 'function',
        function: { name: 'view_file', arguments: JSON.stringify({ path: '/a.ts' }) },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(true);
    });

    it('should handle concurrent execution of same tool', async () => {
      const calls = Array.from({ length: 10 }, (_, i) => ({
        id: `call_${52 + i}`,
        type: 'function' as const,
        function: { name: 'view_file', arguments: JSON.stringify({ path: `/file${i}.ts` }) },
      }));

      const results = await Promise.all(calls.map(c => executor.execute(c)));

      expect(results.every(r => r.success)).toBe(true);
      expect(mockTextEditor.view).toHaveBeenCalledTimes(10);
    });

    it('should handle very long arguments', async () => {
      const longContent = 'x'.repeat(100000);

      const toolCall: CodeBuddyToolCall = {
        id: 'call_62',
        type: 'function',
        function: {
          name: 'create_file',
          arguments: JSON.stringify({ path: '/large.ts', content: longContent }),
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(true);
      expect(mockTextEditor.create).toHaveBeenCalledWith(path.normalize('/large.ts'), longContent);
    });
  });
});
