import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mocks = vi.hoisted(() => ({
  agentConstructorMock: vi.fn(),
}));

let tmpHome: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return { ...actual, homedir: () => tmpHome };
});

vi.mock('../../src/agent/codebuddy-agent.js', () => {
  class MockCodeBuddyAgent {
    constructor(apiKey: string, baseURL?: string, model?: string) {
      mocks.agentConstructorMock(apiKey, baseURL, model);
    }
  }

  return { CodeBuddyAgent: MockCodeBuddyAgent };
});

const { agentConstructorMock } = mocks;

import {
  createDetectedAgent,
  getServerProvider,
  MISSING_PROVIDER_MESSAGE,
} from '../../src/server/agent-provider.js';

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

describe('server agent provider wiring', () => {
  beforeEach(() => {
    agentConstructorMock.mockReset();
    for (const key of envKeysToReset) {
      envBackup[key] = process.env[key];
      delete process.env[key];
    }
    process.env.CODEBUDDY_PROVIDER = 'none';
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'server-agent-provider-'));
  });

  afterEach(() => {
    for (const key of envKeysToReset) {
      if (envBackup[key] !== undefined) process.env[key] = envBackup[key];
      else delete process.env[key];
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('reports no server provider when auto-detection finds nothing', () => {
    expect(getServerProvider()).toBeNull();
  });

  it('throws a provider-agnostic setup message when no provider is configured', async () => {
    await expect(createDetectedAgent()).rejects.toThrow(MISSING_PROVIDER_MESSAGE);
  });

  it('constructs CodeBuddyAgent from ChatGPT Codex OAuth credentials', async () => {
    process.env.CODEBUDDY_PROVIDER = 'chatgpt';
    writeChatGptAuth();

    await createDetectedAgent();

    expect(agentConstructorMock).toHaveBeenCalledWith(
      'oauth-chatgpt',
      'https://chatgpt.com/backend-api/codex',
      'gpt-5.5'
    );
  });

  it('lets request-scoped model overrides keep the detected provider transport', async () => {
    process.env.CODEBUDDY_PROVIDER = 'chatgpt';
    writeChatGptAuth();

    const provider = getServerProvider('gpt-5.5-thinking');
    await createDetectedAgent('gpt-5.5-thinking');

    expect(provider).toEqual({
      provider: 'chatgpt',
      model: 'gpt-5.5-thinking',
      baseURL: 'https://chatgpt.com/backend-api/codex',
    });
    expect(agentConstructorMock).toHaveBeenCalledWith(
      'oauth-chatgpt',
      'https://chatgpt.com/backend-api/codex',
      'gpt-5.5-thinking'
    );
  });
});
