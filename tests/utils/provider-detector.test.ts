/**
 * Phase d.25 — tests for src/utils/provider-detector.ts.
 *
 * Verifies the priority chain: chatgpt OAuth > ollama > grok > gemini >
 * openai > anthropic > null. The chatgpt-vs-ollama priority is the
 * critical one Patrice asked for: an explicit `buddy login chatgpt`
 * should NOT be hijacked by a stale OLLAMA_HOST in the user's shell rc.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { vi } from 'vitest';
import { RUNTIME_PROVIDER_CATALOG } from '../../src/providers/provider-catalog.js';

let tmpHome: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return { ...actual, homedir: () => tmpHome };
});

// Snapshot env so tests can clobber and restore cleanly.
const catalogEnvKeys = RUNTIME_PROVIDER_CATALOG.flatMap((entry) => [
  ...entry.apiKeyEnvKeys,
  ...entry.baseUrlEnvKeys,
  ...entry.modelEnvKeys,
]);

const envKeysToReset = [...new Set([
  'CODEBUDDY_PROVIDER',
  'CHATGPT_MODEL',
  ...catalogEnvKeys,
])];
const envBackup: Record<string, string | undefined> = {};

beforeEach(() => {
  // Fresh isolated HOME so codex-auth.json is per-test.
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-detector-'));
  // Clear all relevant env keys.
  for (const k of envKeysToReset) {
    envBackup[k] = process.env[k];
    delete process.env[k];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const k of envKeysToReset) {
    if (envBackup[k] !== undefined) {
      process.env[k] = envBackup[k];
    } else {
      delete process.env[k];
    }
  }
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

function writeAuth(content: unknown = { tokens: { access_token: 'tok' } }): void {
  const dir = path.join(tmpHome, '.codebuddy');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'codex-auth.json'),
    typeof content === 'string' ? content : JSON.stringify(content),
  );
}

describe('detectProviderFromEnv — priority chain', () => {
  it('returns null when nothing is configured', async () => {
    const { detectProviderFromEnv } = await import('../../src/utils/provider-detector.js');
    expect(detectProviderFromEnv()).toBeNull();
  });

  it('chatgpt OAuth credentials beat ambient OLLAMA_HOST', async () => {
    writeAuth();
    process.env.OLLAMA_HOST = 'http://localhost:11434';
    process.env.GROK_API_KEY = 'should-not-be-used';
    const { detectProviderFromEnv } = await import('../../src/utils/provider-detector.js');
    const detected = detectProviderFromEnv();
    expect(detected?.provider).toBe('chatgpt');
    expect(detected?.apiKey).toBe('oauth-chatgpt');
    expect(detected?.baseURL).toBe('https://chatgpt.com/backend-api/codex');
    expect(detected?.defaultModel).toBe('gpt-5.6-sol');
  });

  it('CODEBUDDY_PROVIDER override always wins (forces ollama even if chatgpt OAuth file exists)', async () => {
    writeAuth();
    process.env.CODEBUDDY_PROVIDER = 'ollama';
    process.env.OLLAMA_HOST = 'http://localhost:11434';
    const { detectProviderFromEnv } = await import('../../src/utils/provider-detector.js');
    const detected = detectProviderFromEnv();
    expect(detected?.provider).toBe('ollama');
  });

  it('falls back to ollama when no chatgpt OAuth + OLLAMA_HOST set', async () => {
    process.env.OLLAMA_HOST = 'http://localhost:11434';
    process.env.GROK_API_KEY = 'should-not-be-used';
    const { detectProviderFromEnv } = await import('../../src/utils/provider-detector.js');
    expect(detectProviderFromEnv()?.provider).toBe('ollama');
  });

  it('ollama auto-prepends http:// and appends /v1 to OLLAMA_HOST', async () => {
    process.env.OLLAMA_HOST = 'localhost:11434';
    const { detectProviderFromEnv } = await import('../../src/utils/provider-detector.js');
    expect(detectProviderFromEnv()?.baseURL).toBe('http://localhost:11434/v1');
  });

  it('falls back to grok when no chatgpt + no ollama + GROK_API_KEY set', async () => {
    process.env.GROK_API_KEY = 'xai-key';
    process.env.GEMINI_API_KEY = 'should-not-be-used';
    const { detectProviderFromEnv } = await import('../../src/utils/provider-detector.js');
    const detected = detectProviderFromEnv();
    expect(detected?.provider).toBe('grok');
    expect(detected?.apiKey).toBe('xai-key');
  });

  it('falls back to gemini when only GEMINI_API_KEY is set', async () => {
    process.env.GEMINI_API_KEY = 'aiza-key';
    process.env.OPENAI_API_KEY = 'should-not-be-used';
    const { detectProviderFromEnv } = await import('../../src/utils/provider-detector.js');
    expect(detectProviderFromEnv()?.provider).toBe('gemini');
  });

  it('falls back to openai when only OPENAI_API_KEY is set', async () => {
    process.env.OPENAI_API_KEY = 'sk-key';
    const { detectProviderFromEnv } = await import('../../src/utils/provider-detector.js');
    const detected = detectProviderFromEnv();
    expect(detected?.provider).toBe('openai');
    expect(detected?.defaultModel).toBe('gpt-4o');
  });

  it('falls back to anthropic when only ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-key';
    const { detectProviderFromEnv } = await import('../../src/utils/provider-detector.js');
    expect(detectProviderFromEnv()?.provider).toBe('anthropic');
  });

  it('skips chatgpt path when codex-auth.json exists but has no access_token', async () => {
    writeAuth({ tokens: {} });
    process.env.OLLAMA_HOST = 'http://localhost:11434';
    const { detectProviderFromEnv } = await import('../../src/utils/provider-detector.js');
    expect(detectProviderFromEnv()?.provider).toBe('ollama');
  });

  it('skips chatgpt path when codex-auth.json is malformed JSON', async () => {
    writeAuth('not-json{{{');
    process.env.OLLAMA_HOST = 'http://localhost:11434';
    const { detectProviderFromEnv } = await import('../../src/utils/provider-detector.js');
    expect(detectProviderFromEnv()?.provider).toBe('ollama');
  });

  it('CHATGPT_MODEL env overrides the default GPT-5.6 Sol model', async () => {
    writeAuth();
    process.env.CHATGPT_MODEL = 'gpt-5.1-codex';
    const { detectProviderFromEnv } = await import('../../src/utils/provider-detector.js');
    expect(detectProviderFromEnv()?.defaultModel).toBe('gpt-5.1-codex');
  });

  it('detects LM Studio when its host is configured', async () => {
    process.env.LMSTUDIO_HOST = 'localhost:1234';
    const { detectProviderFromEnv } = await import('../../src/utils/provider-detector.js');
    const detected = detectProviderFromEnv();
    expect(detected?.provider).toBe('lmstudio');
    expect(detected?.apiKey).toBe('lm-studio');
    expect(detected?.baseURL).toBe('http://localhost:1234/v1');
  });

  it('detects Groq as an OpenAI-compatible provider', async () => {
    process.env.GROQ_API_KEY = 'groq-key';
    const { detectProviderFromEnv } = await import('../../src/utils/provider-detector.js');
    const detected = detectProviderFromEnv();
    expect(detected?.provider).toBe('groq');
    expect(detected?.apiKey).toBe('groq-key');
    expect(detected?.baseURL).toBe('https://api.groq.com/openai/v1');
    expect(detected?.defaultModel).toBe('llama-3.3-70b-versatile');
  });

  it('detects OpenRouter when configured', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-key';
    const { detectProviderFromEnv } = await import('../../src/utils/provider-detector.js');
    const detected = detectProviderFromEnv();
    expect(detected?.provider).toBe('openrouter');
    expect(detected?.baseURL).toBe('https://openrouter.ai/api/v1');
  });

  it('detects Hermes-style OpenAI-compatible providers by env key', async () => {
    process.env.GLM_API_KEY = 'glm-key';
    const { detectProviderFromEnv } = await import('../../src/utils/provider-detector.js');
    const detected = detectProviderFromEnv();
    expect(detected?.provider).toBe('zai');
    expect(detected?.baseURL).toBe('https://api.z.ai/api/paas/v4');
    expect(detected?.defaultModel).toBe('glm-5');
  });

  it('normalizes vLLM base URLs for the OpenAI-compatible client', async () => {
    process.env.VLLM_BASE_URL = 'http://localhost:8000';
    process.env.VLLM_MODEL = 'served-model';
    const { detectProviderFromEnv } = await import('../../src/utils/provider-detector.js');
    const detected = detectProviderFromEnv();
    expect(detected?.provider).toBe('vllm');
    expect(detected?.apiKey).toBe('vllm');
    expect(detected?.baseURL).toBe('http://localhost:8000/v1');
    expect(detected?.defaultModel).toBe('served-model');
  });

  it('CODEBUDDY_PROVIDER can force a provider alias', async () => {
    process.env.CODEBUDDY_PROVIDER = 'claude';
    process.env.ANTHROPIC_API_KEY = 'anthropic-key';
    const { detectProviderFromEnv } = await import('../../src/utils/provider-detector.js');
    const detected = detectProviderFromEnv();
    expect(detected?.provider).toBe('anthropic');
    expect(detected?.apiKey).toBe('anthropic-key');
  });
});
