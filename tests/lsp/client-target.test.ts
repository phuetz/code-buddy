import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveCodeBuddyLSPClientTarget } from '../../src/lsp/client-target.js';

const envKeys = [
  'CODEBUDDY_PROVIDER',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'GROK_MODEL',
] as const;

const envBackup: Partial<Record<typeof envKeys[number], string>> = {};

beforeEach(() => {
  for (const key of envKeys) {
    envBackup[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of envKeys) {
    if (envBackup[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = envBackup[key];
    }
  }
});

describe('resolveCodeBuddyLSPClientTarget', () => {
  it('uses the explicit base URL to replace a legacy Grok fallback model', () => {
    expect(resolveCodeBuddyLSPClientTarget({
      apiKey: 'openai-key',
      baseURL: 'https://api.openai.com/v1',
      model: 'grok-3-latest',
      enableDiagnostics: true,
      enableCompletions: true,
      maxTokens: 2048,
    })).toEqual({
      apiKey: 'openai-key',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4o',
    });
  });

  it('uses the detected provider when settings omit an explicit API key', () => {
    process.env.CODEBUDDY_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'gemini-key';
    process.env.GROK_MODEL = 'grok-3-latest';

    expect(resolveCodeBuddyLSPClientTarget({
      apiKey: '',
      model: 'grok-3-latest',
      enableDiagnostics: true,
      enableCompletions: true,
      maxTokens: 2048,
    })).toEqual({
      apiKey: 'gemini-key',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.5-flash',
    });
  });
});
