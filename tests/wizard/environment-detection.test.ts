import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Neutralise any real ChatGPT/xAI OAuth credentials on the test machine so the
// recommendation logic is driven only by the env/local state each test sets up.
vi.mock('../../src/providers/codex-oauth.js', () => ({
  hasCodexCredentials: () => false,
  getChatGptAuth: async () => null,
}));
vi.mock('../../src/providers/xai-oauth.js', () => ({
  hasXaiCredentials: () => false,
}));

import {
  detectApiKeys,
  detectEnvironment,
  renderDetectionSummary,
  type EnvironmentSnapshot,
} from '../../src/wizard/environment-detection.js';
import { orderGuidesByDetection } from '../../src/wizard/onboarding.js';

describe('environment-detection', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    // Clear every provider key so detection starts from a known-empty baseline.
    for (const k of [
      'GROK_API_KEY',
      'XAI_API_KEY',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'GEMINI_API_KEY',
      'GOOGLE_API_KEY',
      'OPENROUTER_API_KEY',
      'OLLAMA_HOST',
      'LMSTUDIO_HOST',
    ]) {
      delete process.env[k];
    }
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    vi.restoreAllMocks();
  });

  describe('detectApiKeys', () => {
    it('reports a key as available when its env var is set, and marks it not-free', () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      const caps = detectApiKeys();
      const openai = caps.find((c) => c.id === 'openai');
      expect(openai?.available).toBe(true);
      expect(openai?.free).toBe(false);
      expect(openai?.detail).toContain('OPENAI_API_KEY');
    });

    it('reports not-set keys as unavailable', () => {
      const caps = detectApiKeys();
      expect(caps.every((c) => c.available === false)).toBe(true);
    });

    it('accepts either alias for a provider (GOOGLE_API_KEY for gemini)', () => {
      process.env.GOOGLE_API_KEY = 'g-test';
      const gemini = detectApiKeys().find((c) => c.id === 'gemini');
      expect(gemini?.available).toBe(true);
    });
  });

  describe('detectEnvironment recommendation', () => {
    // Force both local probes to fail so only the injected key drives the result.
    function stubNoLocal(): void {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no server')));
    }

    it('recommends nothing free when only a paid API key is present', async () => {
      stubNoLocal();
      process.env.GROK_API_KEY = 'x';
      const snap = await detectEnvironment();
      expect(snap.ready).toBe(true);
      expect(snap.recommendedFree).toBeUndefined();
      expect(snap.recommended?.id).toBe('grok');
      expect(snap.recommended?.free).toBe(false);
    });

    it('is not ready when nothing is configured', async () => {
      stubNoLocal();
      const snap = await detectEnvironment();
      expect(snap.ready).toBe(false);
      expect(snap.recommended).toBeUndefined();
    });
  });

  describe('renderDetectionSummary', () => {
    it('marks available capabilities with a check and free ones with $0', () => {
      const snapshot: EnvironmentSnapshot = {
        capabilities: [
          { id: 'ollama', label: 'Ollama', kind: 'local', free: true, available: true, detail: 'running · 1 model' },
          { id: 'openai', label: 'OpenAI API key', kind: 'api-key', free: false, available: false, detail: 'not set' },
        ],
        ready: true,
      };
      const out = renderDetectionSummary(snapshot);
      expect(out).toContain('✓ Ollama');
      expect(out).toContain('($0)');
      expect(out).toContain('○ OpenAI API key');
    });
  });

  describe('orderGuidesByDetection', () => {
    it('floats the recommended provider to the front and annotates detected ones', () => {
      const snapshot: EnvironmentSnapshot = {
        capabilities: [
          { id: 'ollama', label: 'Ollama local model', kind: 'local', free: true, available: true, detail: 'running' },
        ],
        recommended: { id: 'ollama', label: 'Ollama local model', kind: 'local', free: true, available: true, detail: 'running' },
        ready: true,
      };
      const ordered = orderGuidesByDetection(snapshot);
      expect(ordered[0]?.id).toBe('ollama');
      expect(ordered[0]?.label).toContain('detected');
    });
  });
});
