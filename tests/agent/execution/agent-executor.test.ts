/**
 * Comprehensive Tests for AgentExecutor
 *
 * Tests the core agentic loop that handles sequential and streaming
 * message processing, tool execution rounds, cost limits, abort handling,
 * middleware pipeline integration, and message queue steering.
 */

import { AgentExecutor, ExecutorDependencies, ExecutorConfig } from '../../../src/agent/execution/agent-executor';
import type { ChatEntry, StreamingChunk } from '../../../src/agent/types';
import type { CodeBuddyMessage } from '../../../src/codebuddy/client';

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../../src/errors/index.js', () => ({
  getErrorMessage: jest.fn().mockImplementation((err: unknown) => (err as Error)?.message || String(err)),
}));

jest.mock('../../../src/utils/sanitize.js', () => ({
  sanitizeToolResult: jest.fn().mockImplementation((text: string) => text),
}));

// ---------------------------------------------------------------------------
// Helpers to create mock dependencies
// ---------------------------------------------------------------------------

function createMockDeps(overrides: Partial<ExecutorDependencies> = {}): ExecutorDependencies {
  return {
    client: {
      chat: jest.fn().mockResolvedValue({
        choices: [{ message: { content: 'Test response', tool_calls: null } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
      chatStream: jest.fn().mockImplementation(async function* () {
        yield { choices: [{ delta: { content: 'Test ' } }] };
        yield { choices: [{ delta: { content: 'response' } }] };
      }),
      getCurrentModel: jest.fn().mockReturnValue('test-model'),
    } as any,
    toolHandler: {
      executeTool: jest.fn().mockResolvedValue({ success: true, output: 'Tool result' }),
      executeToolStreaming: jest.fn().mockImplementation(async function* () {
        yield 'stream chunk';
        return { success: true, output: 'streamed' };
      }),
    } as any,
    toolSelectionStrategy: {
      selectToolsForQuery: jest.fn().mockResolvedValue({
        tools: [],
        selection: null,
        fromCache: false,
        query: '',
        timestamp: new Date(),
      }),
      cacheTools: jest.fn(),
      shouldUseSearchFor: jest.fn().mockReturnValue(false),
      clearCache: jest.fn(),
      setActiveSkill: jest.fn(),
    } as any,
    streamingHandler: {
      reset: jest.fn(),
      accumulateChunk: jest.fn().mockReturnValue({
        displayContent: '',
        rawContent: '',
        hasNewToolCalls: false,
        shouldEmitTokenCount: false,
      }),
      extractToolCalls: jest.fn().mockReturnValue({ toolCalls: [], remainingContent: '' }),
      getAccumulatedMessage: jest.fn().mockReturnValue({ content: 'Test response', tool_calls: undefined }),
      getTokenCount: jest.fn().mockReturnValue(50),
      hasYieldedToolCalls: jest.fn().mockReturnValue(false),
    } as any,
    contextManager: {
      prepareMessages: jest.fn().mockImplementation((msgs: unknown[]) => msgs),
      shouldWarn: jest.fn().mockReturnValue({ warn: false }),
    } as any,
    tokenCounter: {
      countTokens: jest.fn().mockReturnValue(100),
      countMessageTokens: jest.fn().mockReturnValue(500),
      dispose: jest.fn(),
    } as any,
    ...overrides,
  };
}

function createMockConfig(overrides: Partial<ExecutorConfig> = {}): ExecutorConfig {
  return {
    maxToolRounds: 50,
    isGrokModel: jest.fn().mockReturnValue(false),
    recordSessionCost: jest.fn(),
    isSessionCostLimitReached: jest.fn().mockReturnValue(false),
    getSessionCost: jest.fn().mockReturnValue(0),
    getSessionCostLimit: jest.fn().mockReturnValue(10),
    ...overrides,
  };
}

function makeToolCall(name: string, args: Record<string, unknown> = {}, id?: string) {
  return {
    id: id || `call_${name}_${Date.now()}`,
    type: 'function' as const,
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

/** Collect all chunks from an async generator */
async function collectChunks(gen: AsyncGenerator<StreamingChunk>): Promise<StreamingChunk[]> {
  const chunks: StreamingChunk[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentExecutor', () => {
  let deps: ExecutorDependencies;
  let config: ExecutorConfig;
  let executor: AgentExecutor;

  beforeEach(() => {
    jest.clearAllMocks();
    deps = createMockDeps();
    config = createMockConfig();
    executor = new AgentExecutor(deps, config);
  });

  // =========================================================================
  // Constructor
  // =========================================================================

  describe('Constructor', () => {
    it('should create an AgentExecutor instance', () => {
      expect(executor).toBeInstanceOf(AgentExecutor);
    });

    it('should accept dependencies and config', () => {
      const exec = new AgentExecutor(deps, config);
      expect(exec).toBeDefined();
    });
  });

  // =========================================================================
  // Middleware Pipeline
  // =========================================================================

  describe('Middleware Pipeline', () => {
    it('should return undefined when no pipeline is set', () => {
      expect(executor.getMiddlewarePipeline()).toBeUndefined();
    });

    it('should set and retrieve middleware pipeline', () => {
      const mockPipeline = {
        use: jest.fn(),
        remove: jest.fn(),
        runBeforeTurn: jest.fn().mockResolvedValue({ action: 'continue' }),
        runAfterTurn: jest.fn().mockResolvedValue({ action: 'continue' }),
        getMiddlewareNames: jest.fn().mockReturnValue([]),
      } as any;

      executor.setMiddlewarePipeline(mockPipeline);
      expect(executor.getMiddlewarePipeline()).toBe(mockPipeline);
    });
  });

  // =========================================================================
  // processUserMessage (Sequential)
  // =========================================================================

  describe('processUserMessage', () => {
    it('should return assistant entry for simple message with no tool calls', async () => {
      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [{ role: 'system', content: 'System' }];

      const entries = await executor.processUserMessage('Hello', history, messages);

      expect(entries.length).toBe(1);
      expect(entries[0].type).toBe('assistant');
      expect(entries[0].content).toBe('Test response');
    });

    it('should add assistant response to history', async () => {
      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [{ role: 'system', content: 'System' }];

      await executor.processUserMessage('Hello', history, messages);

      expect(history.length).toBe(1);
      expect(history[0].type).toBe('assistant');
    });

    it('should add assistant message to LLM messages array', async () => {
      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [{ role: 'system', content: 'System' }];

      await executor.processUserMessage('Hello', history, messages);

      const assistantMsg = messages.find(m => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
    });

    it('should call tool selection strategy', async () => {
      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await executor.processUserMessage('Hello', history, messages);

      expect(deps.toolSelectionStrategy.selectToolsForQuery).toHaveBeenCalledWith('Hello');
    });

    it('should call context manager to prepare messages', async () => {
      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await executor.processUserMessage('Hello', history, messages);

      expect(deps.contextManager.prepareMessages).toHaveBeenCalled();
    });

    it('should record session cost', async () => {
      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await executor.processUserMessage('Hello', history, messages);

      expect(config.recordSessionCost).toHaveBeenCalled();
    });

    it('should handle tool calls from LLM', async () => {
      const toolCall = makeToolCall('read_file', { path: '/test.txt' });

      // First response has tool calls, second is final
      (deps.client.chat as jest.Mock)
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Reading file...', tool_calls: [toolCall] } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'File contents here.', tool_calls: null } }],
          usage: { prompt_tokens: 200, completion_tokens: 60 },
        });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const entries = await executor.processUserMessage('Read test.txt', history, messages);

      // Should have: assistant (tool call), tool_result, assistant (final)
      expect(entries.some(e => e.type === 'tool_result')).toBe(true);
      expect(entries.some(e => e.type === 'assistant' && e.content === 'File contents here.')).toBe(true);
      expect(deps.toolHandler.executeTool).toHaveBeenCalled();
    });

    it('should execute multiple tool calls in one round', async () => {
      const toolCall1 = makeToolCall('read_file', { path: '/a.txt' }, 'call_1');
      const toolCall2 = makeToolCall('read_file', { path: '/b.txt' }, 'call_2');

      (deps.client.chat as jest.Mock)
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Reading files...', tool_calls: [toolCall1, toolCall2] } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Done.', tool_calls: null } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const entries = await executor.processUserMessage('Read both files', history, messages);

      const toolResults = entries.filter(e => e.type === 'tool_result');
      expect(toolResults.length).toBe(2);
      expect(deps.toolHandler.executeTool).toHaveBeenCalledTimes(2);
    });

    it('should handle multi-round tool execution', async () => {
      const toolCall1 = makeToolCall('read_file', { path: '/a.txt' }, 'call_1');
      const toolCall2 = makeToolCall('bash', { command: 'echo ok' }, 'call_2');

      (deps.client.chat as jest.Mock)
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Reading...', tool_calls: [toolCall1] } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Running...', tool_calls: [toolCall2] } }],
          usage: { prompt_tokens: 200, completion_tokens: 50 },
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'All done.', tool_calls: null } }],
          usage: { prompt_tokens: 300, completion_tokens: 30 },
        });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const entries = await executor.processUserMessage('Do the thing', history, messages);

      expect(deps.toolHandler.executeTool).toHaveBeenCalledTimes(2);
      const finalEntry = entries[entries.length - 1];
      expect(finalEntry.content).toBe('All done.');
    });

    it('should stop after maxToolRounds', async () => {
      config.maxToolRounds = 2;
      executor = new AgentExecutor(deps, config);

      const toolCall = makeToolCall('bash', { command: 'echo test' });

      // Always return tool calls (infinite loop scenario)
      (deps.client.chat as jest.Mock).mockResolvedValue({
        choices: [{ message: { content: 'Running...', tool_calls: [toolCall] } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const entries = await executor.processUserMessage('Loop forever', history, messages);

      // Should have a warning about max rounds
      const warningEntry = entries.find(e => e.content.includes('Maximum tool execution rounds'));
      expect(warningEntry).toBeDefined();
      // Tool handler should have been called exactly maxToolRounds times
      expect(deps.toolHandler.executeTool).toHaveBeenCalledTimes(2);
    });

    it('should stop when cost limit is reached during tool execution', async () => {
      const toolCall = makeToolCall('bash', { command: 'echo test' });

      (deps.client.chat as jest.Mock).mockResolvedValue({
        choices: [{ message: { content: 'Running...', tool_calls: [toolCall] } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      // Cost limit reached after first recording
      (config.isSessionCostLimitReached as jest.Mock).mockReturnValue(true);
      (config.getSessionCost as jest.Mock).mockReturnValue(10);
      (config.getSessionCostLimit as jest.Mock).mockReturnValue(10);

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const entries = await executor.processUserMessage('Expensive task', history, messages);

      // Should have cost limit message
      const costEntry = entries.find(e => e.content.includes('cost limit'));
      expect(costEntry).toBeDefined();
    });

    it('should handle API errors gracefully', async () => {
      (deps.client.chat as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const entries = await executor.processUserMessage('Hello', history, messages);

      expect(entries.length).toBe(1);
      expect(entries[0].content).toContain('error');
      expect(entries[0].content).toContain('Network error');
    });

    it('should handle missing assistant message', async () => {
      (deps.client.chat as jest.Mock).mockResolvedValueOnce({
        choices: [{}], // No message
        usage: { prompt_tokens: 100, completion_tokens: 0 },
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const entries = await executor.processUserMessage('Hello', history, messages);

      // Should handle gracefully (error entry)
      expect(entries.length).toBe(1);
      expect(entries[0].content).toContain('error');
    });

    it('should handle tool execution failure', async () => {
      const toolCall = makeToolCall('bash', { command: 'bad_command' });

      (deps.client.chat as jest.Mock)
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Running...', tool_calls: [toolCall] } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Command failed.', tool_calls: null } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });

      (deps.toolHandler.executeTool as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'Command not found',
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const entries = await executor.processUserMessage('Run bad command', history, messages);

      const toolResult = entries.find(e => e.type === 'tool_result');
      expect(toolResult).toBeDefined();
      expect(toolResult!.content).toContain('Command not found');
    });

    it('should add tool result messages with name field for Gemini compatibility', async () => {
      const toolCall = makeToolCall('read_file', { path: '/test.txt' }, 'call_123');

      (deps.client.chat as jest.Mock)
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Reading...', tool_calls: [toolCall] } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Done.', tool_calls: null } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await executor.processUserMessage('Read file', history, messages);

      const toolMsg = messages.find(m => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect((toolMsg as any).name).toBe('read_file');
      expect((toolMsg as any).tool_call_id).toBe('call_123');
    });

    it('should use output token count from usage when available', async () => {
      (deps.client.chat as jest.Mock).mockResolvedValueOnce({
        choices: [{ message: { content: 'Response', tool_calls: null } }],
        usage: { prompt_tokens: 100, completion_tokens: 75 },
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await executor.processUserMessage('Hello', history, messages);

      // recordSessionCost should be called with token counts
      expect(config.recordSessionCost).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number)
      );
    });

    it('should log context warnings', async () => {
      (deps.contextManager.shouldWarn as jest.Mock).mockReturnValue({
        warn: true,
        message: 'Context is 80% full',
      });

      const { logger } = require('../../../src/utils/logger.js');
      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await executor.processUserMessage('Hello', history, messages);

      expect(logger.warn).toHaveBeenCalledWith('Context is 80% full');
    });
  });

  // =========================================================================
  // processUserMessageStream (Streaming)
  // =========================================================================

  describe('processUserMessageStream', () => {
    it('should yield token_count as first chunk', async () => {
      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, null)
      );

      expect(chunks[0].type).toBe('token_count');
      expect(chunks[0].tokenCount).toBeDefined();
    });

    it('should yield done as last chunk', async () => {
      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, null)
      );

      expect(chunks[chunks.length - 1].type).toBe('done');
    });

    it('should yield content chunks for streaming text', async () => {
      // Set up streaming handler to return content
      (deps.streamingHandler.accumulateChunk as jest.Mock)
        .mockReturnValueOnce({
          displayContent: 'Test ',
          rawContent: 'Test ',
          hasNewToolCalls: false,
          shouldEmitTokenCount: false,
        })
        .mockReturnValueOnce({
          displayContent: 'response',
          rawContent: 'response',
          hasNewToolCalls: false,
          shouldEmitTokenCount: false,
        });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, null)
      );

      const contentChunks = chunks.filter(c => c.type === 'content');
      expect(contentChunks.length).toBeGreaterThan(0);
    });

    it('should add assistant entry to history', async () => {
      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, null)
      );

      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history.some(e => e.type === 'assistant')).toBe(true);
    });

    it('should handle abort before stream starts', async () => {
      const abortController = new AbortController();
      abortController.abort(); // Already aborted

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, abortController)
      );

      const cancelChunk = chunks.find(c => c.content?.includes('cancelled'));
      expect(cancelChunk).toBeDefined();
      const doneChunk = chunks.find(c => c.type === 'done');
      expect(doneChunk).toBeDefined();
    });

    it('should handle abort during streaming', async () => {
      const abortController = new AbortController();

      // Stream that yields one chunk then waits
      (deps.client.chatStream as jest.Mock).mockImplementation(async function* () {
        yield { choices: [{ delta: { content: 'Hi' } }] };
        // Abort happens here
        abortController.abort();
        yield { choices: [{ delta: { content: ' there' } }] };
      });

      (deps.streamingHandler.accumulateChunk as jest.Mock).mockReturnValue({
        displayContent: 'Hi',
        rawContent: 'Hi',
        hasNewToolCalls: false,
        shouldEmitTokenCount: false,
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, abortController)
      );

      const cancelChunk = chunks.find(c => c.content?.includes('cancelled'));
      expect(cancelChunk).toBeDefined();
    });

    it('should handle abort during tool execution', async () => {
      const abortController = new AbortController();
      const toolCall = makeToolCall('read_file', { path: '/big.txt' }, 'call_1');

      // Stream returns tool calls
      (deps.streamingHandler.getAccumulatedMessage as jest.Mock).mockReturnValue({
        content: 'Reading...',
        tool_calls: [toolCall],
      });
      (deps.streamingHandler.extractToolCalls as jest.Mock).mockReturnValue({
        toolCalls: [],
        remainingContent: '',
      });

      // Tool execution triggers abort (simulates user pressing Ctrl+C mid-tool)
      (deps.toolHandler.executeTool as jest.Mock).mockImplementation(async () => {
        abortController.abort();
        return { success: true, output: 'done' };
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Read big file', history, messages, abortController)
      );

      const cancelChunk = chunks.find(c => c.content?.includes('cancelled'));
      expect(cancelChunk).toBeDefined();
    });

    it('should yield tool_calls chunks', async () => {
      const toolCall = makeToolCall('read_file', { path: '/test.txt' }, 'call_1');

      (deps.streamingHandler.getAccumulatedMessage as jest.Mock).mockReturnValueOnce({
        content: 'Reading...',
        tool_calls: [toolCall],
      });
      (deps.streamingHandler.extractToolCalls as jest.Mock).mockReturnValue({
        toolCalls: [],
        remainingContent: '',
      });

      // Second round: final response
      (deps.client.chatStream as jest.Mock)
        .mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: 'Reading...' } }] };
        })
        .mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: 'Done.' } }] };
        });

      // Second round accumulated message has no tool calls
      (deps.streamingHandler.getAccumulatedMessage as jest.Mock).mockReturnValueOnce({
        content: 'Done.',
        tool_calls: undefined,
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Read file', history, messages, null)
      );

      const toolCallsChunk = chunks.find(c => c.type === 'tool_calls');
      expect(toolCallsChunk).toBeDefined();
    });

    it('should yield tool_result chunks', async () => {
      const toolCall = makeToolCall('read_file', { path: '/test.txt' }, 'call_1');

      (deps.streamingHandler.getAccumulatedMessage as jest.Mock)
        .mockReturnValueOnce({ content: 'Reading...', tool_calls: [toolCall] })
        .mockReturnValueOnce({ content: 'Done.', tool_calls: undefined });

      (deps.streamingHandler.extractToolCalls as jest.Mock).mockReturnValue({
        toolCalls: [],
        remainingContent: '',
      });

      (deps.client.chatStream as jest.Mock)
        .mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: 'Reading...' } }] };
        })
        .mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: 'Done.' } }] };
        });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Read file', history, messages, null)
      );

      const toolResultChunk = chunks.find(c => c.type === 'tool_result');
      expect(toolResultChunk).toBeDefined();
      expect(toolResultChunk!.toolResult).toBeDefined();
    });

    it('should stop after maxToolRounds in streaming mode', async () => {
      config.maxToolRounds = 1;
      executor = new AgentExecutor(deps, config);

      const toolCall = makeToolCall('bash', { command: 'echo test' }, 'call_1');

      // Always return tool calls
      (deps.streamingHandler.getAccumulatedMessage as jest.Mock).mockReturnValue({
        content: 'Running...',
        tool_calls: [toolCall],
      });
      (deps.streamingHandler.extractToolCalls as jest.Mock).mockReturnValue({
        toolCalls: [],
        remainingContent: '',
      });
      (deps.client.chatStream as jest.Mock).mockImplementation(async function* () {
        yield { choices: [{ delta: { content: 'Run...' } }] };
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Loop', history, messages, null)
      );

      const maxRoundChunk = chunks.find(c => c.content?.includes('Maximum tool execution rounds'));
      expect(maxRoundChunk).toBeDefined();
    });

    it('should stop when cost limit reached in streaming mode', async () => {
      const toolCall = makeToolCall('bash', { command: 'echo test' }, 'call_1');

      (deps.streamingHandler.getAccumulatedMessage as jest.Mock).mockReturnValue({
        content: 'Running...',
        tool_calls: [toolCall],
      });
      (deps.streamingHandler.extractToolCalls as jest.Mock).mockReturnValue({
        toolCalls: [],
        remainingContent: '',
      });

      (config.isSessionCostLimitReached as jest.Mock).mockReturnValue(true);
      (config.getSessionCost as jest.Mock).mockReturnValue(10);
      (config.getSessionCostLimit as jest.Mock).mockReturnValue(10);

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Expensive', history, messages, null)
      );

      const costChunk = chunks.find(c => c.content?.includes('cost limit'));
      expect(costChunk).toBeDefined();
      const doneChunk = chunks.find(c => c.type === 'done');
      expect(doneChunk).toBeDefined();
    });

    it('should yield reasoning chunks when present', async () => {
      (deps.streamingHandler.accumulateChunk as jest.Mock).mockReturnValue({
        displayContent: '',
        rawContent: '',
        hasNewToolCalls: false,
        shouldEmitTokenCount: false,
        reasoningContent: 'Thinking about this...',
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, null)
      );

      const reasoningChunk = chunks.find(c => c.type === 'reasoning');
      expect(reasoningChunk).toBeDefined();
      expect(reasoningChunk!.reasoning).toBe('Thinking about this...');
    });

    it('should handle stream errors gracefully', async () => {
      (deps.client.chatStream as jest.Mock).mockImplementation(async function* () {
        throw new Error('Stream connection lost');
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, null)
      );

      const errorChunk = chunks.find(c => c.content?.includes('error'));
      expect(errorChunk).toBeDefined();
      const doneChunk = chunks.find(c => c.type === 'done');
      expect(doneChunk).toBeDefined();
    });

    it('should handle aborted signal in catch block', async () => {
      const abortController = new AbortController();

      (deps.client.chatStream as jest.Mock).mockImplementation(async function* () {
        abortController.abort();
        throw new Error('Aborted');
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, abortController)
      );

      const cancelChunk = chunks.find(c => c.content?.includes('cancelled'));
      expect(cancelChunk).toBeDefined();
    });

    it('should use bash streaming for bash tool calls', async () => {
      const toolCall = makeToolCall('bash', { command: 'echo hello' }, 'call_bash');

      (deps.streamingHandler.getAccumulatedMessage as jest.Mock)
        .mockReturnValueOnce({ content: 'Running...', tool_calls: [toolCall] })
        .mockReturnValueOnce({ content: 'Done.', tool_calls: undefined });

      (deps.streamingHandler.extractToolCalls as jest.Mock).mockReturnValue({
        toolCalls: [],
        remainingContent: '',
      });

      // Mock bash streaming generator
      const mockGen = {
        next: jest.fn()
          .mockResolvedValueOnce({ value: 'hello\n', done: false })
          .mockResolvedValueOnce({ value: undefined, done: true }),
        return: jest.fn().mockResolvedValue({ done: true }),
        throw: jest.fn(),
        [Symbol.asyncIterator]() { return this; },
      };
      (deps.toolHandler.executeToolStreaming as jest.Mock).mockReturnValue(mockGen);

      (deps.client.chatStream as jest.Mock)
        .mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: 'Running...' } }] };
        })
        .mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: 'Done.' } }] };
        });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Run command', history, messages, null)
      );

      const toolStreamChunk = chunks.find(c => c.type === 'tool_stream');
      expect(toolStreamChunk).toBeDefined();
      expect(toolStreamChunk!.toolStreamData!.toolName).toBe('bash');
    });

    it('should emit token_count updates during tool rounds', async () => {
      const toolCall = makeToolCall('read_file', { path: '/test.txt' }, 'call_1');

      (deps.streamingHandler.getAccumulatedMessage as jest.Mock)
        .mockReturnValueOnce({ content: 'Reading...', tool_calls: [toolCall] })
        .mockReturnValueOnce({ content: 'Done.', tool_calls: undefined });

      (deps.streamingHandler.extractToolCalls as jest.Mock).mockReturnValue({
        toolCalls: [],
        remainingContent: '',
      });

      (deps.client.chatStream as jest.Mock)
        .mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: 'Reading...' } }] };
        })
        .mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: 'Done.' } }] };
        });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Read file', history, messages, null)
      );

      const tokenChunks = chunks.filter(c => c.type === 'token_count');
      // At least 2: initial + after tool round
      expect(tokenChunks.length).toBeGreaterThanOrEqual(2);
    });

    it('should not call search for non-Grok models', async () => {
      (config.isGrokModel as jest.Mock).mockReturnValue(false);

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, null)
      );

      // chatStream should be called with search off
      const chatStreamCall = (deps.client.chatStream as jest.Mock).mock.calls[0];
      expect(chatStreamCall[3]).toEqual({ search_parameters: { mode: 'off' } });
    });

    it('should enable search for Grok models when shouldUseSearchFor returns true', async () => {
      (config.isGrokModel as jest.Mock).mockReturnValue(true);
      (deps.toolSelectionStrategy.shouldUseSearchFor as jest.Mock).mockReturnValue(true);

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await collectChunks(
        executor.processUserMessageStream('What is the weather?', history, messages, null)
      );

      const chatStreamCall = (deps.client.chatStream as jest.Mock).mock.calls[0];
      expect(chatStreamCall[3]).toEqual({ search_parameters: { mode: 'auto' } });
    });

    it('should reset streaming handler at start of each round', async () => {
      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, null)
      );

      expect(deps.streamingHandler.reset).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Middleware Integration (Streaming)
  // =========================================================================

  describe('Middleware Integration', () => {
    let mockPipeline: any;

    beforeEach(() => {
      mockPipeline = {
        use: jest.fn(),
        remove: jest.fn(),
        runBeforeTurn: jest.fn().mockResolvedValue({ action: 'continue' }),
        runAfterTurn: jest.fn().mockResolvedValue({ action: 'continue' }),
        getMiddlewareNames: jest.fn().mockReturnValue(['test']),
      };
      deps.middlewarePipeline = mockPipeline;
      executor = new AgentExecutor(deps, config);
    });

    it('should run before_turn middleware', async () => {
      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, null)
      );

      expect(mockPipeline.runBeforeTurn).toHaveBeenCalled();
    });

    it('should stop when before_turn middleware returns stop', async () => {
      mockPipeline.runBeforeTurn.mockResolvedValue({
        action: 'stop',
        message: 'Turn limit reached',
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, null)
      );

      const stopChunk = chunks.find(c => c.content?.includes('Turn limit reached'));
      expect(stopChunk).toBeDefined();
      const doneChunk = chunks.find(c => c.type === 'done');
      expect(doneChunk).toBeDefined();
      // Should not call chat stream
      expect(deps.client.chatStream).not.toHaveBeenCalled();
    });

    it('should emit warning when before_turn middleware returns warn', async () => {
      mockPipeline.runBeforeTurn.mockResolvedValue({
        action: 'warn',
        message: 'Context is getting large',
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, null)
      );

      const warnChunk = chunks.find(c => c.content?.includes('Context is getting large'));
      expect(warnChunk).toBeDefined();
    });

    it('should trigger compaction when before_turn returns compact', async () => {
      mockPipeline.runBeforeTurn.mockResolvedValue({ action: 'compact' });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, null)
      );

      // prepareMessages should be called (for compaction)
      expect(deps.contextManager.prepareMessages).toHaveBeenCalled();
    });

    it('should run after_turn middleware after tool execution', async () => {
      const toolCall = makeToolCall('read_file', { path: '/test.txt' }, 'call_1');

      (deps.streamingHandler.getAccumulatedMessage as jest.Mock)
        .mockReturnValueOnce({ content: 'Reading...', tool_calls: [toolCall] })
        .mockReturnValueOnce({ content: 'Done.', tool_calls: undefined });

      (deps.streamingHandler.extractToolCalls as jest.Mock).mockReturnValue({
        toolCalls: [],
        remainingContent: '',
      });

      (deps.client.chatStream as jest.Mock)
        .mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: 'Reading...' } }] };
        })
        .mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: 'Done.' } }] };
        });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await collectChunks(
        executor.processUserMessageStream('Read file', history, messages, null)
      );

      expect(mockPipeline.runAfterTurn).toHaveBeenCalled();
    });

    it('should stop when after_turn middleware returns stop', async () => {
      const toolCall = makeToolCall('bash', { command: 'echo 1' }, 'call_1');

      mockPipeline.runAfterTurn.mockResolvedValue({
        action: 'stop',
        message: 'Cost limit exceeded',
      });

      (deps.streamingHandler.getAccumulatedMessage as jest.Mock)
        .mockReturnValueOnce({ content: 'Running...', tool_calls: [toolCall] });

      (deps.streamingHandler.extractToolCalls as jest.Mock).mockReturnValue({
        toolCalls: [],
        remainingContent: '',
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Do stuff', history, messages, null)
      );

      const stopChunk = chunks.find(c => c.content?.includes('Cost limit exceeded'));
      expect(stopChunk).toBeDefined();
    });

    it('should not suppress context warning when pipeline is set', async () => {
      // When pipeline exists, context warning in shouldWarn is skipped
      (deps.contextManager.shouldWarn as jest.Mock).mockReturnValue({
        warn: true,
        message: 'Should not appear',
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, null)
      );

      // The shouldWarn result should NOT be yielded when pipeline is active
      const contextWarnChunk = chunks.find(c => c.content?.includes('Should not appear'));
      expect(contextWarnChunk).toBeUndefined();
    });

    it('should show context warning when no pipeline is set', async () => {
      // Remove pipeline
      deps.middlewarePipeline = undefined;
      executor = new AgentExecutor(deps, config);

      (deps.contextManager.shouldWarn as jest.Mock).mockReturnValue({
        warn: true,
        message: 'Context warning here',
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, null)
      );

      const contextWarnChunk = chunks.find(c => c.content?.includes('Context warning here'));
      expect(contextWarnChunk).toBeDefined();
    });
  });

  // =========================================================================
  // LaneQueue Integration
  // =========================================================================

  describe('LaneQueue Integration', () => {
    it('should use lane queue when provided', async () => {
      const mockLaneQueue = {
        enqueue: jest.fn().mockImplementation((_lane: string, fn: () => unknown) => fn()),
      };
      deps.laneQueue = mockLaneQueue as any;
      executor = new AgentExecutor(deps, config);

      const toolCall = makeToolCall('read_file', { path: '/test.txt' }, 'call_1');

      (deps.client.chat as jest.Mock)
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Reading...', tool_calls: [toolCall] } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Done.', tool_calls: null } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await executor.processUserMessage('Read file', history, messages);

      expect(mockLaneQueue.enqueue).toHaveBeenCalled();
    });

    it('should mark read-only tools as parallel in lane queue', async () => {
      const mockLaneQueue = {
        enqueue: jest.fn().mockImplementation((_lane: string, fn: () => unknown) => fn()),
      };
      deps.laneQueue = mockLaneQueue as any;
      executor = new AgentExecutor(deps, config);

      const toolCall = makeToolCall('grep', { pattern: 'test' }, 'call_1');

      (deps.client.chat as jest.Mock)
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Searching...', tool_calls: [toolCall] } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Found.', tool_calls: null } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await executor.processUserMessage('Search for test', history, messages);

      const enqueueCall = mockLaneQueue.enqueue.mock.calls[0];
      expect(enqueueCall[2].parallel).toBe(true);
    });

    it('should mark write tools as non-parallel', async () => {
      const mockLaneQueue = {
        enqueue: jest.fn().mockImplementation((_lane: string, fn: () => unknown) => fn()),
      };
      deps.laneQueue = mockLaneQueue as any;
      executor = new AgentExecutor(deps, config);

      const toolCall = makeToolCall('bash', { command: 'rm file.txt' }, 'call_1');

      (deps.client.chat as jest.Mock)
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Deleting...', tool_calls: [toolCall] } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Deleted.', tool_calls: null } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await executor.processUserMessage('Delete file', history, messages);

      const enqueueCall = mockLaneQueue.enqueue.mock.calls[0];
      expect(enqueueCall[2].parallel).toBe(false);
    });

    it('should fall back to direct execution without lane queue', async () => {
      // No lane queue
      deps.laneQueue = undefined;
      executor = new AgentExecutor(deps, config);

      const toolCall = makeToolCall('read_file', { path: '/test.txt' }, 'call_1');

      (deps.client.chat as jest.Mock)
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Reading...', tool_calls: [toolCall] } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Done.', tool_calls: null } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await executor.processUserMessage('Read file', history, messages);

      expect(deps.toolHandler.executeTool).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Message Queue (Steering)
  // =========================================================================

  describe('Message Queue Steering', () => {
    it('should handle steering messages during tool execution', async () => {
      const toolCall = makeToolCall('bash', { command: 'echo test' }, 'call_1');

      const mockMQ = {
        hasSteeringMessage: jest.fn().mockReturnValueOnce(true).mockReturnValue(false),
        consumeSteeringMessage: jest.fn().mockReturnValueOnce({
          content: 'Stop and do this instead',
          source: 'user',
          timestamp: new Date(),
        }),
        hasPendingMessages: jest.fn().mockReturnValue(false),
        getMode: jest.fn().mockReturnValue('steer'),
      };
      (deps as any).messageQueue = mockMQ;
      executor = new AgentExecutor(deps, config);

      (deps.streamingHandler.getAccumulatedMessage as jest.Mock)
        .mockReturnValueOnce({ content: 'Running...', tool_calls: [toolCall] })
        .mockReturnValueOnce({ content: 'OK, doing that.', tool_calls: undefined });

      (deps.streamingHandler.extractToolCalls as jest.Mock).mockReturnValue({
        toolCalls: [],
        remainingContent: '',
      });

      (deps.client.chatStream as jest.Mock)
        .mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: 'Running...' } }] };
        })
        .mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: 'OK.' } }] };
        });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Do something', history, messages, null)
      );

      const steerChunk = chunks.find((c: any) => c.type === 'steer');
      expect(steerChunk).toBeDefined();
      expect((steerChunk as any).steer.content).toBe('Stop and do this instead');
    });

    it('should process followup messages at end of stream', async () => {
      const mockMQ = {
        hasSteeringMessage: jest.fn().mockReturnValue(false),
        hasPendingMessages: jest.fn().mockReturnValue(true),
        getMode: jest.fn().mockReturnValue('followup'),
        drain: jest.fn().mockReturnValue([
          { content: 'Follow up 1', source: 'user', timestamp: new Date() },
          { content: 'Follow up 2', source: 'user', timestamp: new Date() },
        ]),
      };
      (deps as any).messageQueue = mockMQ;
      executor = new AgentExecutor(deps, config);

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, null)
      );

      const steerChunk = chunks.find((c: any) => c.type === 'steer');
      expect(steerChunk).toBeDefined();
      expect((steerChunk as any).steer.content).toContain('followup');
    });

    it('should process collect messages at end of stream', async () => {
      const mockMQ = {
        hasSteeringMessage: jest.fn().mockReturnValue(false),
        hasPendingMessages: jest.fn().mockReturnValue(true),
        getMode: jest.fn().mockReturnValue('collect'),
        collect: jest.fn().mockReturnValue('Collected messages here'),
      };
      (deps as any).messageQueue = mockMQ;
      executor = new AgentExecutor(deps, config);

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, null)
      );

      const steerChunk = chunks.find((c: any) => c.type === 'steer');
      expect(steerChunk).toBeDefined();
      expect((steerChunk as any).steer.content).toBe('Collected messages here');
    });
  });

  // =========================================================================
  // Cost Tracking
  // =========================================================================

  describe('Cost Tracking', () => {
    it('should record session cost after processing', async () => {
      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await executor.processUserMessage('Hello', history, messages);

      expect(config.recordSessionCost).toHaveBeenCalled();
    });

    it('should check cost limit after recording', async () => {
      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await executor.processUserMessage('Hello', history, messages);

      expect(config.isSessionCostLimitReached).toHaveBeenCalled();
    });

    it('should add cost warning entry when limit reached after processing', async () => {
      // For a simple message with no tool calls, recordSessionCost is called once
      // at line 327 followed by isSessionCostLimitReached at line 328.
      // We want that check to return true.
      (config.isSessionCostLimitReached as jest.Mock).mockReturnValue(true);
      (config.getSessionCost as jest.Mock).mockReturnValue(10.5);
      (config.getSessionCostLimit as jest.Mock).mockReturnValue(10);

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const entries = await executor.processUserMessage('Hello', history, messages);

      const costEntry = entries.find(e => e.content.includes('cost limit'));
      expect(costEntry).toBeDefined();
    });

    it('should record cost in streaming mode', async () => {
      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, null)
      );

      expect(config.recordSessionCost).toHaveBeenCalled();
    });

    it('should stop streaming when cost limit exceeded after tool round', async () => {
      // Remove pipeline to use legacy cost check path
      deps.middlewarePipeline = undefined;
      executor = new AgentExecutor(deps, config);

      const toolCall = makeToolCall('bash', { command: 'echo test' }, 'call_1');

      (deps.streamingHandler.getAccumulatedMessage as jest.Mock)
        .mockReturnValueOnce({ content: 'Running...', tool_calls: [toolCall] });

      (deps.streamingHandler.extractToolCalls as jest.Mock).mockReturnValue({
        toolCalls: [],
        remainingContent: '',
      });

      // Cost limit reached after tool round
      let costCheckCount = 0;
      (config.isSessionCostLimitReached as jest.Mock).mockImplementation(() => {
        costCheckCount++;
        return costCheckCount >= 2;
      });
      (config.getSessionCost as jest.Mock).mockReturnValue(10.5);
      (config.getSessionCostLimit as jest.Mock).mockReturnValue(10);

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Expensive', history, messages, null)
      );

      const costChunk = chunks.find(c => c.content?.includes('cost limit'));
      expect(costChunk).toBeDefined();
    });
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================

  describe('Edge Cases', () => {
    it('should handle empty tool_calls array (treated as no tool calls)', async () => {
      (deps.client.chat as jest.Mock).mockResolvedValueOnce({
        choices: [{ message: { content: 'No tools needed.', tool_calls: [] } }],
        usage: { prompt_tokens: 100, completion_tokens: 30 },
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const entries = await executor.processUserMessage('Hello', history, messages);

      expect(entries.length).toBe(1);
      expect(entries[0].content).toBe('No tools needed.');
    });

    it('should handle null content in assistant message', async () => {
      (deps.client.chat as jest.Mock).mockResolvedValueOnce({
        choices: [{ message: { content: null, tool_calls: null } }],
        usage: { prompt_tokens: 100, completion_tokens: 0 },
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const entries = await executor.processUserMessage('Hello', history, messages);

      // Should use fallback content
      expect(entries.length).toBe(1);
      expect(entries[0].content).toBeDefined();
    });

    it('should handle tool returning no output', async () => {
      const toolCall = makeToolCall('bash', { command: 'true' }, 'call_1');

      (deps.client.chat as jest.Mock)
        .mockResolvedValueOnce({
          choices: [{ message: { content: '', tool_calls: [toolCall] } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Done.', tool_calls: null } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });

      (deps.toolHandler.executeTool as jest.Mock).mockResolvedValueOnce({
        success: true,
        output: undefined,
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const entries = await executor.processUserMessage('Run', history, messages);

      const toolResult = entries.find(e => e.type === 'tool_result');
      expect(toolResult).toBeDefined();
      expect(toolResult!.content).toBe('Success');
    });

    it('should handle zero maxToolRounds', async () => {
      config.maxToolRounds = 0;
      executor = new AgentExecutor(deps, config);

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      // Even with 0 rounds, the while loop won't execute
      // but the initial select + chat should still happen
      const chunks = await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, null)
      );

      // Should have max rounds warning since 0 >= 0
      const maxRoundChunk = chunks.find(c => c.content?.includes('Maximum tool execution rounds'));
      expect(maxRoundChunk).toBeDefined();
    });

    it('should cache tools only on first round', async () => {
      const toolCall = makeToolCall('bash', { command: 'echo test' }, 'call_1');

      (deps.streamingHandler.getAccumulatedMessage as jest.Mock)
        .mockReturnValueOnce({ content: 'Running...', tool_calls: [toolCall] })
        .mockReturnValueOnce({ content: 'Done.', tool_calls: undefined });

      (deps.streamingHandler.extractToolCalls as jest.Mock).mockReturnValue({
        toolCalls: [],
        remainingContent: '',
      });

      (deps.client.chatStream as jest.Mock)
        .mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: 'Running...' } }] };
        })
        .mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: 'Done.' } }] };
        });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await collectChunks(
        executor.processUserMessageStream('Run', history, messages, null)
      );

      // cacheTools should be called once (round 0 only)
      expect(deps.toolSelectionStrategy.cacheTools).toHaveBeenCalledTimes(1);
    });

    it('should pass middleware context with correct fields', async () => {
      const mockPipeline = {
        runBeforeTurn: jest.fn().mockResolvedValue({ action: 'continue' }),
        runAfterTurn: jest.fn().mockResolvedValue({ action: 'continue' }),
        getMiddlewareNames: jest.fn().mockReturnValue(['test']),
      };
      deps.middlewarePipeline = mockPipeline as any;
      executor = new AgentExecutor(deps, config);

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [{ role: 'system', content: 'Hi' }];
      const abortController = new AbortController();

      await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, abortController)
      );

      const ctx = mockPipeline.runBeforeTurn.mock.calls[0][0];
      expect(ctx).toHaveProperty('toolRound');
      expect(ctx).toHaveProperty('maxToolRounds');
      expect(ctx).toHaveProperty('sessionCost');
      expect(ctx).toHaveProperty('sessionCostLimit');
      expect(ctx).toHaveProperty('inputTokens');
      expect(ctx).toHaveProperty('outputTokens');
      expect(ctx).toHaveProperty('history');
      expect(ctx).toHaveProperty('messages');
      expect(ctx).toHaveProperty('isStreaming', true);
      expect(ctx).toHaveProperty('abortController');
    });
  });
});
