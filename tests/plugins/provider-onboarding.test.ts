import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runProviderOnboarding } from '../../src/plugins/provider-onboarding.js';
import { createOllamaProvider } from '../../src/plugins/bundled/ollama-provider.js';
import { createVllmProvider } from '../../src/plugins/bundled/vllm-provider.js';
import type { PluginProvider, DiscoveredModel, ProviderOnboardingHooks } from '../../src/plugins/types.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Provider Onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runProviderOnboarding', () => {
    it('should return success when no onboarding hooks are defined', async () => {
      const provider: PluginProvider = {
        id: 'test-provider',
        name: 'Test',
        type: 'llm',
        async initialize() {},
      };

      const result = await runProviderOnboarding(provider);

      expect(result.success).toBe(true);
      expect(result.message).toContain('skipped');
    });

    it('should execute all 5 phases in order', async () => {
      const callOrder: string[] = [];

      const hooks: ProviderOnboardingHooks = {
        async auth() {
          callOrder.push('auth');
          return { valid: true };
        },
        async 'wizard.onboarding'() {
          callOrder.push('wizard.onboarding');
          return { success: true, config: { key: 'val' } };
        },
        async 'discovery.run'() {
          callOrder.push('discovery.run');
          return [
            { id: 'model-a', name: 'Model A', contextWindow: 4096 },
            { id: 'model-b', name: 'Model B', contextWindow: 8192 },
          ];
        },
        async 'wizard.modelPicker'(models: DiscoveredModel[]) {
          callOrder.push('wizard.modelPicker');
          return models[1].id;
        },
        async onModelSelected(modelId: string) {
          callOrder.push(`onModelSelected:${modelId}`);
        },
      };

      const provider: PluginProvider = {
        id: 'test-full',
        name: 'Test Full',
        type: 'llm',
        onboarding: hooks,
        async initialize() {},
      };

      const result = await runProviderOnboarding(provider);

      expect(result.success).toBe(true);
      expect(callOrder).toEqual([
        'auth',
        'wizard.onboarding',
        'discovery.run',
        'wizard.modelPicker',
        'onModelSelected:model-b',
      ]);
      expect(result.config).toEqual({
        key: 'val',
        selectedModel: 'model-b',
      });
    });

    it('should short-circuit on auth failure', async () => {
      const callOrder: string[] = [];

      const hooks: ProviderOnboardingHooks = {
        async auth() {
          callOrder.push('auth');
          return { valid: false, error: 'invalid key' };
        },
        async 'discovery.run'() {
          callOrder.push('discovery.run');
          return [];
        },
      };

      const provider: PluginProvider = {
        id: 'test-auth-fail',
        name: 'Test Auth Fail',
        type: 'llm',
        onboarding: hooks,
        async initialize() {},
      };

      const result = await runProviderOnboarding(provider);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Auth failed');
      expect(result.message).toContain('invalid key');
      expect(callOrder).toEqual(['auth']);
      // discovery.run should NOT have been called
    });

    it('should short-circuit when auth throws', async () => {
      const hooks: ProviderOnboardingHooks = {
        async auth() {
          throw new Error('network timeout');
        },
        async 'discovery.run'() {
          return [];
        },
      };

      const provider: PluginProvider = {
        id: 'test-auth-throw',
        name: 'Test Auth Throw',
        type: 'llm',
        onboarding: hooks,
        async initialize() {},
      };

      const result = await runProviderOnboarding(provider);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Auth error');
      expect(result.message).toContain('network timeout');
    });

    it('should skip undefined phases gracefully', async () => {
      // Only define discovery — auth, wizard, modelPicker, onModelSelected are all undefined
      const hooks: ProviderOnboardingHooks = {
        async 'discovery.run'() {
          return [
            { id: 'only-model', name: 'Only Model', contextWindow: 2048 },
          ];
        },
      };

      const provider: PluginProvider = {
        id: 'test-partial',
        name: 'Test Partial',
        type: 'llm',
        onboarding: hooks,
        async initialize() {},
      };

      const result = await runProviderOnboarding(provider);

      expect(result.success).toBe(true);
    });

    it('should fail when discovery returns no models', async () => {
      const callOrder: string[] = [];

      const hooks: ProviderOnboardingHooks = {
        async 'discovery.run'() {
          callOrder.push('discovery.run');
          return [];
        },
        async 'wizard.modelPicker'(models: DiscoveredModel[]) {
          callOrder.push('wizard.modelPicker');
          return models[0]?.id ?? '';
        },
      };

      const provider: PluginProvider = {
        id: 'test-no-models',
        name: 'Test No Models',
        type: 'llm',
        onboarding: hooks,
        async initialize() {},
      };

      const result = await runProviderOnboarding(provider);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Discovery returned no models');
      // modelPicker should not be called when models list is empty
      expect(callOrder).toEqual(['discovery.run']);
    });

    it('should handle discovery error gracefully', async () => {
      const hooks: ProviderOnboardingHooks = {
        async auth() {
          return { valid: true };
        },
        async 'discovery.run'() {
          throw new Error('connection refused');
        },
      };

      const provider: PluginProvider = {
        id: 'test-discovery-fail',
        name: 'Test Discovery Fail',
        type: 'llm',
        onboarding: hooks,
        async initialize() {},
      };

      const result = await runProviderOnboarding(provider);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Discovery error');
    });

    it('should skip onModelSelected when no model was picked', async () => {
      const callOrder: string[] = [];

      const hooks: ProviderOnboardingHooks = {
        async auth() {
          callOrder.push('auth');
          return { valid: true };
        },
        async onModelSelected(modelId: string) {
          callOrder.push(`onModelSelected:${modelId}`);
        },
      };

      const provider: PluginProvider = {
        id: 'test-no-picker',
        name: 'Test No Picker',
        type: 'llm',
        onboarding: hooks,
        async initialize() {},
      };

      const result = await runProviderOnboarding(provider);

      expect(result.success).toBe(true);
      // onModelSelected should not run because no model was selected
      expect(callOrder).toEqual(['auth']);
    });
  });

  describe('Ollama Provider', () => {
    const savedEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...savedEnv };
    });

    it('should return null when OLLAMA_HOST is not set', () => {
      delete process.env.OLLAMA_HOST;
      const provider = createOllamaProvider();
      expect(provider).toBeNull();
    });

    it('should create provider when OLLAMA_HOST is set', () => {
      process.env.OLLAMA_HOST = 'http://localhost:11434';
      const provider = createOllamaProvider();
      expect(provider).not.toBeNull();
      expect(provider!.id).toBe('bundled-ollama');
      expect(provider!.name).toBe('Ollama');
      expect(provider!.type).toBe('llm');
      expect(provider!.onboarding).toBeDefined();
    });

    it('should discover models from /api/tags', async () => {
      process.env.OLLAMA_HOST = 'http://localhost:11434';
      const provider = createOllamaProvider()!;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            {
              name: 'llama3:latest',
              details: {
                family: 'llama',
                parameter_size: '8B',
                quantization_level: 'Q4_0',
              },
            },
            {
              name: 'mistral:latest',
              details: {
                family: 'mistral',
                parameter_size: '7B',
              },
            },
          ],
        }),
      });

      const models = await provider.onboarding!['discovery.run']!();

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('llama3:latest');
      expect(models[0].name).toBe('llama3:latest');
      expect(models[0].contextWindow).toBe(8192); // llama3 known context
      expect(models[0].capabilities).toContain('llama');
      expect(models[0].capabilities).toContain('8B');
      expect(models[0].capabilities).toContain('Q4_0');

      expect(models[1].id).toBe('mistral:latest');
      expect(models[1].contextWindow).toBe(32768); // mistral known context
    });

    it('should validate auth by pinging Ollama', async () => {
      process.env.OLLAMA_HOST = 'http://localhost:11434';
      const provider = createOllamaProvider()!;

      // Successful auth
      mockFetch.mockResolvedValueOnce({ ok: true });
      const successResult = await provider.onboarding!.auth!();
      expect(successResult.valid).toBe(true);

      // Failed auth
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
      const failResult = await provider.onboarding!.auth!();
      expect(failResult.valid).toBe(false);
      expect(failResult.error).toContain('503');
    });

    it('should handle auth connection error', async () => {
      process.env.OLLAMA_HOST = 'http://localhost:11434';
      const provider = createOllamaProvider()!;

      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const result = await provider.onboarding!.auth!();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('should fall back to default context window for unknown models', async () => {
      process.env.OLLAMA_HOST = 'http://localhost:11434';
      const provider = createOllamaProvider()!;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            { name: 'custom-model:v1', details: {} },
          ],
        }),
      });

      const models = await provider.onboarding!['discovery.run']!();

      expect(models).toHaveLength(1);
      expect(models[0].contextWindow).toBe(4096); // default fallback
    });
  });

  describe('vLLM Provider', () => {
    const savedEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...savedEnv };
    });

    it('should return null when VLLM_BASE_URL is not set', () => {
      delete process.env.VLLM_BASE_URL;
      const provider = createVllmProvider();
      expect(provider).toBeNull();
    });

    it('should create provider when VLLM_BASE_URL is set', () => {
      process.env.VLLM_BASE_URL = 'http://localhost:8000';
      const provider = createVllmProvider();
      expect(provider).not.toBeNull();
      expect(provider!.id).toBe('bundled-vllm');
      expect(provider!.name).toBe('vLLM');
      expect(provider!.type).toBe('llm');
      expect(provider!.onboarding).toBeDefined();
    });

    it('should discover models via OpenAI /v1/models format', async () => {
      process.env.VLLM_BASE_URL = 'http://localhost:8000';
      const provider = createVllmProvider()!;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'meta-llama/Llama-3-70B-Instruct',
              object: 'model',
              owned_by: 'meta-llama',
              max_model_len: 8192,
            },
            {
              id: 'mistralai/Mistral-7B-v0.1',
              object: 'model',
              owned_by: 'mistralai',
            },
          ],
        }),
      });

      const models = await provider.onboarding!['discovery.run']!();

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('meta-llama/Llama-3-70B-Instruct');
      expect(models[0].contextWindow).toBe(8192); // from max_model_len
      expect(models[0].capabilities).toContain('meta-llama');
      expect(models[0].description).toContain('meta-llama');

      expect(models[1].id).toBe('mistralai/Mistral-7B-v0.1');
      expect(models[1].contextWindow).toBe(4096); // default when max_model_len absent
    });

    it('should validate auth by pinging /v1/models', async () => {
      process.env.VLLM_BASE_URL = 'http://localhost:8000';
      const provider = createVllmProvider()!;

      mockFetch.mockResolvedValueOnce({ ok: true });
      const successResult = await provider.onboarding!.auth!();
      expect(successResult.valid).toBe(true);

      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const failResult = await provider.onboarding!.auth!();
      expect(failResult.valid).toBe(false);
      expect(failResult.error).toContain('ECONNREFUSED');
    });

    it('should handle empty model list from vLLM', async () => {
      process.env.VLLM_BASE_URL = 'http://localhost:8000';
      const provider = createVllmProvider()!;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

      const models = await provider.onboarding!['discovery.run']!();
      expect(models).toHaveLength(0);
    });
  });
});
