import { describe, expect, it, vi } from 'vitest';
import { AgentExecutor, type ExecutorConfig, type ExecutorDependencies } from '../../src/agent/execution/agent-executor.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function deps(chatStreamOverride?: any): ExecutorDependencies {
  return {
    client: {
      chatStream: chatStreamOverride ?? vi.fn().mockImplementation(async function* () {
        yield { type: 'chunk', value: { choices: [{ delta: { content: 'hello' } }] } };
      }),
      getCurrentModel: vi.fn().mockReturnValue('gpt-4o'),
      getProviderName: vi.fn().mockReturnValue('fixture-provider'),
    } as never,
    toolHandler: { getWorkingDirectory: vi.fn().mockReturnValue(process.cwd()), executeTool: vi.fn() } as never,
    toolSelectionStrategy: {
      selectToolsForQuery: vi.fn().mockResolvedValue({ tools: [], selection: null, fromCache: false, query: '', timestamp: new Date() }),
      shouldUseSearchFor: vi.fn().mockReturnValue(false),
      cacheTools: vi.fn(),
    } as never,
    streamingHandler: {
      reset: vi.fn(),
      accumulateChunk: vi.fn().mockReturnValue({ displayContent: 'hello' }),
      getAccumulatedMessage: vi.fn().mockReturnValue({ content: 'hello', tool_calls: undefined }),
      getTokenCount: vi.fn().mockReturnValue(1),
      extractToolCalls: vi.fn().mockReturnValue({ toolCalls: [], remainingContent: '' }),
      hasYieldedToolCalls: vi.fn().mockReturnValue(false),
      flushDisplayContent: vi.fn().mockReturnValue(''),
    } as never,
    contextManager: {
      prepareMessages: vi.fn().mockImplementation((m: unknown[]) => m),
      prepareMessagesRaw: vi.fn().mockImplementation((m: unknown[]) => m),
      shouldWarn: vi.fn().mockReturnValue({ warn: false }),
      getContextEngine: vi.fn().mockReturnValue(null),
    } as never,
    tokenCounter: { countTokens: vi.fn().mockReturnValue(10), countMessageTokens: vi.fn().mockReturnValue(10), dispose: vi.fn() } as never,
    // Provide a real token counter to bypass any mock issues if needed, but here a simple mock should work if it returns 10.
  };
}

describe('AgentExecutor Cost Accounting', () => {
  it('does not bill input tokens when the turn fails before any answer', async () => {
    const errorStream = vi.fn().mockImplementation(async function* () {
      throw new Error('Connection error');
    });
    const recordSessionCost = vi.fn();
    const config: ExecutorConfig = {
      recordSessionCost,
      isGrokModel: () => false,
      onYield: vi.fn(),
      maxToolRounds: 1,
      isSessionCostLimitReached: vi.fn().mockReturnValue(false),
      estimateCost: vi.fn().mockReturnValue(0.01),
      formatCost: vi.fn().mockReturnValue('$0.01'),
    } as never;

    const executor = new AgentExecutor(deps(errorStream), config);
    // Provide a valid message history array to avoid undefined `flatMap`
    const generator = executor.processUserMessageStream('hi', [], [], null);

    const messages = [];
    try {
      for await (const msg of generator) {
        messages.push(msg);
      }
    } catch (e) {
        messages.push({type: 'error', error: e});
    }

    // Verify error was yielded
    expect(messages.some(m => m.type === 'content' && typeof m.content === 'string' && m.content.includes('Connection error'))).toBe(true);

    // Verify the bill: it should not have billed input tokens since we failed before answering.
    expect(recordSessionCost).toHaveBeenCalledWith(0, 0);
  });

  it('bills input tokens when the turn succeeds normally', async () => {
    const recordSessionCost = vi.fn();
    const config: ExecutorConfig = {
      recordSessionCost,
      isGrokModel: () => false,
      onYield: vi.fn(),
      maxToolRounds: 1,
      isSessionCostLimitReached: vi.fn().mockReturnValue(false),
      estimateCost: vi.fn().mockReturnValue(0.01),
      formatCost: vi.fn().mockReturnValue('$0.01'),
    } as never;

    const executor = new AgentExecutor(deps(), config);
    const generator = executor.processUserMessageStream('hi', [], [], null);

    const messages = [];
    for await (const msg of generator) {
      messages.push(msg);
    }

    expect(messages.some(m => m.type === 'done')).toBe(true);
    // Token counter is mocked to return 10 for countMessageTokens which incremental counter uses.
    // 1 message -> 10 tokens input. Output getTokenCount -> 1.
    expect(recordSessionCost).toHaveBeenCalledWith(10, 1);
  });
});
