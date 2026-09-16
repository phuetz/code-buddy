import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveA2AProviderCredentials } from '../../src/protocols/a2a/codebuddy-executor.js';

describe('SERV1 A2A inbound uses the configured local provider', () => {
  const keys = [
    'GROK_API_KEY',
    'GROK_BASE_URL',
    'GROK_MODEL',
    'CODEBUDDY_PROVIDER',
    'OLLAMA_HOST',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GEMINI_API_KEY',
    'XAI_API_KEY',
    'HOME',
    'CODEBUDDY_HOME',
  ] as const;
  const previous: Partial<Record<(typeof keys)[number], string | undefined>> = {};
  let tmpHome = '';

  afterEach(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
      delete previous[key];
    }
    if (tmpHome) {
      fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      tmpHome = '';
    }
  });

  function snapshotEnv(): void {
    for (const key of keys) {
      previous[key] = process.env[key];
      delete process.env[key];
    }
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-serv1-a2a-'));
    process.env.HOME = tmpHome;
    process.env.CODEBUDDY_HOME = path.join(tmpHome, '.codebuddy');
  }

  it('fails closed when no provider is configured', () => {
    snapshotEnv();
    const resolved = resolveA2AProviderCredentials();
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.error).toMatch(/provider|api key/i);
    }
  });

  it('accepts Ollama without GROK_API_KEY', () => {
    snapshotEnv();
    process.env.CODEBUDDY_PROVIDER = 'ollama';
    process.env.OLLAMA_HOST = 'http://127.0.0.1:11434';
    process.env.GROK_MODEL = 'qwen3:4b-instruct';
    const resolved = resolveA2AProviderCredentials();
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.apiKey.length).toBeGreaterThan(0);
      expect(resolved.model).toBe('qwen3:4b-instruct');
      expect(resolved.baseURL).toMatch(/11434/);
    }
  });
});
