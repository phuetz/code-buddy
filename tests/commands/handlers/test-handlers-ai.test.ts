import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAITestRunner: vi.fn(),
  formatResults: vi.fn(() => 'formatted ai test results'),
  constructedClients: [] as Array<{ apiKey: string; model?: string; baseURL?: string }>,
}));

const testPaths = vi.hoisted(() => ({
  tmpHome: '',
}));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => testPaths.tmpHome || actual.homedir(),
  };
});

vi.mock('../../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: class {
    private model?: string;
    private baseURL?: string;

    constructor(apiKey: string, model?: string, baseURL?: string) {
      this.model = model;
      this.baseURL = baseURL;
      mocks.constructedClients.push({ apiKey, model, baseURL });
    }

    getCurrentModel(): string {
      return this.model || 'mock-model';
    }

    getBaseURL(): string {
      return this.baseURL || 'https://mock.example/v1';
    }
  },
}));

vi.mock('../../../src/testing/ai-integration-tests.js', () => ({
  AITestRunner: {
    formatResults: mocks.formatResults,
  },
  createAITestRunner: mocks.createAITestRunner,
}));

const PROVIDER_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'CHATGPT_MODEL',
  'CODEBUDDY_PROVIDER',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'GOOGLE_API_KEY',
  'GROK_API_KEY',
  'GROK_MODEL',
  'OLLAMA_HOST',
  'OLLAMA_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'XAI_API_KEY',
] as const;

function writeChatGptAuth(): void {
  const authDir = path.join(testPaths.tmpHome, '.codebuddy');
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(
    path.join(authDir, 'codex-auth.json'),
    JSON.stringify({ tokens: { access_token: 'test-chatgpt-token' } }),
  );
}

describe('handleAITest provider detection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    for (const key of PROVIDER_ENV_KEYS) {
      delete process.env[key];
    }
    process.env.CODEBUDDY_PROVIDER = 'none';
    testPaths.tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'test-handlers-ai-'));
    mocks.constructedClients.length = 0;
    mocks.createAITestRunner.mockReturnValue({
      on: vi.fn(),
      runAll: vi.fn().mockResolvedValue({}),
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.env = originalEnv;
    if (testPaths.tmpHome) {
      fs.rmSync(testPaths.tmpHome, { recursive: true, force: true });
      testPaths.tmpHome = '';
    }
    vi.restoreAllMocks();
  });

  it('shows a provider-agnostic setup hint when no client or provider is available', async () => {
    const { handleAITest } = await import('../../../src/commands/handlers/test-handlers.js');

    const result = await handleAITest([], null);

    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('No AI provider is configured');
    expect(result.entry?.content).toContain('buddy login chatgpt');
    expect(mocks.createAITestRunner).not.toHaveBeenCalled();
  });

  it('creates the fallback client from detected ChatGPT subscription auth', async () => {
    process.env.CODEBUDDY_PROVIDER = 'chatgpt';
    writeChatGptAuth();
    const { handleAITest } = await import('../../../src/commands/handlers/test-handlers.js');

    const result = await handleAITest(['quick'], null);

    expect(mocks.constructedClients).toEqual([
      {
        apiKey: 'oauth-chatgpt',
        model: 'gpt-5.5',
        baseURL: 'https://chatgpt.com/backend-api/codex',
      },
    ]);
    expect(mocks.createAITestRunner).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ skipExpensive: true }),
    );
    expect(result.entry?.content).toBe('formatted ai test results');
  });

  it('ignores stale model env vars from other providers', async () => {
    process.env.OPENAI_MODEL = 'gpt-4o';
    process.env.CODEBUDDY_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'gemini-key';
    const { handleAITest } = await import('../../../src/commands/handlers/test-handlers.js');

    await handleAITest(['quick'], null);

    expect(mocks.constructedClients[0]).toMatchObject({
      apiKey: 'gemini-key',
      model: 'gemini-2.5-flash',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    });
  });
});
