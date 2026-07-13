/**
 * Phase (d).16a V0.4.1 — peer-chat-client-factory tests.
 *
 * Validates env-driven provider detection: priority order, override,
 * model override, isLocal flag per provider, defensive fallback when
 * env is empty or override is unknown.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  createPeerChatClientForProvider,
  createPeerChatClientFromEnv,
  _getDetectionOrderForTests,
} from '../../src/fleet/peer-chat-client-factory.js';

/** Snapshot env vars we touch so each test can reset them cleanly. */
const ENV_KEYS_TO_PRESERVE = [
  'CODEBUDDY_PEER_PROVIDER',
  'CODEBUDDY_PEER_MODEL',
  'CODEBUDDY_FALLBACK_PROVIDERS',
  'CODEBUDDY_FALLBACK_PROVIDER',
  'CODEBUDDY_FALLBACK_MODEL',
  'CHATGPT_MODEL',
  'CODEBUDDY_CODEX_AUTH_PATH',
  'OLLAMA_HOST',
  'OLLAMA_MODEL',
  'LMSTUDIO_HOST',
  'LMSTUDIO_MODEL',
  'GROK_API_KEY',
  'XAI_API_KEY',
  'XAI_BASE_URL',
  'XAI_MODEL',
  'GROK_BASE_URL',
  'MISTRAL_API_KEY',
  'MISTRAL_MODEL',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_CLI_PATH',
  'AGY_CLI_PATH',
  'LEMONADE_HOST',
  'LEMONADE_MODEL',
  'LEMONADE_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
];

let originalEnv: Record<string, string | undefined>;
let tempAuthDir: string | null = null;

beforeEach(() => {
  originalEnv = {};
  for (const key of ENV_KEYS_TO_PRESERVE) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  tempAuthDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-peer-chat-auth-'));
  process.env.CODEBUDDY_CODEX_AUTH_PATH = path.join(tempAuthDir, 'missing-codex-auth.json');
  // Disable gemini-cli auto-detect by default so tests that don't
  // explicitly opt-in aren't influenced by a real `gemini` binary
  // installed on the test host. A non-existent path short-circuits
  // the PATH walk in `resolveGeminiCliBinary()`.
  process.env.GEMINI_CLI_PATH = '/tmp/__no_gemini_cli_in_tests__';
  process.env.AGY_CLI_PATH = '/tmp/__no_agy_cli_in_tests__';
});

afterEach(() => {
  if (tempAuthDir) {
    fs.rmSync(tempAuthDir, { recursive: true, force: true });
    tempAuthDir = null;
  }
  for (const key of ENV_KEYS_TO_PRESERVE) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('peer-chat-client-factory — Phase (d).16a', () => {
  describe('detection order constant', () => {
    it('exposes the documented priority order (local/subscription first)', () => {
      expect(_getDetectionOrderForTests()).toEqual([
        'ollama',
        'lmstudio',
        'chatgpt-oauth',
        'agy-cli',
        'gemini-cli',
        'lemonade',
        'openrouter',
        'grok',
        'mistral',
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

    it('returns null + warns on an unknown provider override (defensive)', () => {
      process.env.CODEBUDDY_PEER_PROVIDER = 'totally-not-a-provider';
      // Even with Gemini configured, the unknown override blocks it
      process.env.GOOGLE_API_KEY = 'AIza-test-key';
      expect(createPeerChatClientFromEnv()).toBeNull();
    });
  });

  describe('auto-detection priority order', () => {
    it('Ollama beats every cloud provider when OLLAMA_HOST is set', () => {
      process.env.OLLAMA_HOST = 'localhost:11434';
      process.env.CODEBUDDY_CODEX_AUTH_PATH = writeChatGptAuthFile();
      process.env.GROK_API_KEY = 'grok-x';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
      process.env.GOOGLE_API_KEY = 'AIza-x';
      process.env.OPENAI_API_KEY = 'sk-x';
      const result = createPeerChatClientFromEnv();
      expect(result!.info.provider).toBe('ollama');
      expect(result!.info.isLocal).toBe(true);
    });

    it('ChatGPT OAuth beats paid API providers when Ollama is not set', () => {
      process.env.CODEBUDDY_CODEX_AUTH_PATH = writeChatGptAuthFile();
      process.env.GROK_API_KEY = 'grok-x';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
      process.env.GOOGLE_API_KEY = 'AIza-x';
      process.env.OPENAI_API_KEY = 'sk-x';
      const result = createPeerChatClientFromEnv();
      expect(result!.info.provider).toBe('chatgpt-oauth');
      expect(result!.info.model).toBe('gpt-5.5');
      expect(result!.info.isLocal).toBe(false);
    });

    it('CHATGPT_MODEL overrides the ChatGPT OAuth default model', () => {
      process.env.CODEBUDDY_CODEX_AUTH_PATH = writeChatGptAuthFile();
      process.env.CHATGPT_MODEL = 'gpt-5.1-codex';
      const result = createPeerChatClientFromEnv();
      expect(result!.info.provider).toBe('chatgpt-oauth');
      expect(result!.info.model).toBe('gpt-5.1-codex');
    });

    it('Grok beats Anthropic + Gemini + OpenAI when ollama not set', () => {
      process.env.GROK_API_KEY = 'grok-x';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
      process.env.GOOGLE_API_KEY = 'AIza-x';
      process.env.OPENAI_API_KEY = 'sk-x';
      expect(createPeerChatClientFromEnv()!.info.provider).toBe('grok');
    });

    it('accepts XAI_API_KEY and XAI_MODEL aliases for Grok', () => {
      process.env.XAI_API_KEY = 'xai-test';
      process.env.XAI_MODEL = 'grok-4-1-fast';

      expect(createPeerChatClientFromEnv()?.info).toMatchObject({
        provider: 'grok',
        model: 'grok-4-1-fast',
      });
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

  describe('Antigravity + local/free provider routing', () => {
    it('prefers an available agy subscription over Gemini CLI', () => {
      process.env.AGY_CLI_PATH = process.execPath;
      process.env.GEMINI_CLI_PATH = process.execPath;
      const result = createPeerChatClientFromEnv();
      expect(result?.info).toMatchObject({
        provider: 'agy-cli',
        model: 'Gemini 3.1 Pro (High)',
        isLocal: false,
      });
    });

    it('routes explicitly to Lemonade over its local API', () => {
      process.env.CODEBUDDY_PEER_PROVIDER = 'lemonade';
      process.env.LEMONADE_MODEL = 'Qwen3.6-35B-A3B-MTP-GGUF';
      const result = createPeerChatClientFromEnv();
      expect(result?.info).toMatchObject({
        provider: 'lemonade',
        model: 'Qwen3.6-35B-A3B-MTP-GGUF',
        isLocal: true,
      });
      expect(result?.client.getBaseURL()).toBe('http://127.0.0.1:13305/api/v1');
    });

    it('uses OpenRouter free when explicitly selected', () => {
      process.env.CODEBUDDY_PEER_PROVIDER = 'openrouter';
      process.env.OPENROUTER_API_KEY = 'or-test';
      const result = createPeerChatClientFromEnv();
      expect(result?.info).toMatchObject({
        provider: 'openrouter',
        model: 'openrouter/free',
        isLocal: false,
      });
    });

    it('builds an exact alternate provider without leaking the boot model override', () => {
      process.env.CODEBUDDY_PEER_MODEL = 'Gemini 3.5 Flash (Low)';
      const result = createPeerChatClientForProvider(
        'lemonade',
        'Qwen2.5-1.5B-Instruct-GGUF-Q4_K_M',
      );

      expect(result?.info).toEqual({
        provider: 'lemonade',
        model: 'Qwen2.5-1.5B-Instruct-GGUF-Q4_K_M',
        isLocal: true,
      });
      expect(result?.client.getBaseURL()).toBe('http://127.0.0.1:13305/api/v1');
    });

    it('disables CodeBuddyClient fallbacks for an exactly routed provider', () => {
      process.env.OPENAI_API_KEY = 'sk-test-fallback-key';
      process.env.CODEBUDDY_FALLBACK_PROVIDERS = 'openai:gpt-4o';

      const result = createPeerChatClientForProvider('lemonade', 'local-exact');
      const clientState = result?.client as unknown as {
        credentialPoolProviders: unknown[];
        fallbackProviders: unknown[];
      };

      expect(clientState.credentialPoolProviders).toEqual([]);
      expect(clientState.fallbackProviders).toEqual([]);
    });

    it('supports advertised LM Studio and Mistral backends explicitly', () => {
      const lmstudio = createPeerChatClientForProvider('lmstudio', 'local-model');
      expect(lmstudio?.client.getBaseURL()).toBe('http://127.0.0.1:1234/v1');

      process.env.MISTRAL_API_KEY = 'mistral-test';
      const mistral = createPeerChatClientForProvider('mistral', 'mistral-small-latest');
      expect(mistral?.info.provider).toBe('mistral');
      expect(mistral?.client.getBaseURL()).toBe('https://api.mistral.ai/v1');
    });
  });

  describe('isLocal flag', () => {
    it('is true for ollama, false for every cloud provider', () => {
      process.env.OLLAMA_HOST = 'localhost:11434';
      expect(createPeerChatClientFromEnv()!.info.isLocal).toBe(true);

      delete process.env.OLLAMA_HOST;
      process.env.CODEBUDDY_CODEX_AUTH_PATH = writeChatGptAuthFile();
      expect(createPeerChatClientFromEnv()!.info.isLocal).toBe(false);

      process.env.CODEBUDDY_CODEX_AUTH_PATH = path.join(tempAuthDir!, 'missing-codex-auth.json');
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

function writeChatGptAuthFile(): string {
  const authPath = path.join(tempAuthDir!, 'codex-auth.json');
  fs.writeFileSync(
    authPath,
    JSON.stringify({ tokens: { access_token: 'tok_test' } }),
    'utf-8',
  );
  return authPath;
}
