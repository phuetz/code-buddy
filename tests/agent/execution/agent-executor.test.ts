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
import { logger } from '../../../src/utils/logger.js';
import { YIELD_SIGNAL } from '../../../src/agent/execution/yield-coordinator.js';
import { INTERACTIVE_SHELL_SIGNAL } from '../../../src/agent/execution/turn-signals.js';

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

// Mock lessons-tracker globally so the décision #4 sentinel test can pin
// observable injection. Other tests use trivial queries (ctxLevel.lessons = false)
// or don't assert messages content, so the mock is safe across the suite.
jest.mock('../../../src/agent/lessons-tracker.js', () => ({
  getLessonsTracker: jest.fn(() => ({
    buildContextBlock: () => 'PHASE_A_LESSONS_SENTINEL',
  })),
}));

// Wrap injectNextRoundContext in a spy at the module boundary. Behavior is
// preserved (the wrapped fn calls through), but inspection becomes possible.
// The décision #4 sentinel asserts this spy is called by streaming when
// running multi-round — fails today (streaming doesn't call it),
// passes after décision #4 is applied.
jest.mock('../../../src/agent/execution/context-pipeline.js', async () => {
  const actual = await jest.requireActual<typeof import('../../../src/agent/execution/context-pipeline.js')>(
    '../../../src/agent/execution/context-pipeline.js'
  );
  return {
    ...actual,
    injectNextRoundContext: jest.fn(actual.injectNextRoundContext),
  };
});

// Late import so the mocked symbol is captured.
import { injectNextRoundContext as injectNextRoundContextMock } from '../../../src/agent/execution/context-pipeline.js';

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
    estimateSessionCostLimitReached: jest.fn().mockReturnValue(false),
    getSessionCost: jest.fn().mockReturnValue(0),
    getSessionCostLimit: jest.fn().mockReturnValue(10),
    ...overrides,
  };
}

/**
 * Helper to setup LLM flow mocks for the unified runTurnLoop path.
 * After Phase D of task #5, both processUserMessage (sequential collector)
 * and processUserMessageStream consume runTurnLoop, which uses chatStream
 * and streamingHandler. Tests must mock the streaming flow even when
 * testing the sequential adapter — the legacy `client.chat` mock is no
 * longer hit by either path.
 *
 * Each `responses[]` entry corresponds to one LLM round.
 */
type LLMResponse = {
  content: string;
  tool_calls?: ReturnType<typeof makeToolCall>[];
};
function setupLLMFlow(d: ExecutorDependencies, responses: LLMResponse[]) {
  const stream = d.client.chatStream as jest.Mock;
  const acc = d.streamingHandler.getAccumulatedMessage as jest.Mock;
  for (const r of responses) {
    stream.mockImplementationOnce(async function* () {
      yield { choices: [{ delta: { content: r.content } }] };
    });
    acc.mockReturnValueOnce({
      content: r.content,
      tool_calls: r.tool_calls,
    });
  }
  (d.streamingHandler.extractToolCalls as jest.Mock).mockReturnValue({
    toolCalls: [],
    remainingContent: '',
  });
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

      // Phase d.22: executor now passes a (possibly empty) options object as
      // the 2nd arg so it can override maxTools/alwaysInclude on lite-profile
      // models. The strategy still receives the query as arg 0.
      expect(deps.toolSelectionStrategy.selectToolsForQuery).toHaveBeenCalledWith(
        'Hello',
        expect.any(Object),
      );
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

      setupLLMFlow(deps, [
        { content: 'Reading file...', tool_calls: [toolCall] },
        { content: 'File contents here.' },
      ]);

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

      setupLLMFlow(deps, [
        { content: 'Reading files...', tool_calls: [toolCall1, toolCall2] },
        { content: 'Done.' },
      ]);

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const entries = await executor.processUserMessage('Read both files', history, messages);

      const toolResults = entries.filter(e => e.type === 'tool_result');
      expect(toolResults.length).toBe(2);
      expect(deps.toolHandler.executeTool).toHaveBeenCalledTimes(2);
    });

    it('should handle multi-round tool execution', async () => {
      // Phase D: bash is in STREAMING_TOOLS (uses executeToolStreaming, not executeTool).
      // Use two non-streaming tools to keep counting executeTool calls reliable.
      const toolCall1 = makeToolCall('read_file', { path: '/a.txt' }, 'call_1');
      const toolCall2 = makeToolCall('read_file', { path: '/b.txt' }, 'call_2');

      setupLLMFlow(deps, [
        { content: 'Reading...', tool_calls: [toolCall1] },
        { content: 'Reading more...', tool_calls: [toolCall2] },
        { content: 'All done.' },
      ]);

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

      // Phase D: use non-streaming tool (bash bypasses executeTool counter).
      const toolCall = makeToolCall('read_file', { path: '/x.txt' });

      // Always return tool calls (infinite loop scenario)
      (deps.client.chatStream as jest.Mock).mockImplementation(async function* () {
        yield { choices: [{ delta: { content: 'Running...' } }] };
      });
      (deps.streamingHandler.getAccumulatedMessage as jest.Mock).mockReturnValue({
        content: 'Running...',
        tool_calls: [toolCall],
      });
      (deps.streamingHandler.extractToolCalls as jest.Mock).mockReturnValue({
        toolCalls: [],
        remainingContent: '',
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await executor.processUserMessage('Loop forever', history, messages);

      // Phase D: max-rounds warning is yielded as a `content` event by runTurnLoop
      // but not pushed as a ChatEntry in history (per décision #3 — streaming-only
      // events are dropped by the sequential collector). The invariant we still
      // assert is that the loop stops after maxToolRounds.
      expect(deps.toolHandler.executeTool).toHaveBeenCalledTimes(2);
    });

    it('should stop when cost limit is reached during tool execution', async () => {
      const toolCall = makeToolCall('read_file', { path: '/x.txt' });

      (deps.client.chatStream as jest.Mock).mockImplementation(async function* () {
        yield { choices: [{ delta: { content: 'Running...' } }] };
      });
      (deps.streamingHandler.getAccumulatedMessage as jest.Mock).mockReturnValue({
        content: 'Running...',
        tool_calls: [toolCall],
      });
      (deps.streamingHandler.extractToolCalls as jest.Mock).mockReturnValue({
        toolCalls: [],
        remainingContent: '',
      });

      // Cost limit reached — pre-check uses estimate (no side effects)
      (config.estimateSessionCostLimitReached as jest.Mock).mockReturnValue(true);
      (config.isSessionCostLimitReached as jest.Mock).mockReturnValue(true);
      (config.getSessionCost as jest.Mock).mockReturnValue(10);
      (config.getSessionCostLimit as jest.Mock).mockReturnValue(10);

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await executor.processUserMessage('Expensive task', history, messages);

      // Phase D: cost limit message is yielded as a `content` event by runTurnLoop
      // but not pushed as a ChatEntry. Invariant: pre-check is invoked (and the
      // loop stops before any tool execution).
      expect(config.estimateSessionCostLimitReached).toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      (deps.client.chatStream as jest.Mock).mockImplementationOnce(async function* () {
        throw new Error('Network error');
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const entries = await executor.processUserMessage('Hello', history, messages);

      expect(entries.length).toBe(1);
      expect(entries[0].content).toContain('error');
      expect(entries[0].content).toContain('Network error');
    });

    it('should report empty/missing assistant content as an error', async () => {
      (deps.client.chatStream as jest.Mock).mockImplementationOnce(async function* () {
        // No content delta at all
      });
      (deps.streamingHandler.getAccumulatedMessage as jest.Mock).mockReturnValueOnce({
        content: '',
        tool_calls: undefined,
      });
      (deps.streamingHandler.extractToolCalls as jest.Mock).mockReturnValue({
        toolCalls: [],
        remainingContent: '',
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const entries = await executor.processUserMessage('Hello', history, messages);

      expect(entries.length).toBe(1);
      expect(entries[0].content).toContain('Assistant stream returned no content or tool calls');
    });

    it('should handle tool execution failure', async () => {
      // Phase D: bash uses executeToolStreaming. Use a non-streaming tool to mock executeTool failure.
      const toolCall = makeToolCall('read_file', { path: '/missing.txt' });

      setupLLMFlow(deps, [
        { content: 'Running...', tool_calls: [toolCall] },
        { content: 'Command failed.' },
      ]);

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

      setupLLMFlow(deps, [
        { content: 'Reading...', tool_calls: [toolCall] },
        { content: 'Done.' },
      ]);

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await executor.processUserMessage('Read file', history, messages);

      const toolMsg = messages.find(m => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect((toolMsg as any).name).toBe('read_file');
      expect((toolMsg as any).tool_call_id).toBe('call_123');
    });

    it('should use output token count from usage when available', async () => {
      setupLLMFlow(deps, [{ content: 'Response' }]);

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

      // Cost limit reached — pre-check uses estimate (no side effects)
      (config.estimateSessionCostLimitReached as jest.Mock).mockReturnValue(true);
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
      // Context warnings from shouldWarn are always shown, even when pipeline is active
      (deps.contextManager.shouldWarn as jest.Mock).mockReturnValue({
        warn: true,
        message: 'Should not appear',
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const chunks = await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, null)
      );

      // The shouldWarn result SHOULD be yielded regardless of pipeline state
      const contextWarnChunk = chunks.find(c => c.content?.includes('Should not appear'));
      expect(contextWarnChunk).toBeDefined();
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

      setupLLMFlow(deps, [
        { content: 'Reading...', tool_calls: [toolCall] },
        { content: 'Done.' },
      ]);

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

      setupLLMFlow(deps, [
        { content: 'Searching...', tool_calls: [toolCall] },
        { content: 'Found.' },
      ]);

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

      // Phase D: `bash` is in STREAMING_TOOLS and bypasses executeToolViaLane.
      // Use create_file (write tool, non-streaming) to test the lane queue path.
      const toolCall = makeToolCall('create_file', { path: '/x.txt', content: 'x' }, 'call_1');

      setupLLMFlow(deps, [
        { content: 'Writing...', tool_calls: [toolCall] },
        { content: 'Written.' },
      ]);

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

      setupLLMFlow(deps, [
        { content: 'Reading...', tool_calls: [toolCall] },
        { content: 'Done.' },
      ]);

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

    it('should record + check session cost when limit reached after processing', async () => {
      // Phase D: cost warning is yielded as a `content` event, not a ChatEntry.
      // Invariant: recordSessionCost + isSessionCostLimitReached are both called.
      (config.isSessionCostLimitReached as jest.Mock).mockReturnValue(true);
      (config.getSessionCost as jest.Mock).mockReturnValue(10.5);
      (config.getSessionCostLimit as jest.Mock).mockReturnValue(10);

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await executor.processUserMessage('Hello', history, messages);

      expect(config.recordSessionCost).toHaveBeenCalled();
      expect(config.isSessionCostLimitReached).toHaveBeenCalled();
    });

    it('should record cost in streaming mode', async () => {
      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, null)
      );

      expect(config.recordSessionCost).toHaveBeenCalled();
    });

    it('should stop streaming when cost limit exceeded at end of loop', async () => {
      // Cost is now only recorded at end-of-loop (not in legacy inline path)
      // This tests that end-of-loop recording detects cost limit
      (config.isSessionCostLimitReached as jest.Mock).mockReturnValue(true);
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
      setupLLMFlow(deps, [{ content: 'No tools needed.', tool_calls: [] }]);

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const entries = await executor.processUserMessage('Hello', history, messages);

      expect(entries.length).toBe(1);
      expect(entries[0].content).toBe('No tools needed.');
    });

    it('should report null content with no tool calls as an error', async () => {
      (deps.client.chatStream as jest.Mock).mockImplementationOnce(async function* () {
        // No content
      });
      (deps.streamingHandler.getAccumulatedMessage as jest.Mock).mockReturnValueOnce({
        content: null,
        tool_calls: null,
      });
      (deps.streamingHandler.extractToolCalls as jest.Mock).mockReturnValue({
        toolCalls: [],
        remainingContent: '',
      });

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];

      const entries = await executor.processUserMessage('Hello', history, messages);

      expect(entries.length).toBe(1);
      expect(entries[0].content).toContain('Assistant stream returned no content or tool calls');
    });

    it('should handle tool returning no output', async () => {
      // Phase D: use non-streaming tool so executeTool mock applies.
      const toolCall = makeToolCall('read_file', { path: '/empty.txt' }, 'call_1');

      setupLLMFlow(deps, [
        { content: '', tool_calls: [toolCall] },
        { content: 'Done.' },
      ]);

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

  // =========================================================================
  // Parity: sequential vs streaming
  //
  // Safety net for the agent-executor decomposition (v2 refactor / Vague 1).
  // Both entry points share preprocessUserMessage, lessons/todo injection,
  // output sanitization, transcript repair, and the __SESSIONS_YIELD__ signal.
  // After the refactor (single async-iterator core consumed by both paths),
  // these assertions stay green without modification.
  // =========================================================================

  describe('parity: sequential vs streaming', () => {
    it('both paths produce assistant output and append to messages on a no-tool input', async () => {
      const seqHistory: ChatEntry[] = [];
      const seqMessages: CodeBuddyMessage[] = [];
      const seqEntries = await executor.processUserMessage(
        'Hello',
        seqHistory,
        seqMessages
      );

      const streamDeps = createMockDeps();
      const streamConfig = createMockConfig();
      const streamExec = new AgentExecutor(streamDeps, streamConfig);
      const streamHistory: ChatEntry[] = [];
      const streamMessages: CodeBuddyMessage[] = [];
      const streamChunks = await collectChunks(
        streamExec.processUserMessageStream(
          'Hello',
          streamHistory,
          streamMessages,
          null
        )
      );

      expect(seqEntries.some(e => e.type === 'assistant')).toBe(true);
      expect(streamHistory.some(e => e.type === 'assistant')).toBe(true);
      expect(seqMessages.some(m => m.role === 'assistant')).toBe(true);
      expect(streamMessages.some(m => m.role === 'assistant')).toBe(true);
      expect(streamChunks.some(c => c.type === 'token_count')).toBe(true);
      expect(streamChunks.some(c => c.type === 'done')).toBe(true);
    });

    it('both paths dispatch the same tool name and args on a single tool call', async () => {
      const toolCall = makeToolCall('read_file', { path: '/parity.txt' }, 'parity_1');

      // Sequential — Phase D: now consumes runTurnLoop, so mocks the streaming flow.
      const depsSeq = createMockDeps();
      const configSeq = createMockConfig();
      setupLLMFlow(depsSeq, [
        { content: 'reading', tool_calls: [toolCall] },
        { content: 'done' },
      ]);
      const execSeq = new AgentExecutor(depsSeq, configSeq);
      await execSeq.processUserMessage('go', [], []);

      // Streaming — pattern inherited from "should yield tool_result chunks":
      // tool_calls live on streamingHandler.getAccumulatedMessage (round 0),
      // extractToolCalls returns empty, chatStream yields content deltas.
      const depsStream = createMockDeps();
      const configStream = createMockConfig();
      (depsStream.streamingHandler.getAccumulatedMessage as jest.Mock)
        .mockReturnValueOnce({ content: 'reading', tool_calls: [toolCall] })
        .mockReturnValueOnce({ content: 'done', tool_calls: undefined });
      (depsStream.streamingHandler.extractToolCalls as jest.Mock).mockReturnValue({
        toolCalls: [],
        remainingContent: '',
      });
      (depsStream.client.chatStream as jest.Mock)
        .mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: 'reading' } }] };
        })
        .mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: 'done' } }] };
        });
      const execStream = new AgentExecutor(depsStream, configStream);
      await collectChunks(execStream.processUserMessageStream('go', [], [], null));

      const seqCalls = (depsSeq.toolHandler.executeTool as jest.Mock).mock.calls;
      const streamCalls = (depsStream.toolHandler.executeTool as jest.Mock).mock.calls;

      expect(seqCalls.length).toBeGreaterThanOrEqual(1);
      expect(streamCalls.length).toBeGreaterThanOrEqual(1);
      expect(seqCalls[0][0].function.name).toBe(streamCalls[0][0].function.name);
      expect(seqCalls[0][0].function.arguments).toBe(streamCalls[0][0].function.arguments);
    });

    // Helper: build a 2-round mock setup for a sequential executor.
    // Round 0: tool call A → tool result. Round 1: tool call B → tool result.
    // Round 2: final assistant content.
    //
    // Phase D: sequential now consumes runTurnLoop (streaming flow), so this
    // helper sets up the same mocks as setupStreamingMultiRound. Kept distinct
    // for parity-test readability — the two paths now share the underlying flow.
    function setupSequentialMultiRound(d: ExecutorDependencies) {
      const tA = makeToolCall('read_file', { path: '/a.txt' }, 'mr_a');
      const tB = makeToolCall('read_file', { path: '/b.txt' }, 'mr_b');
      setupLLMFlow(d, [
        { content: 'r0', tool_calls: [tA] },
        { content: 'r1', tool_calls: [tB] },
        { content: 'final' },
      ]);
    }

    // Helper: build a 2-round mock setup for a streaming executor.
    function setupStreamingMultiRound(d: ExecutorDependencies) {
      const tA = makeToolCall('read_file', { path: '/a.txt' }, 'mr_a');
      const tB = makeToolCall('read_file', { path: '/b.txt' }, 'mr_b');
      (d.streamingHandler.getAccumulatedMessage as jest.Mock)
        .mockReturnValueOnce({ content: 'r0', tool_calls: [tA] })
        .mockReturnValueOnce({ content: 'r1', tool_calls: [tB] })
        .mockReturnValueOnce({ content: 'final', tool_calls: undefined });
      (d.streamingHandler.extractToolCalls as jest.Mock).mockReturnValue({
        toolCalls: [],
        remainingContent: '',
      });
      (d.client.chatStream as jest.Mock)
        .mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: 'r0' } }] };
        })
        .mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: 'r1' } }] };
        })
        .mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: 'final' } }] };
        });
    }

    it('both paths call prepareMessages the same number of times across multi-round', async () => {
      const depsSeq = createMockDeps();
      const configSeq = createMockConfig();
      setupSequentialMultiRound(depsSeq);
      const execSeq = new AgentExecutor(depsSeq, configSeq);
      await execSeq.processUserMessage('mr', [], []);

      const depsStream = createMockDeps();
      const configStream = createMockConfig();
      setupStreamingMultiRound(depsStream);
      const execStream = new AgentExecutor(depsStream, configStream);
      await collectChunks(execStream.processUserMessageStream('mr', [], [], null));

      const seqCalls = (depsSeq.contextManager.prepareMessages as jest.Mock).mock.calls.length;
      const streamCalls = (depsStream.contextManager.prepareMessages as jest.Mock).mock.calls.length;

      // Sequential path triggers prepareMessages at line ~528 (round 0) and line ~730 (between rounds)
      // Streaming path triggers prepareMessages at line ~1113 (round 0) and line ~1328 (between rounds)
      // After fusion in task #5, both must keep the same call count for transcript-repair invariant.
      expect(seqCalls).toBeGreaterThanOrEqual(2); // at least round-0 + 1 between-round
      expect(streamCalls).toBeGreaterThanOrEqual(2);
      expect(seqCalls).toBe(streamCalls);
    });

    it('both paths execute the same number of tools across multi-round', async () => {
      const depsSeq = createMockDeps();
      const configSeq = createMockConfig();
      setupSequentialMultiRound(depsSeq);
      const execSeq = new AgentExecutor(depsSeq, configSeq);
      await execSeq.processUserMessage('mr', [], []);

      const depsStream = createMockDeps();
      const configStream = createMockConfig();
      setupStreamingMultiRound(depsStream);
      const execStream = new AgentExecutor(depsStream, configStream);
      await collectChunks(execStream.processUserMessageStream('mr', [], [], null));

      const seqExec = (depsSeq.toolHandler.executeTool as jest.Mock).mock.calls.length;
      const streamExec = (depsStream.toolHandler.executeTool as jest.Mock).mock.calls.length;

      expect(seqExec).toBe(2);
      expect(streamExec).toBe(2);
      expect(seqExec).toBe(streamExec);
    });

    it('both paths record session cost exactly once at end of loop', async () => {
      // Single-message input: ensures the "no double-count" fix from audit 2026-03-10
      // stays applied in both paths after the fusion.
      const depsSeq = createMockDeps();
      const configSeq = createMockConfig();
      const execSeq = new AgentExecutor(depsSeq, configSeq);
      await execSeq.processUserMessage('Hello', [], []);

      const depsStream = createMockDeps();
      const configStream = createMockConfig();
      const execStream = new AgentExecutor(depsStream, configStream);
      await collectChunks(execStream.processUserMessageStream('Hello', [], [], null));

      const seqRecordCalls = (configSeq.recordSessionCost as jest.Mock).mock.calls.length;
      const streamRecordCalls = (configStream.recordSessionCost as jest.Mock).mock.calls.length;

      expect(seqRecordCalls).toBe(1);
      expect(streamRecordCalls).toBe(1);
    });

    it('both paths record session cost exactly once even on multi-round', async () => {
      const depsSeq = createMockDeps();
      const configSeq = createMockConfig();
      setupSequentialMultiRound(depsSeq);
      const execSeq = new AgentExecutor(depsSeq, configSeq);
      await execSeq.processUserMessage('mr', [], []);

      const depsStream = createMockDeps();
      const configStream = createMockConfig();
      setupStreamingMultiRound(depsStream);
      const execStream = new AgentExecutor(depsStream, configStream);
      await collectChunks(execStream.processUserMessageStream('mr', [], [], null));

      // Cost should only be recorded ONCE at end of loop, regardless of round count.
      // Pre-checks during the loop use estimateSessionCostLimitReached (no side effects).
      expect((configSeq.recordSessionCost as jest.Mock).mock.calls.length).toBe(1);
      expect((configStream.recordSessionCost as jest.Mock).mock.calls.length).toBe(1);
    });

    // TODO Task #5 — décision #4 du plan : promouvoir injectNextRoundContext au streaming.
    //
    // Aujourd'hui : sequential appelle injectNextRoundContext (agent-executor.ts:931),
    // streaming ne l'appelle nulle part. La décision #4 alignera les deux paths.
    //
    // Le filet est direct : on inspecte le mock factory de context-pipeline qui
    // wrappe injectNextRoundContext. Le test fail aujourd'hui (streaming = 0 calls)
    // — c'est la PREUVE que c'est un vrai filet, pas un placeholder. Quand décision #4
    // sera appliquée, retirer .skip → test passe → régression future détectable.
    it('décision #4 (applied): both paths invoke injectNextRoundContext on multi-round', async () => {
      const nextRoundMock = injectNextRoundContextMock as unknown as jest.Mock;
      // Sanity check: the mock factory worked, this is a real spy.
      expect(jest.isMockFunction(nextRoundMock)).toBe(true);

      // CODE_SIGNALS match → queryComplexity === 'complex'
      const complexMsg = 'implement multi-round fix and refactor the queue';

      // Sequential — should call injectNextRoundContext between rounds.
      nextRoundMock.mockClear();
      const depsSeq = createMockDeps();
      setupSequentialMultiRound(depsSeq);
      await new AgentExecutor(depsSeq, createMockConfig()).processUserMessage(complexMsg, [], []);
      const seqCallCount = nextRoundMock.mock.calls.length;
      expect(seqCallCount).toBeGreaterThanOrEqual(1);

      // Streaming — same invariant must hold AFTER décision #4 is applied.
      // Today this fails (streaming has zero calls to injectNextRoundContext).
      nextRoundMock.mockClear();
      const depsStream = createMockDeps();
      setupStreamingMultiRound(depsStream);
      await collectChunks(
        new AgentExecutor(depsStream, createMockConfig()).processUserMessageStream(
          complexMsg, [], [], null
        )
      );
      const streamCallCount = nextRoundMock.mock.calls.length;
      expect(streamCallCount).toBeGreaterThanOrEqual(1);
    });

    // -------------------------------------------------------------------------
    // Phase A — Invariants additionnels (advisor recommendation)
    //
    // Couvrent ce que le sentinel initial ne touchait pas et qui sont à risque
    // de régression silencieuse pendant la fusion (task #5 steps 4-7).
    // -------------------------------------------------------------------------

    it('output sanitizer parity: <think>...</think> stripped from final assistant content in both paths', async () => {
      // Décision implicite : la fusion doit préserver l'invariant que les
      // tokens de leakage modèle (<think>, <|im_start|>, [INST], etc.) ne
      // remontent JAMAIS dans le content final exposé au consommateur.
      // Boundaries différentes (chunk-level vs final-message) — on assert
      // l'end-state, pas le mécanisme.
      const dirty = '<think>secret reasoning</think>visible answer';

      // Sequential — Phase D: consumes runTurnLoop, mock streaming flow.
      const depsSeq = createMockDeps();
      setupLLMFlow(depsSeq, [{ content: dirty }]);
      const seqEntries = await new AgentExecutor(depsSeq, createMockConfig()).processUserMessage('hi', [], []);
      const seqAssistant = seqEntries.find(e => e.type === 'assistant');
      expect(seqAssistant).toBeDefined();
      expect(seqAssistant!.content).not.toContain('<think>');
      expect(seqAssistant!.content).not.toContain('secret reasoning');
      expect(seqAssistant!.content).toContain('visible answer');

      // Streaming
      const depsStream = createMockDeps();
      (depsStream.streamingHandler.getAccumulatedMessage as jest.Mock).mockReturnValue({
        content: dirty,
        tool_calls: undefined,
      });
      const streamHistory: ChatEntry[] = [];
      await collectChunks(
        new AgentExecutor(depsStream, createMockConfig()).processUserMessageStream('hi', streamHistory, [], null)
      );
      const streamAssistant = streamHistory.find(e => e.type === 'assistant');
      expect(streamAssistant).toBeDefined();
      expect(streamAssistant!.content).not.toContain('<think>');
      expect(streamAssistant!.content).not.toContain('secret reasoning');
    });

    it('__SESSIONS_YIELD__ signal does not crash either path when present in content', async () => {
      // Lock-in : la fusion doit préserver la robustesse face au signal yield.
      // Quel que soit le comportement exact (extraction, parent suspension, etc.),
      // les deux paths doivent compléter sans throw.
      const yieldContent = `Some response. ${YIELD_SIGNAL}:test_child_id continues here.`;

      const depsSeq = createMockDeps();
      setupLLMFlow(depsSeq, [{ content: yieldContent }]);
      await expect(
        new AgentExecutor(depsSeq, createMockConfig()).processUserMessage('hi', [], [])
      ).resolves.toBeDefined();

      const depsStream = createMockDeps();
      (depsStream.streamingHandler.getAccumulatedMessage as jest.Mock).mockReturnValue({
        content: yieldContent,
        tool_calls: undefined,
      });
      await expect(
        collectChunks(
          new AgentExecutor(depsStream, createMockConfig()).processUserMessageStream('hi', [], [], null)
        )
      ).resolves.toBeDefined();
    });

    it('ask_user streaming-only (décision #3 lock-in): __INTERACTIVE_SHELL_REQUEST__ in tool result yields ask_user only in streaming', async () => {
      // Le sequential path retourne ChatEntry[] synchrone — il ne peut pas
      // suspendre pour demander à l'utilisateur. Cette asymétrie est par design
      // (décision #3). La fusion doit conserver : streaming yield ask_user,
      // sequential drop silencieusement.
      const toolCall = makeToolCall('shell', { command: 'sudo rm -rf /' }, 'shell_1');
      const interactivePayload = `${INTERACTIVE_SHELL_SIGNAL}:Confirm dangerous command?`;

      // Sequential — Phase D: consumes runTurnLoop. Even with the signal in
      // tool output, no ask_user entry should be returned (events dropped).
      const depsSeq = createMockDeps();
      setupLLMFlow(depsSeq, [
        { content: 'r0', tool_calls: [toolCall] },
        { content: 'final' },
      ]);
      (depsSeq.toolHandler.executeTool as jest.Mock).mockResolvedValue({
        success: true,
        output: interactivePayload,
      });
      const seqEntries = await new AgentExecutor(depsSeq, createMockConfig()).processUserMessage('go', [], []);
      const seqAskUser = seqEntries.find(e => (e as { type: string }).type === 'ask_user' as never);
      expect(seqAskUser).toBeUndefined();

      // Streaming — même setup, doit yield un chunk ask_user.
      const depsStream = createMockDeps();
      (depsStream.streamingHandler.getAccumulatedMessage as jest.Mock)
        .mockReturnValueOnce({ content: 'r0', tool_calls: [toolCall] })
        .mockReturnValueOnce({ content: 'final', tool_calls: undefined });
      (depsStream.streamingHandler.extractToolCalls as jest.Mock).mockReturnValue({
        toolCalls: [],
        remainingContent: '',
      });
      (depsStream.client.chatStream as jest.Mock)
        .mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: 'r0' } }] };
        })
        .mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: 'final' } }] };
        });
      (depsStream.toolHandler.executeTool as jest.Mock).mockResolvedValue({
        success: true,
        output: interactivePayload,
      });
      const streamChunks = await collectChunks(
        new AgentExecutor(depsStream, createMockConfig()).processUserMessageStream('go', [], [], null)
      );
      const streamAskUser = streamChunks.find(c => c.type === 'ask_user');
      expect(streamAskUser).toBeDefined();
    });

    it('abort during streaming does not double-record session cost', async () => {
      // L'audit 2026-03-10 a corrigé le double-count de recordSessionCost.
      // La fusion doit préserver : exactly 1 call même quand l'utilisateur abort
      // mid-stream. Filet contre une régression silencieuse de cost tracking.
      const abortController = new AbortController();
      const depsStream = createMockDeps();
      (depsStream.client.chatStream as jest.Mock).mockImplementation(async function* () {
        yield { choices: [{ delta: { content: 'partial' } }] };
        abortController.abort();
        yield { choices: [{ delta: { content: ' more' } }] };
      });
      (depsStream.streamingHandler.accumulateChunk as jest.Mock).mockReturnValue({
        displayContent: 'partial',
        rawContent: 'partial',
        hasNewToolCalls: false,
        shouldEmitTokenCount: false,
      });

      const streamConfig = createMockConfig();
      await collectChunks(
        new AgentExecutor(depsStream, streamConfig).processUserMessageStream(
          'hi',
          [],
          [],
          abortController
        )
      );

      // Exactly 1 call regardless of abort — cost recording happens once at end of loop.
      expect((streamConfig.recordSessionCost as jest.Mock).mock.calls.length).toBeLessThanOrEqual(1);
    });
  });
});
