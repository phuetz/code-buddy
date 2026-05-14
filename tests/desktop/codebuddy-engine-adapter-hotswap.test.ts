/**
 * Phase 8 — verify CodeBuddyEngineAdapter detects model/endpoint/apiKey
 * changes between turns and disposes the cached CodeBuddyAgent so the
 * next turn picks up the new config. Without this, mid-session model
 * switches in Cowork's Settings were silently ignored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let constructorCalls: Array<{ apiKey: string; baseURL?: string; model?: string }> = [];
let disposedCount = 0;
let processedPrompts: string[] = [];
let tmpHome: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return { ...actual, homedir: () => tmpHome };
});

class FakeCodeBuddyAgent {
  apiKey: string;
  baseURL?: string;
  model?: string;
  history: Array<{ role: string; content: string }> = [];
  constructor(apiKey: string, baseURL?: string, model?: string) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.model = model;
    constructorCalls.push({ apiKey, baseURL, model });
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

const envKeysToReset = [
  'CODEBUDDY_PROVIDER',
  'GROK_API_KEY',
  'GROK_MODEL',
  'XAI_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'OLLAMA_HOST',
  'OLLAMA_MODEL',
  'CHATGPT_MODEL',
];
const envBackup: Record<string, string | undefined> = {};

function writeChatGptAuth(): void {
  const dir = path.join(tmpHome, '.codebuddy');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'codex-auth.json'),
    JSON.stringify({ tokens: { access_token: 'test-access-token' } }),
  );
}

describe('CodeBuddyEngineAdapter — hot-swap on config change (Phase 8)', () => {
  beforeEach(() => {
    constructorCalls = [];
    disposedCount = 0;
    processedPrompts = [];
    for (const key of envKeysToReset) {
      envBackup[key] = process.env[key];
      delete process.env[key];
    }
    process.env.CODEBUDDY_PROVIDER = 'none';
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-hotswap-'));
  });

  afterEach(() => {
    for (const key of envKeysToReset) {
      if (envBackup[key] !== undefined) process.env[key] = envBackup[key];
      else delete process.env[key];
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('uses detected ChatGPT credentials when Cowork has no saved API key', async () => {
    process.env.CODEBUDDY_PROVIDER = 'chatgpt';
    writeChatGptAuth();
    const adapter = new CodeBuddyEngineAdapter({ apiKey: '', embedded: true });

    await adapter.runSession(
      'sess-1',
      [{ role: 'user', content: 'hi' }],
      () => undefined,
    );

    expect(constructorCalls[0]).toEqual({
      apiKey: 'oauth-chatgpt',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      model: 'gpt-5.5',
    });
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
});
