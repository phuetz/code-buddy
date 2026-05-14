import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const providerMocks = vi.hoisted(() => ({
  detectProviderFromEnv: vi.fn(),
}));

vi.mock('../../src/utils/provider-detector.js', () => ({
  detectProviderFromEnv: providerMocks.detectProviderFromEnv,
}));

import { validateStartupConfigWithZod } from '../../src/utils/config-validation/validators.js';

describe('validateStartupConfigWithZod provider warnings', () => {
  let projectDir: string;
  let userDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-startup-project-'));
    userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-startup-user-'));
    providerMocks.detectProviderFromEnv.mockReturnValue(null);
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(userDir, { recursive: true, force: true });
  });

  it('warns when no user setting or detected provider is available', async () => {
    const result = await validateStartupConfigWithZod(projectDir, userDir);

    expect(result.warnings).toContain(
      'No AI provider configured. Run `buddy login chatgpt`, set a provider API key, or configure apiKey in user-settings.json',
    );
  });

  it('does not warn when ChatGPT OAuth is detected', async () => {
    providerMocks.detectProviderFromEnv.mockReturnValue({
      provider: 'chatgpt',
      apiKey: 'oauth-chatgpt',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      defaultModel: 'gpt-5.5',
    });

    const result = await validateStartupConfigWithZod(projectDir, userDir);

    expect(result.warnings).not.toContain(
      'No AI provider configured. Run `buddy login chatgpt`, set a provider API key, or configure apiKey in user-settings.json',
    );
  });
});
