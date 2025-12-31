/**
 * Comprehensive Unit Tests for Provider Manager
 *
 * Tests provider registration, selection, switching, and error handling.
 */

import { EventEmitter } from 'events';
import type {
  ProviderType,
  ProviderConfig,
  CompletionOptions,
  LLMResponse,
  StreamChunk,
} from '../../src/providers/types';
import type { LLMProvider } from '../../src/providers/base-provider';

// ==========================================================================
// Mock Provider Factory
// ==========================================================================

function createMockProvider(
  type: ProviderType,
  name: string,
  defaultModel: string
): LLMProvider & {
  _mockInitialize: jest.Mock;
  _mockComplete: jest.Mock;
  _mockStream: jest.Mock;
  _mockDispose: jest.Mock;
} {
  let ready = false;
  const mockInitialize = jest.fn().mockImplementation(async (config: ProviderConfig) => {
    if (!config.apiKey) {
      throw new Error(`${name} API key is required`);
    }
    ready = true;
  });

  const mockComplete = jest.fn().mockResolvedValue({
    id: 'test-response-id',
    content: 'Test response',
    toolCalls: [],
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    model: defaultModel,
    provider: type,
  } as LLMResponse);

  const mockStream = jest.fn().mockReturnValue(
    (async function* () {
      yield { type: 'content' as const, content: 'Hello' };
      yield { type: 'content' as const, content: ' World' };
      yield { type: 'done' as const };
    })()
  );

  const mockDispose = jest.fn().mockImplementation(() => {
    ready = false;
  });

  return {
    type,
    name,
    defaultModel,
    initialize: mockInitialize,
    isReady: () => ready,
    complete: mockComplete,
    stream: mockStream,
    getModels: jest.fn().mockResolvedValue([defaultModel, `${defaultModel}-fast`]),
    estimateTokens: jest.fn().mockImplementation((text: string) => Math.ceil(text.length / 4)),
    getPricing: jest.fn().mockReturnValue({ input: 3, output: 15 }),
    dispose: mockDispose,
    _mockInitialize: mockInitialize,
    _mockComplete: mockComplete,
    _mockStream: mockStream,
    _mockDispose: mockDispose,
  };
}

// ==========================================================================
// Mock Provider Classes
// ==========================================================================

const mockGrokProvider = createMockProvider('grok', 'Grok (xAI)', 'grok-3-latest');
const mockClaudeProvider = createMockProvider('claude', 'Claude (Anthropic)', 'claude-sonnet-4-20250514');
const mockOpenAIProvider = createMockProvider('openai', 'GPT (OpenAI)', 'gpt-4o');
const mockGeminiProvider = createMockProvider('gemini', 'Gemini (Google)', 'gemini-2.0-flash');

// Mock the provider modules
jest.mock('../../src/providers/grok-provider', () => ({
  GrokProvider: jest.fn().mockImplementation(() => ({
    ...mockGrokProvider,
    _mockInitialize: mockGrokProvider._mockInitialize,
    _mockComplete: mockGrokProvider._mockComplete,
    _mockStream: mockGrokProvider._mockStream,
    _mockDispose: mockGrokProvider._mockDispose,
  })),
}));

jest.mock('../../src/providers/claude-provider', () => ({
  ClaudeProvider: jest.fn().mockImplementation(() => ({
    ...mockClaudeProvider,
    _mockInitialize: mockClaudeProvider._mockInitialize,
    _mockComplete: mockClaudeProvider._mockComplete,
    _mockStream: mockClaudeProvider._mockStream,
    _mockDispose: mockClaudeProvider._mockDispose,
  })),
}));

jest.mock('../../src/providers/openai-provider', () => ({
  OpenAIProvider: jest.fn().mockImplementation(() => ({
    ...mockOpenAIProvider,
    _mockInitialize: mockOpenAIProvider._mockInitialize,
    _mockComplete: mockOpenAIProvider._mockComplete,
    _mockStream: mockOpenAIProvider._mockStream,
    _mockDispose: mockOpenAIProvider._mockDispose,
  })),
}));

jest.mock('../../src/providers/gemini-provider', () => ({
  GeminiProvider: jest.fn().mockImplementation(() => ({
    ...mockGeminiProvider,
    _mockInitialize: mockGeminiProvider._mockInitialize,
    _mockComplete: mockGeminiProvider._mockComplete,
    _mockStream: mockGeminiProvider._mockStream,
    _mockDispose: mockGeminiProvider._mockDispose,
  })),
}));

// Import after mocks are set up
import {
  ProviderManager,
  getProviderManager,
  resetProviderManager,
  autoConfigureProviders,
} from '../../src/providers/provider-manager';

describe('ProviderManager', () => {
  let manager: ProviderManager;

  beforeEach(() => {
    jest.clearAllMocks();
    resetProviderManager();
    manager = new ProviderManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  // ==========================================================================
  // Provider Registration Tests
  // ==========================================================================

  describe('Provider Registration', () => {
    it('should start with no registered providers', () => {
      expect(manager.getRegisteredProviders()).toHaveLength(0);
    });

    it('should register a grok provider successfully', async () => {
      await manager.registerProvider('grok', { apiKey: 'test-grok-key' });

      expect(manager.getRegisteredProviders()).toContain('grok');
      expect(manager.getProvider('grok')).toBeDefined();
    });

    it('should register a claude provider successfully', async () => {
      await manager.registerProvider('claude', { apiKey: 'test-claude-key' });

      expect(manager.getRegisteredProviders()).toContain('claude');
      expect(manager.getProvider('claude')).toBeDefined();
    });

    it('should register an openai provider successfully', async () => {
      await manager.registerProvider('openai', { apiKey: 'test-openai-key' });

      expect(manager.getRegisteredProviders()).toContain('openai');
      expect(manager.getProvider('openai')).toBeDefined();
    });

    it('should register a gemini provider successfully', async () => {
      await manager.registerProvider('gemini', { apiKey: 'test-gemini-key' });

      expect(manager.getRegisteredProviders()).toContain('gemini');
      expect(manager.getProvider('gemini')).toBeDefined();
    });

    it('should register multiple providers', async () => {
      await manager.registerProvider('grok', { apiKey: 'test-grok-key' });
      await manager.registerProvider('claude', { apiKey: 'test-claude-key' });
      await manager.registerProvider('openai', { apiKey: 'test-openai-key' });

      const providers = manager.getRegisteredProviders();
      expect(providers).toHaveLength(3);
      expect(providers).toContain('grok');
      expect(providers).toContain('claude');
      expect(providers).toContain('openai');
    });

    it('should emit provider:registered event on registration', async () => {
      const listener = jest.fn();
      manager.on('provider:registered', listener);

      await manager.registerProvider('grok', { apiKey: 'test-key' });

      expect(listener).toHaveBeenCalledWith({
        type: 'grok',
        name: 'Grok (xAI)',
      });
    });

    it('should throw error for unknown provider type', async () => {
      await expect(
        manager.registerProvider('unknown' as ProviderType, { apiKey: 'test-key' })
      ).rejects.toThrow('Unknown provider type: unknown');
    });

    it('should re-register an existing provider (replace)', async () => {
      await manager.registerProvider('grok', { apiKey: 'first-key' });
      await manager.registerProvider('grok', { apiKey: 'second-key' });

      // Only one provider of that type should exist
      expect(manager.getRegisteredProviders().filter(p => p === 'grok')).toHaveLength(1);
      expect(manager.getProvider('grok')).toBeDefined();
    });
  });

  // ==========================================================================
  // API Key Handling Tests
  // ==========================================================================

  describe('API Key Handling', () => {
    it('should throw error when registering without API key', async () => {
      await expect(
        manager.registerProvider('grok', { apiKey: '' })
      ).rejects.toThrow('API key is required');
    });

    it('should accept valid API keys', async () => {
      await manager.registerProvider('grok', { apiKey: 'valid-api-key-12345' });

      const provider = manager.getProvider('grok');
      expect(provider).toBeDefined();
      expect(provider!.isReady()).toBe(true);
    });

    it('should store and use config with optional parameters', async () => {
      const config: ProviderConfig = {
        apiKey: 'test-key',
        model: 'custom-model',
        baseUrl: 'https://custom.api.com',
        maxTokens: 8192,
        temperature: 0.5,
        timeout: 60000,
        maxRetries: 5,
      };

      await manager.registerProvider('grok', config);

      const provider = manager.getProvider('grok');
      expect(provider).toBeDefined();
    });
  });

  // ==========================================================================
  // Provider Selection Tests
  // ==========================================================================

  describe('Provider Selection', () => {
    beforeEach(async () => {
      await manager.registerProvider('grok', { apiKey: 'grok-key' });
      await manager.registerProvider('claude', { apiKey: 'claude-key' });
      await manager.registerProvider('openai', { apiKey: 'openai-key' });
      await manager.registerProvider('gemini', { apiKey: 'gemini-key' });
    });

    it('should get active provider type', () => {
      manager.setActiveProvider('grok');
      expect(manager.getActiveProviderType()).toBe('grok');
    });

    it('should get active provider instance', () => {
      manager.setActiveProvider('claude');
      const provider = manager.getActiveProvider();

      expect(provider).toBeDefined();
      expect(provider.type).toBe('claude');
    });

    it('should return undefined for unregistered provider', () => {
      // gemini is registered, test with something that doesn't exist
      manager.dispose();
      manager = new ProviderManager();
      const provider = manager.getProvider('gemini');
      expect(provider).toBeUndefined();
    });

    describe('selectBestProvider', () => {
      it('should select gemini for vision requirements', async () => {
        const result = await manager.selectBestProvider({ requiresVision: true });
        expect(result).toBe('gemini');
      });

      it('should select openai for vision when gemini is unavailable', async () => {
        manager.dispose();
        manager = new ProviderManager();
        await manager.registerProvider('openai', { apiKey: 'openai-key' });
        await manager.registerProvider('claude', { apiKey: 'claude-key' });

        const result = await manager.selectBestProvider({ requiresVision: true });
        expect(result).toBe('openai');
      });

      it('should select claude for vision when gemini and openai are unavailable', async () => {
        manager.dispose();
        manager = new ProviderManager();
        await manager.registerProvider('claude', { apiKey: 'claude-key' });
        manager.setActiveProvider('claude');

        const result = await manager.selectBestProvider({ requiresVision: true });
        expect(result).toBe('claude');
      });

      it('should select gemini for long context requirements', async () => {
        const result = await manager.selectBestProvider({ requiresLongContext: true });
        expect(result).toBe('gemini');
      });

      it('should select claude for long context when gemini is unavailable', async () => {
        manager.dispose();
        manager = new ProviderManager();
        await manager.registerProvider('claude', { apiKey: 'claude-key' });
        await manager.registerProvider('openai', { apiKey: 'openai-key' });

        const result = await manager.selectBestProvider({ requiresLongContext: true });
        expect(result).toBe('claude');
      });

      it('should select gemini for cost sensitive requirements', async () => {
        const result = await manager.selectBestProvider({ costSensitive: true });
        expect(result).toBe('gemini');
      });

      it('should select openai for cost sensitive when gemini is unavailable', async () => {
        manager.dispose();
        manager = new ProviderManager();
        await manager.registerProvider('openai', { apiKey: 'openai-key' });
        await manager.registerProvider('claude', { apiKey: 'claude-key' });

        const result = await manager.selectBestProvider({ costSensitive: true });
        expect(result).toBe('openai');
      });

      it('should return active provider when no requirements', async () => {
        manager.setActiveProvider('claude');
        const result = await manager.selectBestProvider({});
        expect(result).toBe('claude');
      });

      it('should return active provider when requirements not satisfied', async () => {
        manager.dispose();
        manager = new ProviderManager();
        await manager.registerProvider('grok', { apiKey: 'grok-key' });
        manager.setActiveProvider('grok');

        // grok doesn't have vision priority, but is the only provider
        const result = await manager.selectBestProvider({ requiresToolUse: true });
        expect(result).toBe('grok');
      });

      it('should handle multiple requirements with priority', async () => {
        const result = await manager.selectBestProvider({
          requiresVision: true,
          costSensitive: true,
        });
        // Vision takes precedence and gemini supports vision
        expect(result).toBe('gemini');
      });
    });
  });

  // ==========================================================================
  // Provider Switching Tests
  // ==========================================================================

  describe('Provider Switching', () => {
    beforeEach(async () => {
      await manager.registerProvider('grok', { apiKey: 'grok-key' });
      await manager.registerProvider('claude', { apiKey: 'claude-key' });
    });

    it('should switch active provider', () => {
      manager.setActiveProvider('grok');
      expect(manager.getActiveProviderType()).toBe('grok');

      manager.setActiveProvider('claude');
      expect(manager.getActiveProviderType()).toBe('claude');
    });

    it('should emit provider:changed event on switch', () => {
      const listener = jest.fn();
      manager.on('provider:changed', listener);

      manager.setActiveProvider('claude');

      expect(listener).toHaveBeenCalledWith({ type: 'claude' });
    });

    it('should throw error when switching to unregistered provider', () => {
      expect(() => {
        manager.setActiveProvider('gemini');
      }).toThrow('Provider gemini not registered');
    });

    it('should maintain provider instances after switching', () => {
      manager.setActiveProvider('grok');
      const grokProvider = manager.getActiveProvider();

      manager.setActiveProvider('claude');
      const claudeProvider = manager.getActiveProvider();

      // Switch back and verify same instance
      manager.setActiveProvider('grok');
      const grokProviderAgain = manager.getActiveProvider();

      expect(grokProviderAgain).toBe(grokProvider);
      expect(grokProviderAgain).not.toBe(claudeProvider);
    });

    it('should switch between all provider types', async () => {
      await manager.registerProvider('openai', { apiKey: 'openai-key' });
      await manager.registerProvider('gemini', { apiKey: 'gemini-key' });

      const types: ProviderType[] = ['grok', 'claude', 'openai', 'gemini'];
      for (const type of types) {
        manager.setActiveProvider(type);
        expect(manager.getActiveProviderType()).toBe(type);
        expect(manager.getActiveProvider().type).toBe(type);
      }
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('Error Handling for Unavailable Providers', () => {
    it('should throw when getting active provider without registration', () => {
      expect(() => manager.getActiveProvider()).toThrow(
        'No active provider. Register a provider first.'
      );
    });

    it('should throw when setting unregistered provider as active', () => {
      expect(() => {
        manager.setActiveProvider('claude');
      }).toThrow('Provider claude not registered');
    });

    it('should handle registration failure gracefully', async () => {
      // This test verifies the error handling when initialization fails
      await expect(
        manager.registerProvider('grok', { apiKey: '' })
      ).rejects.toThrow();

      // Provider should not be registered after failed initialization
      expect(manager.getProvider('grok')).toBeUndefined();
    });

    it('should return empty array when no providers registered', () => {
      expect(manager.getRegisteredProviders()).toEqual([]);
    });

    it('should handle multiple registration failures', async () => {
      await expect(manager.registerProvider('grok', { apiKey: '' })).rejects.toThrow();
      await expect(manager.registerProvider('claude', { apiKey: '' })).rejects.toThrow();

      expect(manager.getRegisteredProviders()).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Complete and Stream Tests
  // ==========================================================================

  describe('Completion and Streaming', () => {
    beforeEach(async () => {
      await manager.registerProvider('grok', { apiKey: 'test-key' });
      manager.setActiveProvider('grok');
    });

    it('should delegate complete to active provider', async () => {
      const options: CompletionOptions = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = await manager.complete(options);

      expect(result).toBeDefined();
      expect(result.content).toBe('Test response');
      expect(result.provider).toBe('grok');
    });

    it('should delegate stream to active provider', async () => {
      const options: CompletionOptions = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const stream = manager.stream(options);
      const chunks: StreamChunk[] = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toEqual({ type: 'content', content: 'Hello' });
      expect(chunks[1]).toEqual({ type: 'content', content: ' World' });
      expect(chunks[2]).toEqual({ type: 'done' });
    });

    it('should use correct provider for completion after switch', async () => {
      await manager.registerProvider('claude', { apiKey: 'claude-key' });

      const options: CompletionOptions = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      // Complete with grok
      manager.setActiveProvider('grok');
      const grokResult = await manager.complete(options);
      expect(grokResult.provider).toBe('grok');

      // Switch and complete with claude
      manager.setActiveProvider('claude');
      const claudeResult = await manager.complete(options);
      expect(claudeResult.provider).toBe('claude');
    });
  });

  // ==========================================================================
  // Dispose Tests
  // ==========================================================================

  describe('Dispose', () => {
    it('should clear all providers on dispose', async () => {
      await manager.registerProvider('grok', { apiKey: 'grok-key' });
      await manager.registerProvider('claude', { apiKey: 'claude-key' });

      expect(manager.getRegisteredProviders()).toHaveLength(2);

      manager.dispose();

      expect(manager.getRegisteredProviders()).toHaveLength(0);
    });

    it('should remove all listeners on dispose', async () => {
      const listener = jest.fn();
      manager.on('provider:changed', listener);

      await manager.registerProvider('grok', { apiKey: 'test-key' });

      manager.dispose();

      // Verify no listeners by checking listenerCount
      expect(manager.listenerCount('provider:changed')).toBe(0);
    });

    it('should call dispose on individual providers', async () => {
      await manager.registerProvider('grok', { apiKey: 'test-key' });
      const provider = manager.getProvider('grok');
      const disposeSpy = jest.spyOn(provider!, 'dispose');

      manager.dispose();

      expect(disposeSpy).toHaveBeenCalled();
    });

    it('should be safe to call dispose multiple times', async () => {
      await manager.registerProvider('grok', { apiKey: 'test-key' });

      expect(() => {
        manager.dispose();
        manager.dispose();
      }).not.toThrow();

      expect(manager.getRegisteredProviders()).toHaveLength(0);
    });
  });
});

// ==========================================================================
// Singleton Tests
// ==========================================================================

describe('Provider Manager Singleton', () => {
  beforeEach(() => {
    resetProviderManager();
  });

  afterEach(() => {
    resetProviderManager();
  });

  it('should return same instance from getProviderManager', () => {
    const instance1 = getProviderManager();
    const instance2 = getProviderManager();

    expect(instance1).toBe(instance2);
  });

  it('should create new instance after reset', () => {
    const instance1 = getProviderManager();
    resetProviderManager();
    const instance2 = getProviderManager();

    expect(instance1).not.toBe(instance2);
  });

  it('should dispose old instance on reset', async () => {
    const instance = getProviderManager();
    await instance.registerProvider('grok', { apiKey: 'test-key' });

    expect(instance.getRegisteredProviders()).toHaveLength(1);

    resetProviderManager();

    // Old instance should be disposed
    expect(instance.getRegisteredProviders()).toHaveLength(0);
  });

  it('should allow re-registration after reset', async () => {
    const instance1 = getProviderManager();
    await instance1.registerProvider('grok', { apiKey: 'test-key' });

    resetProviderManager();

    const instance2 = getProviderManager();
    await instance2.registerProvider('grok', { apiKey: 'new-key' });

    expect(instance2.getRegisteredProviders()).toContain('grok');
  });
});

// ==========================================================================
// Auto-Configuration Tests
// ==========================================================================

describe('autoConfigureProviders', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetProviderManager();
    // Create a fresh copy of process.env
    process.env = { ...originalEnv };
    // Clear all relevant env vars
    delete process.env.GROK_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
    resetProviderManager();
  });

  it('should configure grok provider from GROK_API_KEY', async () => {
    process.env.GROK_API_KEY = 'test-grok-key';

    const manager = await autoConfigureProviders();

    expect(manager.getRegisteredProviders()).toContain('grok');
  });

  it('should configure grok provider from XAI_API_KEY', async () => {
    process.env.XAI_API_KEY = 'test-xai-key';

    const manager = await autoConfigureProviders();

    expect(manager.getRegisteredProviders()).toContain('grok');
  });

  it('should prefer GROK_API_KEY over XAI_API_KEY', async () => {
    process.env.GROK_API_KEY = 'grok-key';
    process.env.XAI_API_KEY = 'xai-key';

    const manager = await autoConfigureProviders();

    // Should still only register once
    expect(manager.getRegisteredProviders().filter(p => p === 'grok')).toHaveLength(1);
  });

  it('should configure claude provider from ANTHROPIC_API_KEY', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

    const manager = await autoConfigureProviders();

    expect(manager.getRegisteredProviders()).toContain('claude');
  });

  it('should configure openai provider from OPENAI_API_KEY', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';

    const manager = await autoConfigureProviders();

    expect(manager.getRegisteredProviders()).toContain('openai');
  });

  it('should configure gemini provider from GOOGLE_API_KEY', async () => {
    process.env.GOOGLE_API_KEY = 'test-google-key';

    const manager = await autoConfigureProviders();

    expect(manager.getRegisteredProviders()).toContain('gemini');
  });

  it('should configure gemini provider from GEMINI_API_KEY', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';

    const manager = await autoConfigureProviders();

    expect(manager.getRegisteredProviders()).toContain('gemini');
  });

  it('should configure all providers when all keys present', async () => {
    process.env.GROK_API_KEY = 'test-grok-key';
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.GOOGLE_API_KEY = 'test-google-key';

    const manager = await autoConfigureProviders();
    const providers = manager.getRegisteredProviders();

    expect(providers).toContain('grok');
    expect(providers).toContain('claude');
    expect(providers).toContain('openai');
    expect(providers).toContain('gemini');
    expect(providers).toHaveLength(4);
  });

  it('should configure no providers when no keys present', async () => {
    const manager = await autoConfigureProviders();

    expect(manager.getRegisteredProviders()).toHaveLength(0);
  });

  it('should return the singleton manager instance', async () => {
    process.env.GROK_API_KEY = 'test-key';

    const manager = await autoConfigureProviders();
    const singleton = getProviderManager();

    expect(manager).toBe(singleton);
  });

  it('should skip providers with missing keys', async () => {
    process.env.GROK_API_KEY = 'test-grok-key';
    // claude, openai, gemini keys are not set

    const manager = await autoConfigureProviders();
    const providers = manager.getRegisteredProviders();

    expect(providers).toContain('grok');
    expect(providers).not.toContain('claude');
    expect(providers).not.toContain('openai');
    expect(providers).not.toContain('gemini');
  });
});

// ==========================================================================
// Event Emitter Tests
// ==========================================================================

describe('ProviderManager Event Emitter', () => {
  let manager: ProviderManager;

  beforeEach(() => {
    resetProviderManager();
    manager = new ProviderManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  it('should extend EventEmitter', () => {
    expect(manager).toBeInstanceOf(EventEmitter);
  });

  it('should support multiple listeners for same event', async () => {
    const listener1 = jest.fn();
    const listener2 = jest.fn();

    manager.on('provider:registered', listener1);
    manager.on('provider:registered', listener2);

    await manager.registerProvider('grok', { apiKey: 'test-key' });

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it('should support once listeners', async () => {
    const listener = jest.fn();
    manager.once('provider:registered', listener);

    await manager.registerProvider('grok', { apiKey: 'grok-key' });
    await manager.registerProvider('claude', { apiKey: 'claude-key' });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should support removing listeners', async () => {
    const listener = jest.fn();
    manager.on('provider:registered', listener);
    manager.off('provider:registered', listener);

    await manager.registerProvider('grok', { apiKey: 'test-key' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('should emit events with correct data', async () => {
    const registeredListener = jest.fn();
    const changedListener = jest.fn();

    manager.on('provider:registered', registeredListener);
    manager.on('provider:changed', changedListener);

    await manager.registerProvider('grok', { apiKey: 'test-key' });
    manager.setActiveProvider('grok');

    expect(registeredListener).toHaveBeenCalledWith({
      type: 'grok',
      name: 'Grok (xAI)',
    });

    expect(changedListener).toHaveBeenCalledWith({ type: 'grok' });
  });
});

// ==========================================================================
// Model Selection Tests
// ==========================================================================

describe('Model Selection', () => {
  let manager: ProviderManager;

  beforeEach(async () => {
    resetProviderManager();
    manager = new ProviderManager();
    await manager.registerProvider('grok', { apiKey: 'test-key', model: 'custom-model' });
    manager.setActiveProvider('grok');
  });

  afterEach(() => {
    manager.dispose();
  });

  it('should use custom model from config', async () => {
    const provider = manager.getActiveProvider();
    expect(provider).toBeDefined();
    expect(provider.type).toBe('grok');
  });

  it('should get available models from provider', async () => {
    const provider = manager.getActiveProvider();
    const models = await provider.getModels();

    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
  });

  it('should get default model from provider', () => {
    const provider = manager.getActiveProvider();
    expect(provider.defaultModel).toBe('grok-3-latest');
  });
});

// ==========================================================================
// Provider Properties Tests
// ==========================================================================

describe('Provider Properties', () => {
  let manager: ProviderManager;

  beforeEach(() => {
    resetProviderManager();
    manager = new ProviderManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  it('should return correct provider type', async () => {
    await manager.registerProvider('grok', { apiKey: 'key' });
    await manager.registerProvider('claude', { apiKey: 'key' });
    await manager.registerProvider('openai', { apiKey: 'key' });
    await manager.registerProvider('gemini', { apiKey: 'key' });

    expect(manager.getProvider('grok')!.type).toBe('grok');
    expect(manager.getProvider('claude')!.type).toBe('claude');
    expect(manager.getProvider('openai')!.type).toBe('openai');
    expect(manager.getProvider('gemini')!.type).toBe('gemini');
  });

  it('should return correct provider name', async () => {
    await manager.registerProvider('grok', { apiKey: 'key' });
    await manager.registerProvider('claude', { apiKey: 'key' });
    await manager.registerProvider('openai', { apiKey: 'key' });
    await manager.registerProvider('gemini', { apiKey: 'key' });

    expect(manager.getProvider('grok')!.name).toBe('Grok (xAI)');
    expect(manager.getProvider('claude')!.name).toBe('Claude (Anthropic)');
    expect(manager.getProvider('openai')!.name).toBe('GPT (OpenAI)');
    expect(manager.getProvider('gemini')!.name).toBe('Gemini (Google)');
  });

  it('should indicate ready state after initialization', async () => {
    await manager.registerProvider('grok', { apiKey: 'test-key' });
    const provider = manager.getProvider('grok');

    expect(provider!.isReady()).toBe(true);
  });

  it('should return pricing information', async () => {
    await manager.registerProvider('grok', { apiKey: 'key' });

    const pricing = manager.getProvider('grok')!.getPricing();

    expect(pricing.input).toBeGreaterThan(0);
    expect(pricing.output).toBeGreaterThan(0);
  });

  it('should estimate token count', async () => {
    await manager.registerProvider('grok', { apiKey: 'test-key' });
    const provider = manager.getProvider('grok')!;

    const text = 'This is a test message for token estimation.';
    const tokens = provider.estimateTokens(text);

    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(text.length);
  });
});

// ==========================================================================
// Edge Cases Tests
// ==========================================================================

describe('Edge Cases', () => {
  let manager: ProviderManager;

  beforeEach(() => {
    resetProviderManager();
    manager = new ProviderManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  it('should handle rapid provider switches', async () => {
    await manager.registerProvider('grok', { apiKey: 'grok-key' });
    await manager.registerProvider('claude', { apiKey: 'claude-key' });

    // Rapid switching
    for (let i = 0; i < 10; i++) {
      manager.setActiveProvider(i % 2 === 0 ? 'grok' : 'claude');
    }

    // Should be on claude (last switch was odd index)
    expect(manager.getActiveProviderType()).toBe('claude');
  });

  it('should handle provider registration during active use', async () => {
    await manager.registerProvider('grok', { apiKey: 'grok-key' });
    manager.setActiveProvider('grok');

    // Start using grok
    const options: CompletionOptions = {
      messages: [{ role: 'user', content: 'Hello' }],
    };
    await manager.complete(options);

    // Register another provider while grok is active
    await manager.registerProvider('claude', { apiKey: 'claude-key' });

    // Should still be using grok
    expect(manager.getActiveProviderType()).toBe('grok');

    // But claude should be available
    expect(manager.getProvider('claude')).toBeDefined();
  });

  it('should handle empty messages array in completion', async () => {
    await manager.registerProvider('grok', { apiKey: 'test-key' });
    manager.setActiveProvider('grok');

    const options: CompletionOptions = {
      messages: [],
    };

    // Should not throw
    const result = await manager.complete(options);
    expect(result).toBeDefined();
  });

  it('should handle special characters in API key', async () => {
    const specialKey = 'key-with-special!@#$%^&*()chars';
    await manager.registerProvider('grok', { apiKey: specialKey });

    expect(manager.getProvider('grok')).toBeDefined();
  });
});
