/**
 * Recette slash 2026-09-14 — commands that answered nothing (or the wrong
 * thing) in the real CLI although their handlers had passing unit tests.
 * These go through ClientCommandDispatcher, the seam the TUI actually uses:
 * it only renders `entry`, so handlers returning `output`/`response` were
 * silently dropped, and /switch had no provider wired to the live agent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEntry } from '../../src/agent/codebuddy-agent.js';

vi.mock('../../src/utils/model-config.js', () => ({ updateCurrentModel: vi.fn() }));
vi.mock('../../src/agent/custom/custom-agent-loader.js', () => ({
  getCustomAgentLoader: () => ({
    formatAgentList: () => 'Available Agents:\n  reviewer: Code Reviewer',
    listAgents: () => [{ id: 'reviewer', name: 'Code Reviewer' }],
    getAgent: () => undefined,
  }),
}));

import { ClientCommandDispatcher, type ClientCommandContext } from '../../src/commands/client-dispatcher.js';
import { normalizeHandlerResult } from '../../src/commands/enhanced-command-handler.js';

function createContext(initialModel = 'qwen3:4b-instruct') {
  let entries: ChatEntry[] = [];
  let model = initialModel;
  const agent = {
    getClient: vi.fn(() => ({ getCurrentProvider: () => 'ollama' })),
    getContextStats: vi.fn(() => ({})),
    formatContextStats: vi.fn(() => ''),
    getCurrentModel: vi.fn(() => model),
    getMemoryScope: vi.fn(() => ({ cwd: process.cwd() })),
    getContextMemoryMetrics: vi.fn(),
    getCompressionStats: vi.fn(),
    getContextBudgetBreakdown: vi.fn(),
    setModel: vi.fn((next: string) => { model = next; }),
    clearChat: vi.fn(),
    executeBashCommand: vi.fn(),
  };
  const context = {
    get entries() { return entries; },
    agent,
    chatHistory: [],
    setChatHistory: vi.fn((update: ChatEntry[] | ((prev: ChatEntry[]) => ChatEntry[])) => {
      entries = typeof update === 'function' ? update(entries) : update;
    }),
    setIsProcessing: vi.fn(),
    setIsStreaming: vi.fn(),
    setTokenCount: vi.fn(),
    setProcessingTime: vi.fn(),
    processingStartTime: { current: 0 },
    setInput: vi.fn(),
    clearInput: vi.fn(),
    resetHistory: vi.fn(),
    setShowModelSelection: vi.fn(),
    setSelectedModelIndex: vi.fn(),
    availableModels: [{ model: 'qwen3:4b-instruct' }, { model: 'gemma4:e4b' }],
    processUserMessage: vi.fn(),
  };
  return context as unknown as ClientCommandContext & { entries: ChatEntry[]; agent: typeof agent };
}

const visible = (context: { entries: ChatEntry[] }) => context.entries.map(entry => entry.content).join('\n');

describe('slash commands through the conversation-loop dispatcher', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('/agent list shows the agent list instead of nothing', async () => {
    const context = createContext();

    await ClientCommandDispatcher.dispatch('/agent list', context);

    expect(visible(context)).toContain('Available Agents:');
    expect(context.processUserMessage).not.toHaveBeenCalled();
  });

  it('/agent with an unknown id shows the error instead of nothing', async () => {
    const context = createContext();

    await ClientCommandDispatcher.dispatch('/agent ghost', context);

    expect(visible(context)).toContain('Agent "ghost" not found.');
  });

  it('/infra status renders its dashboard', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: '0.24.1', models: [{ name: 'qwen3:4b-instruct' }] }), { status: 200 })));
    const context = createContext();

    await ClientCommandDispatcher.dispatch('/infra status', context);

    expect(visible(context)).toContain('Infrastructure Status');
    expect(visible(context)).toContain('qwen3:4b-instruct');
  });

  it('/switch changes the live agent model for the session and /switch auto restores it', async () => {
    const context = createContext();

    await ClientCommandDispatcher.dispatch('/switch gemma4:e4b', context);
    expect(context.agent.setModel).toHaveBeenLastCalledWith('gemma4:e4b');
    expect(visible(context)).toContain('Model switched to: gemma4:e4b');

    await ClientCommandDispatcher.dispatch('/switch auto', context);
    expect(context.agent.setModel).toHaveBeenLastCalledWith('qwen3:4b-instruct');
    expect(visible(context)).toContain('Active model: qwen3:4b-instruct');
    expect(visible(context)).not.toContain('requires an active agent session');
  });

  it('/switch auto without an override keeps the active model', async () => {
    const context = createContext();

    await ClientCommandDispatcher.dispatch('/switch auto', context);

    expect(context.agent.setModel).not.toHaveBeenCalled();
    expect(visible(context)).toContain('Model override cleared');
    expect(visible(context)).toContain('Active model: qwen3:4b-instruct');
  });

  it('/switch refuses a model incompatible with the active provider', async () => {
    const context = createContext();
    context.agent.getClient.mockReturnValue({ getCurrentProvider: () => 'chatgpt' });

    await ClientCommandDispatcher.dispatch('/switch gpt-4o', context);

    expect(context.agent.setModel).not.toHaveBeenCalled();
    expect(visible(context)).toContain('Model switch failed: Model gpt-4o is incompatible');
  });

  it('/starter list lists packs instead of looking for a pack named "list"', async () => {
    const context = createContext();

    await ClientCommandDispatcher.dispatch('/starter list', context);

    expect(visible(context)).not.toContain('Starter pack "list" not found');
    expect(visible(context)).toMatch(/Starter Packs \(\d+ available\)|No starter packs are installed/);
  });
});

describe('/debug-issue prompt sent to the model', () => {
  it('stands on its own when invoked without a symptom', async () => {
    const context = createContext();

    await ClientCommandDispatcher.dispatch('/debug-issue', context);

    const prompt = vi.mocked(context.processUserMessage).mock.calls[0]?.[0] ?? '';
    expect(prompt).not.toContain('described issue');
    expect(prompt).not.toContain('$ARGUMENTS');
    expect(prompt).toContain('git diff for unstaged changes');
    expect(prompt).toContain('git diff --cached for staged changes');
  });

  it('embeds the reported symptom', async () => {
    const context = createContext();

    await ClientCommandDispatcher.dispatch('/debug-issue total(0, 3) returns NaN', context);

    const prompt = vi.mocked(context.processUserMessage).mock.calls[0]?.[0] ?? '';
    expect(prompt).toContain('Reported symptom (empty if the user gave none): total(0, 3) returns NaN');
  });
});

describe('normalizeHandlerResult', () => {
  it.each([
    ['output', { handled: true, output: 'from output' }],
    ['error', { handled: true, error: 'from error' }],
    ['response', { handled: true, response: 'from response' }],
    ['message', { handled: true, message: 'from message' }],
  ])('turns a legacy %s field into a visible entry', (_field, legacy) => {
    const result = normalizeHandlerResult(legacy as never);
    expect(result.entry?.type).toBe('assistant');
    expect(result.entry?.content).toMatch(/^from /);
  });

  it('keeps an existing entry and unhandled results untouched', () => {
    const entry = { type: 'assistant' as const, content: 'kept', timestamp: new Date() };
    expect(normalizeHandlerResult({ handled: true, entry, output: 'ignored' } as never).entry).toBe(entry);
    expect(normalizeHandlerResult({ handled: false, output: 'x' } as never).entry).toBeUndefined();
  });

  it('keeps passToAI prompts alongside the normalized entry', () => {
    const result = normalizeHandlerResult({ handled: true, output: 'Activated agent: X', passToAI: true, prompt: 'go' } as never);
    expect(result).toMatchObject({ passToAI: true, prompt: 'go' });
    expect(result.entry?.content).toBe('Activated agent: X');
  });
});
