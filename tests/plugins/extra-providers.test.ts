/**
 * Extra Providers Unit Tests
 *
 * Tests for Groq, Together AI, and Fireworks AI bundled provider plugins.
 */

import { createGroqProvider, GROQ_PROVIDER_ID } from '../../src/plugins/bundled/groq-provider.js';
import { createTogetherProvider, TOGETHER_PROVIDER_ID } from '../../src/plugins/bundled/together-provider.js';
import { createFireworksProvider, FIREWORKS_PROVIDER_ID } from '../../src/plugins/bundled/fireworks-provider.js';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('Groq Provider', () => {
  const originalEnv = process.env.GROQ_API_KEY;

  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.GROQ_API_KEY = originalEnv;
    } else {
      delete process.env.GROQ_API_KEY;
    }
  });

  describe('createGroqProvider', () => {
    it('should return null when GROQ_API_KEY is not set', () => {
      delete process.env.GROQ_API_KEY;
      const provider = createGroqProvider();
      expect(provider).toBeNull();
    });

    it('should return provider when GROQ_API_KEY is set', () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      const provider = createGroqProvider();
      expect(provider).not.toBeNull();
    });

    it('should have correct id', () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      const provider = createGroqProvider()!;
      expect(provider.id).toBe(GROQ_PROVIDER_ID);
      expect(provider.id).toBe('bundled-groq');
    });

    it('should have correct name', () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      const provider = createGroqProvider()!;
      expect(provider.name).toBe('Groq');
    });

    it('should have type llm', () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      const provider = createGroqProvider()!;
      expect(provider.type).toBe('llm');
    });

    it('should have correct base URL in config', () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      const provider = createGroqProvider()!;
      expect(provider.config?.baseUrl).toBe('https://api.groq.com/openai/v1');
    });

    it('should have onboarding hooks', () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      const provider = createGroqProvider()!;
      expect(provider.onboarding).toBeDefined();
      expect(provider.onboarding?.auth).toBeDefined();
      expect(provider.onboarding?.['discovery.run']).toBeDefined();
      expect(provider.onboarding?.['wizard.modelPicker']).toBeDefined();
      expect(provider.onboarding?.onModelSelected).toBeDefined();
    });
  });

  describe('initialization', () => {
    it('should initialize without error', async () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      const provider = createGroqProvider()!;
      await expect(provider.initialize()).resolves.not.toThrow();
    });

    it('should shutdown without error', async () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      const provider = createGroqProvider()!;
      await provider.initialize();
      await expect(provider.shutdown!()).resolves.not.toThrow();
    });
  });

  describe('chat', () => {
    it('should make POST request to Groq chat endpoint', async () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      const provider = createGroqProvider()!;

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello from Groq!' } }],
        }),
      });

      const result = await provider.chat!([{ role: 'user', content: 'Hello' }]);

      expect(result).toBe('Hello from Groq!');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.groq.com/openai/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-groq-key',
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should throw on API error', async () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      const provider = createGroqProvider()!;

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(
        provider.chat!([{ role: 'user', content: 'Hello' }])
      ).rejects.toThrow('Groq API error');
    });

    it('should throw on empty choices', async () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      const provider = createGroqProvider()!;

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [] }),
      });

      await expect(
        provider.chat!([{ role: 'user', content: 'Hello' }])
      ).rejects.toThrow('Groq returned empty response content');
    });
  });

  describe('complete', () => {
    it('should delegate to chat with user message', async () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      const provider = createGroqProvider()!;

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Completed!' } }],
        }),
      });

      const result = await provider.complete!('Complete this');
      expect(result).toBe('Completed!');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages).toEqual([{ role: 'user', content: 'Complete this' }]);
    });
  });

  describe('onboarding hooks', () => {
    it('auth should return valid on success', async () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      const provider = createGroqProvider()!;

      mockFetch.mockResolvedValue({ ok: true });
      const result = await provider.onboarding!.auth!();
      expect(result.valid).toBe(true);
    });

    it('auth should return invalid on HTTP error', async () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      const provider = createGroqProvider()!;

      mockFetch.mockResolvedValue({ ok: false, status: 401 });
      const result = await provider.onboarding!.auth!();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('401');
    });

    it('auth should return invalid on network error', async () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      const provider = createGroqProvider()!;

      mockFetch.mockRejectedValue(new Error('Connection refused'));
      const result = await provider.onboarding!.auth!();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Connection refused');
    });

    it('discovery should return models', async () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      const provider = createGroqProvider()!;

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'llama-3.3-70b-versatile', owned_by: 'meta', context_window: 131072 },
            { id: 'mixtral-8x7b-32768', owned_by: 'mistral', context_window: 32768 },
          ],
        }),
      });

      const models = await provider.onboarding!['discovery.run']!();
      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('llama-3.3-70b-versatile');
      expect(models[0].contextWindow).toBe(131072);
      expect(models[1].id).toBe('mixtral-8x7b-32768');
    });

    it('model picker should prefer llama-3.3-70b-versatile', async () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      const provider = createGroqProvider()!;

      const models = [
        { id: 'mixtral-8x7b-32768', name: 'Mixtral', contextWindow: 32768 },
        { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', contextWindow: 131072 },
      ];

      const picked = await provider.onboarding!['wizard.modelPicker']!(models);
      expect(picked).toBe('llama-3.3-70b-versatile');
    });
  });
});

// ============================================================================
// Together AI Provider
// ============================================================================

describe('Together AI Provider', () => {
  const originalEnv = process.env.TOGETHER_API_KEY;

  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.TOGETHER_API_KEY = originalEnv;
    } else {
      delete process.env.TOGETHER_API_KEY;
    }
  });

  describe('createTogetherProvider', () => {
    it('should return null when TOGETHER_API_KEY is not set', () => {
      delete process.env.TOGETHER_API_KEY;
      const provider = createTogetherProvider();
      expect(provider).toBeNull();
    });

    it('should return provider when TOGETHER_API_KEY is set', () => {
      process.env.TOGETHER_API_KEY = 'test-together-key';
      const provider = createTogetherProvider();
      expect(provider).not.toBeNull();
    });

    it('should have correct id', () => {
      process.env.TOGETHER_API_KEY = 'test-together-key';
      const provider = createTogetherProvider()!;
      expect(provider.id).toBe(TOGETHER_PROVIDER_ID);
      expect(provider.id).toBe('bundled-together');
    });

    it('should have correct name and type', () => {
      process.env.TOGETHER_API_KEY = 'test-together-key';
      const provider = createTogetherProvider()!;
      expect(provider.name).toBe('Together AI');
      expect(provider.type).toBe('llm');
    });

    it('should have correct base URL in config', () => {
      process.env.TOGETHER_API_KEY = 'test-together-key';
      const provider = createTogetherProvider()!;
      expect(provider.config?.baseUrl).toBe('https://api.together.xyz/v1');
    });

    it('should have onboarding hooks', () => {
      process.env.TOGETHER_API_KEY = 'test-together-key';
      const provider = createTogetherProvider()!;
      expect(provider.onboarding).toBeDefined();
      expect(provider.onboarding?.auth).toBeDefined();
      expect(provider.onboarding?.['discovery.run']).toBeDefined();
    });
  });

  describe('chat', () => {
    it('should make POST request to Together AI chat endpoint', async () => {
      process.env.TOGETHER_API_KEY = 'test-together-key';
      const provider = createTogetherProvider()!;

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello from Together!' } }],
        }),
      });

      const result = await provider.chat!([{ role: 'user', content: 'Hello' }]);

      expect(result).toBe('Hello from Together!');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.together.xyz/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-together-key',
          }),
        })
      );
    });

    it('should throw on API error', async () => {
      process.env.TOGETHER_API_KEY = 'test-together-key';
      const provider = createTogetherProvider()!;

      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });

      await expect(
        provider.chat!([{ role: 'user', content: 'Hello' }])
      ).rejects.toThrow('Together AI API error');
    });
  });

  describe('onboarding hooks', () => {
    it('auth should return valid on success', async () => {
      process.env.TOGETHER_API_KEY = 'test-together-key';
      const provider = createTogetherProvider()!;

      mockFetch.mockResolvedValue({ ok: true });
      const result = await provider.onboarding!.auth!();
      expect(result.valid).toBe(true);
    });

    it('discovery should return models', async () => {
      process.env.TOGETHER_API_KEY = 'test-together-key';
      const provider = createTogetherProvider()!;

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'meta-llama/Llama-3-70b', owned_by: 'meta', context_length: 8192 },
          ],
        }),
      });

      const models = await provider.onboarding!['discovery.run']!();
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('meta-llama/Llama-3-70b');
      expect(models[0].contextWindow).toBe(8192);
    });
  });
});

// ============================================================================
// Fireworks AI Provider
// ============================================================================

describe('Fireworks AI Provider', () => {
  const originalEnv = process.env.FIREWORKS_API_KEY;

  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.FIREWORKS_API_KEY = originalEnv;
    } else {
      delete process.env.FIREWORKS_API_KEY;
    }
  });

  describe('createFireworksProvider', () => {
    it('should return null when FIREWORKS_API_KEY is not set', () => {
      delete process.env.FIREWORKS_API_KEY;
      const provider = createFireworksProvider();
      expect(provider).toBeNull();
    });

    it('should return provider when FIREWORKS_API_KEY is set', () => {
      process.env.FIREWORKS_API_KEY = 'test-fireworks-key';
      const provider = createFireworksProvider();
      expect(provider).not.toBeNull();
    });

    it('should have correct id', () => {
      process.env.FIREWORKS_API_KEY = 'test-fireworks-key';
      const provider = createFireworksProvider()!;
      expect(provider.id).toBe(FIREWORKS_PROVIDER_ID);
      expect(provider.id).toBe('bundled-fireworks');
    });

    it('should have correct name and type', () => {
      process.env.FIREWORKS_API_KEY = 'test-fireworks-key';
      const provider = createFireworksProvider()!;
      expect(provider.name).toBe('Fireworks AI');
      expect(provider.type).toBe('llm');
    });

    it('should have correct base URL in config', () => {
      process.env.FIREWORKS_API_KEY = 'test-fireworks-key';
      const provider = createFireworksProvider()!;
      expect(provider.config?.baseUrl).toBe('https://api.fireworks.ai/inference/v1');
    });

    it('should have onboarding hooks', () => {
      process.env.FIREWORKS_API_KEY = 'test-fireworks-key';
      const provider = createFireworksProvider()!;
      expect(provider.onboarding).toBeDefined();
      expect(provider.onboarding?.auth).toBeDefined();
      expect(provider.onboarding?.['discovery.run']).toBeDefined();
    });
  });

  describe('chat', () => {
    it('should make POST request to Fireworks AI chat endpoint', async () => {
      process.env.FIREWORKS_API_KEY = 'test-fireworks-key';
      const provider = createFireworksProvider()!;

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello from Fireworks!' } }],
        }),
      });

      const result = await provider.chat!([{ role: 'user', content: 'Hello' }]);

      expect(result).toBe('Hello from Fireworks!');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.fireworks.ai/inference/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-fireworks-key',
          }),
        })
      );
    });

    it('should throw on API error', async () => {
      process.env.FIREWORKS_API_KEY = 'test-fireworks-key';
      const provider = createFireworksProvider()!;

      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      await expect(
        provider.chat!([{ role: 'user', content: 'Hello' }])
      ).rejects.toThrow('Fireworks AI API error');
    });
  });

  describe('complete', () => {
    it('should delegate to chat', async () => {
      process.env.FIREWORKS_API_KEY = 'test-fireworks-key';
      const provider = createFireworksProvider()!;

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Completed!' } }],
        }),
      });

      const result = await provider.complete!('Complete this');
      expect(result).toBe('Completed!');
    });
  });

  describe('onboarding hooks', () => {
    it('auth should return valid on success', async () => {
      process.env.FIREWORKS_API_KEY = 'test-fireworks-key';
      const provider = createFireworksProvider()!;

      mockFetch.mockResolvedValue({ ok: true });
      const result = await provider.onboarding!.auth!();
      expect(result.valid).toBe(true);
    });

    it('auth should return invalid on network error', async () => {
      process.env.FIREWORKS_API_KEY = 'test-fireworks-key';
      const provider = createFireworksProvider()!;

      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      const result = await provider.onboarding!.auth!();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('discovery should return models', async () => {
      process.env.FIREWORKS_API_KEY = 'test-fireworks-key';
      const provider = createFireworksProvider()!;

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'accounts/fireworks/models/llama-v3p1-70b', owned_by: 'fireworks', context_length: 131072 },
            { id: 'accounts/fireworks/models/mixtral-8x22b', owned_by: 'fireworks' },
          ],
        }),
      });

      const models = await provider.onboarding!['discovery.run']!();
      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('accounts/fireworks/models/llama-v3p1-70b');
      expect(models[0].contextWindow).toBe(131072);
      // Second model should fall back to default context window
      expect(models[1].contextWindow).toBe(4096);
    });

    it('discovery should throw on HTTP error', async () => {
      process.env.FIREWORKS_API_KEY = 'test-fireworks-key';
      const provider = createFireworksProvider()!;

      mockFetch.mockResolvedValue({ ok: false, status: 403 });

      await expect(
        provider.onboarding!['discovery.run']!()
      ).rejects.toThrow('Fireworks AI /models returned HTTP 403');
    });
  });
});

// ============================================================================
// Cross-Provider Tests
// ============================================================================

describe('Cross-Provider Consistency', () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = 'test-groq';
    process.env.TOGETHER_API_KEY = 'test-together';
    process.env.FIREWORKS_API_KEY = 'test-fireworks';
  });

  afterEach(() => {
    delete process.env.GROQ_API_KEY;
    delete process.env.TOGETHER_API_KEY;
    delete process.env.FIREWORKS_API_KEY;
  });

  it('all providers should have unique IDs', () => {
    const groq = createGroqProvider()!;
    const together = createTogetherProvider()!;
    const fireworks = createFireworksProvider()!;

    const ids = new Set([groq.id, together.id, fireworks.id]);
    expect(ids.size).toBe(3);
  });

  it('all providers should have chat and complete methods', () => {
    const groq = createGroqProvider()!;
    const together = createTogetherProvider()!;
    const fireworks = createFireworksProvider()!;

    for (const provider of [groq, together, fireworks]) {
      expect(provider.chat).toBeDefined();
      expect(provider.complete).toBeDefined();
      expect(typeof provider.chat).toBe('function');
      expect(typeof provider.complete).toBe('function');
    }
  });

  it('all providers should have initialize and shutdown methods', () => {
    const groq = createGroqProvider()!;
    const together = createTogetherProvider()!;
    const fireworks = createFireworksProvider()!;

    for (const provider of [groq, together, fireworks]) {
      expect(provider.initialize).toBeDefined();
      expect(provider.shutdown).toBeDefined();
    }
  });

  it('all providers should be type llm', () => {
    const groq = createGroqProvider()!;
    const together = createTogetherProvider()!;
    const fireworks = createFireworksProvider()!;

    for (const provider of [groq, together, fireworks]) {
      expect(provider.type).toBe('llm');
    }
  });
});
