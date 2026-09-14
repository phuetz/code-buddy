import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientCommandDispatcher, type ClientCommandContext } from '../../src/commands/client-dispatcher.js';
import { updateCurrentModel } from '../../src/utils/model-config.js';
vi.mock('../../src/utils/model-config.js', () => ({ updateCurrentModel: vi.fn() }));
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
      clearChat: vi.fn(),
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
  it.each(['/model', '/models'])('%s opens the model picker without calling an LLM', async command => {
    const context = createContext();
    await ClientCommandDispatcher.dispatch(command, context);
    expect(context.setShowModelSelection).toHaveBeenCalledWith(true);
    expect(context.processUserMessage).not.toHaveBeenCalled();
  });
  it.each(['/model', '/models'])('%s changes the running agent, then saves the choice', async command => {
    const context = createContext();
    await ClientCommandDispatcher.dispatch(`${command} custom-model`, context);
    expect(context.agent.setModel).toHaveBeenCalledWith('custom-model');
    expect(updateCurrentModel).toHaveBeenCalledWith('custom-model');
    expect(context.entries[0]?.content).toContain('Switched to model: custom-model');
    expect(context.processUserMessage).not.toHaveBeenCalled();
  });
  it('reports a rejected model without announcing success or saving it', async () => {
    const context = createContext();
    vi.mocked(context.agent.setModel).mockImplementation(() => { throw new Error('Model rejected'); });
    await ClientCommandDispatcher.dispatch('/model rejected-model', context);
    expect(context.entries[0]?.content).toContain('Model rejected');
    expect(updateCurrentModel).not.toHaveBeenCalled();
  });
  it('shows the live model in /status', async () => {
    const context = createContext();
    await ClientCommandDispatcher.dispatch('/status', context);
    expect(context.entries.map(entry => entry.content).join('\n')).toContain('test-model');
    expect(context.processUserMessage).not.toHaveBeenCalled();
  });

  it('clears both the visible transcript and the agent conversation', async () => {
    const context = createContext();
    await ClientCommandDispatcher.dispatch('/clear', context);
    expect(context.agent.clearChat).toHaveBeenCalledTimes(1);
    expect(context.entries).toEqual([]);
    expect(context.resetHistory).toHaveBeenCalled();
    expect(context.processUserMessage).not.toHaveBeenCalled();
  });
  it.each(['/help', '/cost', '/context', '/tools'])('%s returns a local useful response', async command => {
    const context = createContext();
    await ClientCommandDispatcher.dispatch(command, context);
    const output = context.entries.map(entry => entry.content).join('\n');
    expect(output.length).toBeGreaterThan(20);
    expect(output).not.toMatch(/Command failed|Unknown command|no conversation-loop handler|Error listing tools/);
    expect(context.processUserMessage).not.toHaveBeenCalled();
    expect(context.clearInput).toHaveBeenCalled();
  });

  it('rejects an API-only model on a ChatGPT subscription connection', async () => {
    const context = createContext();
    vi.mocked(context.agent.getClient).mockReturnValue({ getCurrentProvider: () => 'chatgpt' } as ReturnType<typeof context.agent.getClient>);
    await ClientCommandDispatcher.dispatch('/model gpt-4o', context);
    expect(context.entries[0]?.content).toContain('incompatible');
    expect(context.agent.setModel).not.toHaveBeenCalled();
    expect(updateCurrentModel).not.toHaveBeenCalled();
  });

});
