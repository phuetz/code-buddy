import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mocks = vi.hoisted(() => ({
  agentConstructorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
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

    async processUserMessage() {
      return [{ content: 'channel response' }];
    }
  }

  return { CodeBuddyAgent: MockCodeBuddyAgent };
});

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    warn: mocks.loggerWarnMock,
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

const { agentConstructorMock, loggerWarnMock } = mocks;

import { createChannelAIAgent } from '../../src/commands/handlers/channel-handlers.js';

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

describe('channel AI provider wiring', () => {
  beforeEach(() => {
    agentConstructorMock.mockReset();
    loggerWarnMock.mockReset();
    for (const key of envKeysToReset) {
      envBackup[key] = process.env[key];
      delete process.env[key];
    }
    process.env.CODEBUDDY_PROVIDER = 'none';
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-ai-provider-'));
  });

  afterEach(() => {
    for (const key of envKeysToReset) {
      if (envBackup[key] !== undefined) process.env[key] = envBackup[key];
      else delete process.env[key];
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('uses ChatGPT Codex OAuth for channel AI responses when detected', async () => {
    process.env.CODEBUDDY_PROVIDER = 'chatgpt';
    writeChatGptAuth();

    const agent = await createChannelAIAgent();

    expect(agent).not.toBeNull();
    expect(agentConstructorMock).toHaveBeenCalledWith(
      'oauth-chatgpt',
      'https://chatgpt.com/backend-api/codex',
      'gpt-5.5'
    );
  });

  it('skips channel AI responses with a provider-agnostic warning when unconfigured', async () => {
    await expect(createChannelAIAgent()).resolves.toBeNull();
    expect(loggerWarnMock).toHaveBeenCalledWith('No provider for channel AI responses');
  });
});
