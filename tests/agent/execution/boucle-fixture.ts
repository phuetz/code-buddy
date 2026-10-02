import { vi } from 'vitest';
import type { ExecutorConfig, ExecutorDependencies } from '../../../src/agent/execution/agent-executor.js';
type Call = { id: string; type: 'function'; function: { name: string; arguments: string } };
export function createDeps(outputs: Record<string, string>): ExecutorDependencies {
  return {
    client: {
      chat: vi.fn(),
      chatStream: vi.fn(),
      getCurrentModel: vi.fn().mockReturnValue('fixture-model'),
      getProviderName: vi.fn().mockReturnValue('fixture'),
    } as never,
    toolHandler: {
      executeTool: vi.fn().mockImplementation(async (toolCall: Call) => {
        const path = JSON.parse(toolCall.function.arguments).path as string;
        return { success: true, output: outputs[path] ?? 'missing' };
      }),
      getWorkingDirectory: vi.fn().mockReturnValue(process.cwd()),
    } as never,
    toolSelectionStrategy: {
      selectToolsForQuery: vi.fn().mockResolvedValue({ tools: [], selection: null, fromCache: false, query: '', timestamp: new Date() }),
      cacheTools: vi.fn(),
      shouldUseSearchFor: vi.fn().mockReturnValue(false),
      clearCache: vi.fn(),
      setActiveSkill: vi.fn(),
      expandCachedTools: vi.fn().mockResolvedValue(0),
    } as never,
    streamingHandler: {
      reset: vi.fn(),
      accumulateChunk: vi.fn().mockReturnValue({ displayContent: '', rawContent: '', hasNewToolCalls: false, shouldEmitTokenCount: false }),
      extractToolCalls: vi.fn().mockReturnValue({ toolCalls: [], remainingContent: '' }),
      getAccumulatedMessage: vi.fn(),
      getTokenCount: vi.fn().mockReturnValue(10),
      hasYieldedToolCalls: vi.fn().mockReturnValue(false),
    } as never,
    // No budget inspection methods: the pipeline takes its full preparation
    // path (compaction + repair), like a context manager over its threshold.
    contextManager: {
      prepareMessages: vi.fn().mockImplementation((m: unknown[]) => m),
      prepareMessagesRaw: vi.fn().mockImplementation((m: unknown[]) => m),
      getContextEngine: vi.fn().mockReturnValue(null),
      shouldWarn: vi.fn().mockReturnValue({ warn: false }),
    } as never,
    tokenCounter: {
      countTokens: vi.fn().mockReturnValue(10),
      // Above 85 % of the default 128k window: compaction fires before each tool.
      countMessageTokens: vi.fn().mockReturnValue(200_000),
      dispose: vi.fn(),
    } as never,
  };
}

export function createConfig(maxToolRounds = 6): ExecutorConfig {
  return {
    maxToolRounds,
    isGrokModel: vi.fn().mockReturnValue(false),
    recordSessionCost: vi.fn(),
    isSessionCostLimitReached: vi.fn().mockReturnValue(false),
    estimateSessionCostLimitReached: vi.fn().mockReturnValue(false),
    getSessionCost: vi.fn().mockReturnValue(0),
    getSessionCostLimit: vi.fn().mockReturnValue(10),
  };
}

