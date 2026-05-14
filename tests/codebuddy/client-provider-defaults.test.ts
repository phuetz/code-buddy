import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHATGPT_OAUTH_SENTINEL,
  CHATGPT_RESPONSES_BASE_URL,
  CodeBuddyClient,
  GEMINI_CLI_BASE_URL,
  GEMINI_CLI_SENTINEL,
} from '../../src/codebuddy/client.js';

const envKeys = [
  'CHATGPT_MODEL',
  'GEMINI_CLI_MODEL',
  'GEMINI_MODEL',
  'GROK_BASE_URL',
  'OPENAI_MODEL',
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

describe('CodeBuddyClient provider defaults', () => {
  it('routes ChatGPT OAuth sentinel to the ChatGPT backend and model', () => {
    const client = new CodeBuddyClient(CHATGPT_OAUTH_SENTINEL);

    expect(client.getBaseURL()).toBe(CHATGPT_RESPONSES_BASE_URL);
    expect(client.getCurrentModel()).toBe('gpt-5.5');
  });

  it('uses Gemini default model for a Gemini base URL without a model', () => {
    const client = new CodeBuddyClient(
      'gemini-key',
      undefined,
      'https://generativelanguage.googleapis.com/v1beta',
    );

    expect(client.getCurrentModel()).toBe('gemini-2.5-flash');
  });

  it('replaces incompatible Grok model on Gemini base URL during construction', () => {
    const client = new CodeBuddyClient(
      'gemini-key',
      'grok-3-latest',
      'https://generativelanguage.googleapis.com/v1beta',
    );

    expect(client.getCurrentModel()).toBe('gemini-2.5-flash');
  });

  it('uses OpenAI default model for an OpenAI base URL without a model', () => {
    const client = new CodeBuddyClient(
      'openai-key',
      undefined,
      'https://api.openai.com/v1',
    );

    expect(client.getCurrentModel()).toBe('gpt-4o');
  });

  it('routes Gemini CLI sentinel to the subprocess marker and model', () => {
    const client = new CodeBuddyClient(GEMINI_CLI_SENTINEL);

    expect(client.getBaseURL()).toBe(GEMINI_CLI_BASE_URL);
    expect(client.getCurrentModel()).toBe('gemini-2.5-flash');
  });
});
