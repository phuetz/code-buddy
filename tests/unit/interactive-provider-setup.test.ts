import { vi } from 'vitest';

const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  statSync: vi.fn(),
}));

const providerMocks = vi.hoisted(() => ({
  detectProviderFromEnv: vi.fn(),
}));

vi.mock('fs', () => ({ ...mockFs, default: mockFs }));

vi.mock('../../src/utils/codebuddy-home.js', () => ({
  getCodeBuddyHome: vi.fn(() => '/tmp/codebuddy'),
  ensureCodeBuddyHome: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../src/utils/provider-detector.js', () => ({
  detectProviderFromEnv: providerMocks.detectProviderFromEnv,
  selectModelForDetectedProvider: (
    detected: { provider: string; defaultModel: string } | null,
    configured?: string,
  ) => {
    if (!detected) return configured;
    if (configured && !(detected.provider !== 'grok' && /^grok[-_]/i.test(configured))) {
      return configured;
    }
    return detected.defaultModel;
  },
}));

import { needsSetup } from '../../src/utils/interactive-setup';
import { resolveSessionModel } from '../../src/server/routes/sessions';

describe('interactive provider setup', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.GROK_API_KEY;
    delete process.env.GROK_MODEL;
    providerMocks.detectProviderFromEnv.mockReturnValue(null);
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReturnValue('{}');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('does not require setup when ChatGPT OAuth is the detected provider', () => {
    providerMocks.detectProviderFromEnv.mockReturnValue({
      provider: 'chatgpt',
      apiKey: 'oauth-chatgpt',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      defaultModel: 'gpt-5.5',
    });

    expect(needsSetup()).toBe(false);
    expect(mockFs.existsSync).not.toHaveBeenCalled();
  });

  it('still accepts legacy stored API keys when no provider is detected', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ apiKey: 'xai-key' }));

    expect(needsSetup()).toBe(false);
  });

  it('uses the detected provider model for new session metadata', () => {
    providerMocks.detectProviderFromEnv.mockReturnValue({
      provider: 'chatgpt',
      apiKey: 'oauth-chatgpt',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      defaultModel: 'gpt-5.5',
    });
    process.env.GROK_MODEL = 'grok-code-fast-1';

    expect(resolveSessionModel()).toBe('gpt-5.5');
  });

  it('preserves explicit non-Grok session model overrides', () => {
    providerMocks.detectProviderFromEnv.mockReturnValue({
      provider: 'chatgpt',
      apiKey: 'oauth-chatgpt',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      defaultModel: 'gpt-5.5',
    });

    expect(resolveSessionModel('gpt-5.4')).toBe('gpt-5.4');
  });
});
