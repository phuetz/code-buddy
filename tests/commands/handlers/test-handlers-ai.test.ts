import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  detectProviderFromEnv: vi.fn(),
  selectModelForDetectedProvider: vi.fn((detected: { defaultModel: string }, configured?: string) =>
    configured || detected.defaultModel,
  ),
  createAITestRunner: vi.fn(),
  formatResults: vi.fn(() => 'formatted ai test results'),
  constructedClients: [] as Array<{ apiKey: string; model?: string; baseURL?: string }>,
}));

vi.mock('../../../src/utils/provider-detector.js', () => ({
  detectProviderFromEnv: mocks.detectProviderFromEnv,
  selectModelForDetectedProvider: mocks.selectModelForDetectedProvider,
}));

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

describe('handleAITest provider detection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.CHATGPT_MODEL;
    delete process.env.GEMINI_MODEL;
    delete process.env.GROK_MODEL;
    delete process.env.OPENAI_MODEL;
    mocks.constructedClients.length = 0;
    mocks.detectProviderFromEnv.mockReturnValue(null);
    mocks.createAITestRunner.mockReturnValue({
      on: vi.fn(),
      runAll: vi.fn().mockResolvedValue({}),
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.env = originalEnv;
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
    mocks.detectProviderFromEnv.mockReturnValue({
      provider: 'chatgpt',
      apiKey: 'oauth-chatgpt',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      defaultModel: 'gpt-5.5',
    });
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
    mocks.detectProviderFromEnv.mockReturnValue({
      provider: 'gemini',
      apiKey: 'gemini-key',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      defaultModel: 'gemini-2.5-flash',
    });
    const { handleAITest } = await import('../../../src/commands/handlers/test-handlers.js');

    await handleAITest(['quick'], null);

    expect(mocks.constructedClients[0]).toMatchObject({
      apiKey: 'gemini-key',
      model: 'gemini-2.5-flash',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    });
    expect(mocks.selectModelForDetectedProvider).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: 'gemini' }),
      undefined,
    );
  });
});
