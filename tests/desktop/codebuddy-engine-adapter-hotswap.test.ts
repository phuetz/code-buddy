/**
 * Phase 8 — verify CodeBuddyEngineAdapter detects model/endpoint/apiKey
 * changes between turns and disposes the cached CodeBuddyAgent so the
 * next turn picks up the new config. Without this, mid-session model
 * switches in Cowork's Settings were silently ignored.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

let constructorCalls: Array<{
  apiKey: string;
  baseURL?: string;
  model?: string;
  workingDirectory?: string;
  systemPromptAppend?: string;
}> = [];
let disposedCount = 0;
let processedPrompts: string[] = [];

class FakeCodeBuddyAgent {
  apiKey: string;
  baseURL?: string;
  model?: string;
  workingDirectory?: string;
  systemPromptAppend?: string;
  history: Array<{ role: string; content: string }> = [];
  constructor(
    apiKey: string,
    baseURL?: string,
    model?: string,
    _maxToolRounds?: number,
    _useRAGToolSelection?: boolean,
    _systemPromptId?: string,
    workingDirectory?: string,
    systemPromptAppend?: string,
  ) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.model = model;
    this.workingDirectory = workingDirectory;
    this.systemPromptAppend = systemPromptAppend;
    constructorCalls.push({ apiKey, baseURL, model, workingDirectory, systemPromptAppend });
  }
  addToHistory(entry: { role: string; content: string }) {
    this.history.push(entry);
  }
  async *processUserMessageStream(prompt: string) {
    processedPrompts.push(`${this.model}:${prompt}`);
    yield { type: 'content', content: `from ${this.model}` };
    yield { type: 'done' };
  }
  dispose() {
    disposedCount++;
  }
  setWorkingDirectory(dir: string | undefined) {
    this.workingDirectory = dir;
  }
  setSystemPromptAppend(append: string | undefined) {
    this.systemPromptAppend = append;
  }
}

vi.mock('../../src/agent/codebuddy-agent.js', () => ({
  CodeBuddyAgent: FakeCodeBuddyAgent,
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/codebuddy/tools.js', () => ({
  getMCPManager: () => ({ addServer: vi.fn(), removeServer: vi.fn() }),
}));

import { CodeBuddyEngineAdapter } from '../../src/desktop/codebuddy-engine-adapter';

describe('CodeBuddyEngineAdapter — hot-swap on config change (Phase 8)', () => {
  beforeEach(() => {
    constructorCalls = [];
    disposedCount = 0;
    processedPrompts = [];
  });

  it('reuses the cached agent when config is unchanged across turns', async () => {
    const adapter = new CodeBuddyEngineAdapter({ apiKey: 'k', model: 'gemma' });
    const events: unknown[] = [];
    await adapter.runSession(
      'sess-1',
      [{ role: 'user', content: 'hi' }],
      (e) => events.push(e),
    );
    await adapter.runSession(
      'sess-1',
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'from gemma' },
        { role: 'user', content: 'again' },
      ],
      (e) => events.push(e),
    );
    expect(constructorCalls).toHaveLength(1);
    expect(disposedCount).toBe(0);
  });

  it('disposes and recreates the agent when the model changes mid-session', async () => {
    const adapter = new CodeBuddyEngineAdapter({ apiKey: 'k', model: 'gemma' });
    await adapter.runSession(
      'sess-1',
      [{ role: 'user', content: 'hi' }],
      () => undefined,
    );
    // User flips to a different model in Settings, then sends another prompt.
    await adapter.runSession(
      'sess-1',
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'from gemma' },
        { role: 'user', content: 'switch model now' },
      ],
      () => undefined,
      { model: 'qwen3' },
    );
    expect(constructorCalls).toHaveLength(2);
    expect(constructorCalls[1].model).toBe('qwen3');
    expect(disposedCount).toBe(1);
  });

  it('rehydrates the new agent with prior history after a model swap', async () => {
    const adapter = new CodeBuddyEngineAdapter({ apiKey: 'k', model: 'gemma' });
    await adapter.runSession(
      'sess-1',
      [{ role: 'user', content: 'first' }],
      () => undefined,
    );
    await adapter.runSession(
      'sess-1',
      [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'from gemma' },
        { role: 'user', content: 'second' },
      ],
      () => undefined,
      { model: 'qwen3' },
    );
    // Two prompts processed, the second one with the new model.
    expect(processedPrompts).toEqual(['gemma:first', 'qwen3:second']);
  });

  it('disposes when baseURL changes (not just model)', async () => {
    const adapter = new CodeBuddyEngineAdapter({
      apiKey: 'k',
      baseURL: 'https://a.com',
      model: 'm',
    });
    await adapter.runSession(
      'sess-1',
      [{ role: 'user', content: 'hi' }],
      () => undefined,
    );
    await adapter.runSession(
      'sess-1',
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'x' },
        { role: 'user', content: 'again' },
      ],
      () => undefined,
      { baseURL: 'https://b.com' },
    );
    expect(disposedCount).toBe(1);
  });

  it('disposes when apiKey changes (e.g. user rotates credentials)', async () => {
    const adapter = new CodeBuddyEngineAdapter({ apiKey: 'k1', model: 'm' });
    await adapter.runSession(
      'sess-1',
      [{ role: 'user', content: 'hi' }],
      () => undefined,
    );
    await adapter.runSession(
      'sess-1',
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'x' },
        { role: 'user', content: 'again' },
      ],
      () => undefined,
      { apiKey: 'k2' },
    );
    expect(disposedCount).toBe(1);
    expect(constructorCalls[1].apiKey).toBe('k2');
  });

  it('disposes when the active runtime persona prompt changes', async () => {
    const adapter = new CodeBuddyEngineAdapter({ apiKey: 'k', model: 'm' });
    await adapter.runSession(
      'sess-1',
      [{ role: 'user', content: 'hi' }],
      () => undefined,
      { systemPromptAppend: 'persona A' },
    );
    await adapter.runSession(
      'sess-1',
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'x' },
        { role: 'user', content: 'again' },
      ],
      () => undefined,
      { systemPromptAppend: 'persona B' },
    );
    expect(disposedCount).toBe(1);
    expect(constructorCalls[1].systemPromptAppend).toBe('persona B');
  });

  it('clearSession drops the identity entry too', async () => {
    const adapter = new CodeBuddyEngineAdapter({ apiKey: 'k', model: 'm' });
    await adapter.runSession(
      'sess-1',
      [{ role: 'user', content: 'hi' }],
      () => undefined,
    );
    adapter.clearSession('sess-1');
    // Re-running with same model should reconstruct since cache was cleared.
    await adapter.runSession(
      'sess-1',
      [{ role: 'user', content: 'again' }],
      () => undefined,
    );
    expect(constructorCalls).toHaveLength(2);
  });

  it('setThinkingLevel hot-swaps the global extended-thinking budget', async () => {
    const { getExtendedThinking, resetExtendedThinking } = await import(
      '../../src/agent/extended-thinking.js'
    );
    resetExtendedThinking();
    const adapter = new CodeBuddyEngineAdapter({ apiKey: 'k', model: 'gemma' });

    await adapter.setThinkingLevel('high');
    expect(getExtendedThinking().getThinkingConfig()).toEqual({
      thinking: { type: 'enabled', budget_tokens: 8192 },
    });

    await adapter.setThinkingLevel('off');
    expect(getExtendedThinking().getThinkingConfig()).toEqual({});
    resetExtendedThinking();
  });
});
