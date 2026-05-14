/**
 * Phase (d).16a V0.4.1 — peer-chat-client-factory tests.
 *
 * Validates env-driven provider detection: priority order, override,
 * model override, isLocal flag per provider, defensive fallback when
 * env is empty or override is unknown.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type * as PeerFactory from '../../src/fleet/peer-chat-client-factory.js';

/** Snapshot env vars we touch so each test can reset them cleanly. */
const ENV_KEYS_TO_PRESERVE = [
  'CODEBUDDY_PEER_PROVIDER',
  'CODEBUDDY_PEER_MODEL',
  'CHATGPT_MODEL',
  'OLLAMA_MODEL',
  'OLLAMA_HOST',
  'GROK_API_KEY',
  'GROK_BASE_URL',
  'GROK_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'GEMINI_CLI_PATH',
  'GEMINI_CLI_MODEL',
];

let originalEnv: Record<string, string | undefined>;
let tmpHome: string;
let factory: typeof PeerFactory;

beforeEach(async () => {
  originalEnv = {};
  for (const key of ENV_KEYS_TO_PRESERVE) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  originalEnv.HOME = process.env.HOME;
  originalEnv.USERPROFILE = process.env.USERPROFILE;
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-peer-home-'));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  // Disable gemini-cli auto-detect by default so tests that don't
  // explicitly opt-in aren't influenced by a real `gemini` binary
  // installed on the test host. A non-existent path short-circuits
  // the PATH walk in `resolveGeminiCliBinary()`.
  process.env.GEMINI_CLI_PATH = '/tmp/__no_gemini_cli_in_tests__';
  vi.resetModules();
  factory = await import('../../src/fleet/peer-chat-client-factory.js');
});

afterEach(() => {
  for (const key of ENV_KEYS_TO_PRESERVE) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  if (originalEnv.HOME === undefined) delete process.env.HOME;
  else process.env.HOME = originalEnv.HOME;
  if (originalEnv.USERPROFILE === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalEnv.USERPROFILE;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function createPeerChatClientFromEnv(): ReturnType<typeof factory.createPeerChatClientFromEnv> {
  return factory.createPeerChatClientFromEnv();
}

function resolveProviderFromEnv(
  preferred?: Parameters<typeof factory.resolveProviderFromEnv>[0],
): ReturnType<typeof factory.resolveProviderFromEnv> {
  return factory.resolveProviderFromEnv(preferred);
}

function _getDetectionOrderForTests(): ReturnType<typeof factory._getDetectionOrderForTests> {
  return factory._getDetectionOrderForTests();
}

function writeCodexCredentials(): void {
  const dir = path.join(tmpHome, '.codebuddy');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'codex-auth.json'),
    JSON.stringify({
      tokens: {
        access_token: 'test-access-token',
        id_token: 'test-id-token',
        refresh_token: 'test-refresh-token',
      },
    }),
    'utf-8',
  );
}

describe('peer-chat-client-factory — Phase (d).16a', () => {
  describe('detection order constant', () => {
    it('exposes the documented priority order (local first)', () => {
      expect(_getDetectionOrderForTests()).toEqual([
        'chatgpt',
        'ollama',
        'gemini-cli',
        'grok',
        'anthropic',
        'gemini',
        'openai',
      ]);
    });
  });

  describe('createPeerChatClientFromEnv — empty env', () => {
    it('returns null when no provider key is set', () => {
      expect(createPeerChatClientFromEnv()).toBeNull();
    });
  });

  describe('CODEBUDDY_PEER_PROVIDER override', () => {
    it('honors an explicit override even when other providers are configured', () => {
      // Both Ollama (priority 1) and Gemini are set, but the override picks Gemini.
      process.env.OLLAMA_HOST = 'localhost:11434';
      process.env.GOOGLE_API_KEY = 'AIza-test-key';
      process.env.CODEBUDDY_PEER_PROVIDER = 'gemini';
      const result = createPeerChatClientFromEnv();
      expect(result).not.toBeNull();
      expect(result!.info.provider).toBe('gemini');
      expect(result!.info.isLocal).toBe(false);
    });

    it('returns null when override names a provider whose env is missing', () => {
      // ANTHROPIC_API_KEY not set, but override demands Anthropic.
      process.env.CODEBUDDY_PEER_PROVIDER = 'anthropic';
      expect(createPeerChatClientFromEnv()).toBeNull();
    });

    it('honors explicit CODEBUDDY_PEER_PROVIDER=chatgpt when Codex OAuth exists', () => {
      process.env.OLLAMA_HOST = 'localhost:11434';
      process.env.CODEBUDDY_PEER_PROVIDER = 'chatgpt';
      writeCodexCredentials();

      const result = createPeerChatClientFromEnv();

      expect(result).not.toBeNull();
      expect(result!.info.provider).toBe('chatgpt');
      expect(result!.info.model).toBe('gpt-5.5');
    });

    it('returns null + warns on an unknown provider override (defensive)', () => {
      process.env.CODEBUDDY_PEER_PROVIDER = 'totally-not-a-provider';
      // Even with Gemini configured, the unknown override blocks it
      process.env.GOOGLE_API_KEY = 'AIza-test-key';
      expect(createPeerChatClientFromEnv()).toBeNull();
    });
  });

  describe('auto-detection priority order', () => {
    it('ChatGPT Codex OAuth beats ambient local/API providers once the user is logged in', () => {
      writeCodexCredentials();
      process.env.OLLAMA_HOST = 'localhost:11434';
      process.env.GROK_API_KEY = 'grok-x';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
      process.env.GOOGLE_API_KEY = 'AIza-x';
      process.env.OPENAI_API_KEY = 'sk-x';

      const result = createPeerChatClientFromEnv();

      expect(result!.info.provider).toBe('chatgpt');
      expect(result!.info.isLocal).toBe(false);
      expect(result!.info.model).toBe('gpt-5.5');
    });

    it('Ollama beats every cloud provider when OLLAMA_HOST is set', () => {
      process.env.OLLAMA_HOST = 'localhost:11434';
      process.env.GROK_API_KEY = 'grok-x';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
      process.env.GOOGLE_API_KEY = 'AIza-x';
      process.env.OPENAI_API_KEY = 'sk-x';
      const result = createPeerChatClientFromEnv();
      expect(result!.info.provider).toBe('ollama');
      expect(result!.info.isLocal).toBe(true);
    });

    it('Grok beats Anthropic + Gemini + OpenAI when ollama not set', () => {
      process.env.GROK_API_KEY = 'grok-x';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
      process.env.GOOGLE_API_KEY = 'AIza-x';
      process.env.OPENAI_API_KEY = 'sk-x';
      expect(createPeerChatClientFromEnv()!.info.provider).toBe('grok');
    });

    it('Anthropic beats Gemini + OpenAI when grok not set', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
      process.env.GOOGLE_API_KEY = 'AIza-x';
      process.env.OPENAI_API_KEY = 'sk-x';
      expect(createPeerChatClientFromEnv()!.info.provider).toBe('anthropic');
    });

    it('Gemini wins when only Google + OpenAI keys are set', () => {
      process.env.GOOGLE_API_KEY = 'AIza-x';
      process.env.OPENAI_API_KEY = 'sk-x';
      expect(createPeerChatClientFromEnv()!.info.provider).toBe('gemini');
    });

    it('GEMINI_API_KEY also activates the Gemini provider (alias for GOOGLE_API_KEY)', () => {
      process.env.GEMINI_API_KEY = 'gem-key';
      const result = createPeerChatClientFromEnv();
      expect(result!.info.provider).toBe('gemini');
    });

    it('OpenAI is the last-resort fallback', () => {
      process.env.OPENAI_API_KEY = 'sk-x';
      expect(createPeerChatClientFromEnv()!.info.provider).toBe('openai');
    });
  });

  describe('gemini-cli — subprocess provider', () => {
    it('detects when GEMINI_CLI_PATH points at an existing binary', () => {
      // Use process.execPath as a stand-in for the gemini binary —
      // it's guaranteed to exist in test environments.
      process.env.GEMINI_CLI_PATH = process.execPath;
      const result = createPeerChatClientFromEnv();
      expect(result).not.toBeNull();
      expect(result!.info.provider).toBe('gemini-cli');
      expect(result!.info.isLocal).toBe(true);
      expect(result!.info.model).toBe('gemini-3.1-pro-preview');
    });

    it('returns null when GEMINI_CLI_PATH points at a missing file', () => {
      process.env.GEMINI_CLI_PATH = '/tmp/__definitely_not_a_real_binary__';
      // No other provider env set — should be null, not an error.
      expect(createPeerChatClientFromEnv()).toBeNull();
    });

    it('beats the gemini API key when both are configured', () => {
      // Both gemini-cli (Ultra subscription) and a Gemini API key set —
      // we must prefer the CLI to avoid burning paid quota.
      process.env.GEMINI_CLI_PATH = process.execPath;
      process.env.GOOGLE_API_KEY = 'AIza-test';
      const result = createPeerChatClientFromEnv();
      expect(result!.info.provider).toBe('gemini-cli');
    });

    it('honours CODEBUDDY_PEER_MODEL override on gemini-cli', () => {
      process.env.GEMINI_CLI_PATH = process.execPath;
      process.env.CODEBUDDY_PEER_MODEL = 'gemini-2.5-flash';
      const result = createPeerChatClientFromEnv();
      expect(result!.info.model).toBe('gemini-2.5-flash');
    });

    it('explicit override CODEBUDDY_PEER_PROVIDER=gemini-cli also works', () => {
      process.env.CODEBUDDY_PEER_PROVIDER = 'gemini-cli';
      process.env.GEMINI_CLI_PATH = process.execPath;
      const result = createPeerChatClientFromEnv();
      expect(result!.info.provider).toBe('gemini-cli');
    });
  });

  describe('isLocal flag', () => {
    it('is true for local/subprocess providers, false for cloud providers', () => {
      writeCodexCredentials();
      expect(createPeerChatClientFromEnv()!.info.isLocal).toBe(false);
      fs.rmSync(path.join(tmpHome, '.codebuddy'), { recursive: true, force: true });

      process.env.OLLAMA_HOST = 'localhost:11434';
      expect(createPeerChatClientFromEnv()!.info.isLocal).toBe(true);

      delete process.env.OLLAMA_HOST;
      process.env.GROK_API_KEY = 'x';
      expect(createPeerChatClientFromEnv()!.info.isLocal).toBe(false);

      delete process.env.GROK_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'x';
      expect(createPeerChatClientFromEnv()!.info.isLocal).toBe(false);

      delete process.env.ANTHROPIC_API_KEY;
      process.env.GOOGLE_API_KEY = 'x';
      expect(createPeerChatClientFromEnv()!.info.isLocal).toBe(false);

      delete process.env.GOOGLE_API_KEY;
      process.env.OPENAI_API_KEY = 'x';
      expect(createPeerChatClientFromEnv()!.info.isLocal).toBe(false);
    });
  });

  describe('CODEBUDDY_PEER_MODEL override', () => {
    it('overrides the provider default model', () => {
      process.env.GOOGLE_API_KEY = 'x';
      process.env.CODEBUDDY_PEER_MODEL = 'gemini-2.0-flash-exp';
      const result = createPeerChatClientFromEnv();
      expect(result!.info.model).toBe('gemini-2.0-flash-exp');
    });

    it('falls back to the provider default when CODEBUDDY_PEER_MODEL is not set', () => {
      process.env.GOOGLE_API_KEY = 'x';
      const result = createPeerChatClientFromEnv();
      expect(result!.info.model).toBe('gemini-2.5-flash');
    });

    it('honors provider-specific model env before the provider default', () => {
      process.env.GROK_API_KEY = 'x';
      process.env.GROK_MODEL = 'grok-3-mini';

      expect(createPeerChatClientFromEnv()!.info.model).toBe('grok-3-mini');
      expect(resolveProviderFromEnv('grok')?.model).toBe('grok-3-mini');
    });

    it('uses CHATGPT_MODEL as the ChatGPT subscription default before the generic peer override', () => {
      writeCodexCredentials();
      process.env.CHATGPT_MODEL = 'gpt-5.1-codex';
      let result = createPeerChatClientFromEnv();
      expect(result!.info.model).toBe('gpt-5.1-codex');

      process.env.CODEBUDDY_PEER_MODEL = 'gpt-5.1-codex-max';
      result = createPeerChatClientFromEnv();
      expect(result!.info.model).toBe('gpt-5.1-codex-max');
    });

    it('uses CHATGPT_MODEL when resolving a raw ChatGPT provider tuple', () => {
      writeCodexCredentials();
      process.env.CHATGPT_MODEL = 'gpt-5.1-codex';

      expect(resolveProviderFromEnv('chatgpt')?.model).toBe('gpt-5.1-codex');
    });
  });

  describe('OLLAMA_HOST normalization', () => {
    it('accepts bare host:port (prepends http:// + appends /v1)', () => {
      process.env.OLLAMA_HOST = 'localhost:11434';
      // The factory must build a client without throwing — that's what we
      // assert here. The exact baseUrl is internal; we trust the construct.
      const result = createPeerChatClientFromEnv();
      expect(result).not.toBeNull();
      expect(result!.info.provider).toBe('ollama');
    });

    it('accepts a full URL with /v1 suffix', () => {
      process.env.OLLAMA_HOST = 'http://my-ollama.local:11434/v1';
      const result = createPeerChatClientFromEnv();
      expect(result!.info.provider).toBe('ollama');
    });

    it('accepts a URL without /v1 (factory appends it)', () => {
      process.env.OLLAMA_HOST = 'http://my-ollama.local:11434';
      const result = createPeerChatClientFromEnv();
      expect(result!.info.provider).toBe('ollama');
    });
  });

  describe('client construction sanity', () => {
    it('returns a CodeBuddyClient instance with a chat() method', () => {
      process.env.GOOGLE_API_KEY = 'x';
      const result = createPeerChatClientFromEnv();
      expect(result).not.toBeNull();
      expect(typeof result!.client.chat).toBe('function');
    });
  });
});
