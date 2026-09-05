import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientCommandDispatcher, type ClientCommandContext } from '../../src/commands/client-dispatcher.js';
import type { ChatEntry } from '../../src/agent/codebuddy-agent.js';

function createContext(): ClientCommandContext & { entries: ChatEntry[] } {
  let entries: ChatEntry[] = [];
  const context = {
    entries,
    agent: {
      getClient: vi.fn(() => ({})),
      getContextStats: vi.fn(() => ({})),
      formatContextStats: vi.fn(() => 'context stats'),
      getCurrentModel: vi.fn(() => 'test-model'),
      getContextMemoryMetrics: vi.fn(() => ({
        summaryCount: 0,
        summaryTokens: 0,
        peakMessageCount: 0,
        compressionCount: 0,
        totalTokensSaved: 0,
        lastCompressionTime: null,
        warningsTriggered: 0,
      })),
      getCompressionStats: vi.fn(() => ({
        totalCompressions: 0,
        totalTokensSaved: 0,
        averageCompressionRatio: 1,
        lastCompression: null,
        archivesAvailable: 0,
        lastStrategiesUsed: [],
      })),
      getContextBudgetBreakdown: vi.fn(() => ({})),
      setModel: vi.fn(),
      executeBashCommand: vi.fn(),
    },
    chatHistory: [],
    setChatHistory: vi.fn((update: ChatEntry[] | ((prev: ChatEntry[]) => ChatEntry[])) => {
      entries = typeof update === 'function' ? update(entries) : update;
      context.entries = entries;
    }),
    setIsProcessing: vi.fn(),
    setIsStreaming: vi.fn(),
    setTokenCount: vi.fn(),
    setProcessingTime: vi.fn(),
    processingStartTime: { current: 123 },
    setInput: vi.fn(),
    clearInput: vi.fn(),
    resetHistory: vi.fn(),
    setShowModelSelection: vi.fn(),
    setSelectedModelIndex: vi.fn(),
    availableModels: [{ model: 'test-model' }],
    processUserMessage: vi.fn(),
  } as unknown as ClientCommandContext & { entries: ChatEntry[] };
  return context;
}

describe('ClientCommandDispatcher slash fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('turns an unknown slash command into a visible non-blocking assistant message', async () => {
    const context = createContext();

    const handled = await ClientCommandDispatcher.dispatch('/does-not-exist', context);

    expect(handled).toBe(true);
    expect(context.entries).toHaveLength(1);
    expect(context.entries[0]?.content).toContain('Unknown command: /does-not-exist');
    expect(context.clearInput).toHaveBeenCalled();
    expect(context.setIsProcessing).toHaveBeenCalledWith(false);
    expect(context.setIsStreaming).toHaveBeenCalledWith(false);
    expect(context.setTokenCount).toHaveBeenCalledWith(0);
    expect(context.setProcessingTime).toHaveBeenCalledWith(0);
    expect(context.processingStartTime.current).toBe(0);
    expect(context.processUserMessage).not.toHaveBeenCalled();
  });

  it('does not announce the removed batch-review command', async () => {
    const context = createContext();

    const handled = await ClientCommandDispatcher.dispatch('/batch-review', context);

    expect(handled).toBe(true);
    expect(context.entries).toHaveLength(1);
    expect(context.entries[0]?.content).toContain('Unknown command: /batch-review');
    expect(context.entries[0]?.content).not.toContain('registered but has no conversation-loop handler yet');
    expect(context.clearInput).toHaveBeenCalledTimes(1);
  });
});
