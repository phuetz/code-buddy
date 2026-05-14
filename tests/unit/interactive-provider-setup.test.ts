import { vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const testPaths = vi.hoisted(() => ({
  tmpHome: '',
  codeBuddyHome: '',
}));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return { ...actual, homedir: () => testPaths.tmpHome || actual.homedir() };
});

vi.mock('../../src/utils/codebuddy-home.js', () => ({
  getCodeBuddyHome: vi.fn(() => testPaths.codeBuddyHome),
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

import { needsSetup } from '../../src/utils/interactive-setup';
import { resolveSessionModel } from '../../src/server/routes/sessions';

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

function writeChatGptAuth(): void {
  const dir = path.join(testPaths.tmpHome, '.codebuddy');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'codex-auth.json'),
    JSON.stringify({ tokens: { access_token: 'test-access-token' } }),
  );
}

function configureChatGptProvider(): void {
  process.env.CODEBUDDY_PROVIDER = 'chatgpt';
  writeChatGptAuth();
}

describe('interactive provider setup', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    for (const key of envKeysToReset) delete process.env[key];
    process.env.CODEBUDDY_PROVIDER = 'none';
    testPaths.tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'interactive-provider-setup-'));
    testPaths.codeBuddyHome = path.join(testPaths.tmpHome, 'codebuddy-home');
    fs.mkdirSync(testPaths.codeBuddyHome, { recursive: true });
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(testPaths.tmpHome, { recursive: true, force: true });
    testPaths.tmpHome = '';
    testPaths.codeBuddyHome = '';
  });

  it('does not require setup when ChatGPT OAuth is the detected provider', () => {
    configureChatGptProvider();

    expect(needsSetup()).toBe(false);
  });

  it('still accepts legacy stored API keys when no provider is detected', () => {
    fs.writeFileSync(
      path.join(testPaths.codeBuddyHome, 'user-settings.json'),
      JSON.stringify({ apiKey: 'xai-key' }),
    );

    expect(needsSetup()).toBe(false);
  });

  it('uses the detected provider model for new session metadata', () => {
    configureChatGptProvider();
    process.env.GROK_MODEL = 'grok-code-fast-1';

    expect(resolveSessionModel()).toBe('gpt-5.5');
  });

  it('does not treat GROK_MODEL as a ChatGPT session model override', () => {
    configureChatGptProvider();
    process.env.GROK_MODEL = 'gpt-5.1-codex';

    expect(resolveSessionModel()).toBe('gpt-5.5');
  });

  it('preserves explicit non-Grok session model overrides', () => {
    configureChatGptProvider();

    expect(resolveSessionModel('gpt-5.4')).toBe('gpt-5.4');
  });
});
