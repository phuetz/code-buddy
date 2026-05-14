import { afterEach, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tmpHome: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return { ...actual, homedir: () => tmpHome };
});

import { listChatModels } from '../../src/server/routes/chat';

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

describe('chat model catalog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of envKeysToReset) {
      envBackup[key] = process.env[key];
      delete process.env[key];
    }
    process.env.CODEBUDDY_PROVIDER = 'none';
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-model-catalog-'));
  });

  afterEach(() => {
    for (const key of envKeysToReset) {
      if (envBackup[key] !== undefined) process.env[key] = envBackup[key];
      else delete process.env[key];
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('includes non-Grok providers for the server model endpoint', () => {
    const ids = listChatModels(123).map((model) => model.id);

    expect(ids).toContain('gpt-5.5');
    expect(ids).toContain('gemini-2.5-flash');
    expect(ids).toContain('claude-sonnet-4-20250514');
    expect(ids).toContain('grok-3-fast');
  });

  it('marks and sorts the detected provider first', () => {
    process.env.CODEBUDDY_PROVIDER = 'chatgpt';
    writeChatGptAuth();

    const models = listChatModels(123);

    expect(models[0]).toMatchObject({
      id: 'gpt-5.5',
      provider: 'chatgpt',
      active_provider: true,
    });
    expect(models.find((model) => model.id === 'grok-3-fast')?.active_provider).toBe(false);
  });
});
