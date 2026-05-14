import fs from 'fs';
import * as os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testPaths = vi.hoisted(() => ({
  homeDir: '',
}));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testPaths.homeDir || actual.homedir(),
  };
  return {
    ...mocked,
    default: mocked,
  };
});

import { validateStartupConfigWithZod } from '../../src/utils/config-validation/validators.js';

const PROVIDER_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'CHATGPT_MODEL',
  'CODEBUDDY_PROVIDER',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GROK_API_KEY',
  'OLLAMA_HOST',
  'OPENAI_API_KEY',
  'XAI_API_KEY',
] as const;

describe('validateStartupConfigWithZod provider warnings', () => {
  const originalEnv = process.env;
  let projectDir: string;
  let userDir: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const key of PROVIDER_ENV_KEYS) {
      delete process.env[key];
    }
    process.env.CODEBUDDY_PROVIDER = 'none';
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-startup-project-'));
    userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-startup-user-'));
    testPaths.homeDir = userDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(userDir, { recursive: true, force: true });
    testPaths.homeDir = '';
  });

  it('warns when no user setting or detected provider is available', async () => {
    const result = await validateStartupConfigWithZod(projectDir, userDir);

    expect(result.warnings).toContain(
      'No AI provider configured. Run `buddy login chatgpt`, set a provider API key, or configure apiKey in user-settings.json',
    );
  });

  it('does not warn when ChatGPT OAuth is detected', async () => {
    process.env.CODEBUDDY_PROVIDER = 'chatgpt';
    const authDir = path.join(userDir, '.codebuddy');
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(
      path.join(authDir, 'codex-auth.json'),
      JSON.stringify({ tokens: { access_token: 'test-chatgpt-token' } }),
    );

    const result = await validateStartupConfigWithZod(projectDir, userDir);

    expect(result.warnings).not.toContain(
      'No AI provider configured. Run `buddy login chatgpt`, set a provider API key, or configure apiKey in user-settings.json',
    );
  });
});
