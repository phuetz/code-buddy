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

let tmpHome: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return { ...actual, homedir: () => tmpHome };
});

// Snapshot env so tests can clobber and restore cleanly.
const envKeysToReset = [
  'CODEBUDDY_PROVIDER',
  'OLLAMA_HOST',
  'OLLAMA_MODEL',
  'GROK_API_KEY',
  'GROK_BASE_URL',
  'GROK_MODEL',
  'XAI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'CHATGPT_MODEL',
];
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

function writeAuth(
  content: unknown = { tokens: { access_token: 'tok' } },
  relativeDir: '.codebuddy' | '.codex' = '.codebuddy',
  fileName: 'codex-auth.json' | 'auth.json' = 'codex-auth.json',
): void {
  const dir = path.join(tmpHome, relativeDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, fileName),
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
    expect(detected?.defaultModel).toBe('gpt-5.5');
  });

  it('uses shared Codex CLI credentials when Code Buddy credentials are absent', async () => {
    writeAuth({ tokens: { access_token: 'codex-shared-token' } }, '.codex', 'auth.json');
    process.env.GROK_API_KEY = 'should-not-be-used';
    const { detectProviderFromEnv } = await import('../../src/utils/provider-detector.js');
    const detected = detectProviderFromEnv();
    expect(detected?.provider).toBe('chatgpt');
    expect(detected?.apiKey).toBe('oauth-chatgpt');
    expect(detected?.defaultModel).toBe('gpt-5.5');
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

  it('CHATGPT_MODEL env overrides default gpt-5.5', async () => {
    writeAuth();
    process.env.CHATGPT_MODEL = 'gpt-5.1-codex';
    const { detectProviderFromEnv } = await import('../../src/utils/provider-detector.js');
    expect(detectProviderFromEnv()?.defaultModel).toBe('gpt-5.1-codex');
  });
});
