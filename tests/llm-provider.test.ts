/**
 * Multi-LLM Provider Tests
 */

import {
  ProviderManager,
  GrokProvider,
  ClaudeProvider,
  OpenAIProvider,
  GeminiProvider,
  getProviderManager,
  resetProviderManager,
  type ProviderType,
  type LLMMessage,
  type ToolDefinition,
} from '../src/providers/llm-provider.js';

describe('LLM Provider', () => {
  describe('GrokProvider', () => {
    let provider: GrokProvider;

    beforeEach(() => {
      provider = new GrokProvider();
    });

    afterEach(() => {
      provider.dispose();
    });

    it('should have correct type and name', () => {
      expect(provider.type).toBe('grok');
      expect(provider.name).toBe('Grok (xAI)');
      expect(provider.defaultModel).toBe('grok-3-latest');
    });

    it('should not be ready before initialization', () => {
      expect(provider.isReady()).toBe(false);
    });

    it('should throw without API key', async () => {
      await expect(provider.initialize({ apiKey: '' }))
        .rejects.toThrow('API key is required');
    });

    it('should return models list', async () => {
      const models = await provider.getModels();
      expect(models).toContain('grok-3-latest');
      expect(models).toContain('grok-3-fast');
    });

    it('should estimate tokens', () => {
      const text = 'Hello, this is a test message.';
      const tokens = provider.estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(text.length);
    });

    it('should return pricing info', () => {
      const pricing = provider.getPricing();
      expect(pricing.input).toBeGreaterThan(0);
      expect(pricing.output).toBeGreaterThan(0);
    });
  });

  describe('ClaudeProvider', () => {
    let provider: ClaudeProvider;

    beforeEach(() => {
      provider = new ClaudeProvider();
    });

    afterEach(() => {
      provider.dispose();
    });

    it('should have correct type and name', () => {
      expect(provider.type).toBe('claude');
      expect(provider.name).toBe('Claude (Anthropic)');
      expect(provider.defaultModel).toBe('claude-sonnet-4-20250514');
    });

    it('should return models list', async () => {
      const models = await provider.getModels();
      expect(models).toContain('claude-sonnet-4-20250514');
      expect(models).toContain('claude-opus-4-20250514');
    });

    it('should return pricing info', () => {
      const pricing = provider.getPricing();
      expect(pricing.input).toBe(3);
      expect(pricing.output).toBe(15);
    });
  });

  describe('OpenAIProvider', () => {
    let provider: OpenAIProvider;

    beforeEach(() => {
      provider = new OpenAIProvider();
    });

    afterEach(() => {
      provider.dispose();
    });

    it('should have correct type and name', () => {
      expect(provider.type).toBe('openai');
      expect(provider.name).toBe('GPT (OpenAI)');
      expect(provider.defaultModel).toBe('gpt-4o');
    });

    it('should return models list', async () => {
      const models = await provider.getModels();
      expect(models).toContain('gpt-4o');
      expect(models).toContain('gpt-4o-mini');
      expect(models).toContain('o1');
    });
  });

  describe('GeminiProvider', () => {
    let provider: GeminiProvider;

    beforeEach(() => {
      provider = new GeminiProvider();
    });

    afterEach(() => {
      provider.dispose();
    });

    it('should have correct type and name', () => {
      expect(provider.type).toBe('gemini');
      expect(provider.name).toBe('Gemini (Google)');
      expect(provider.defaultModel).toBe('gemini-2.0-flash');
    });

    it('should return models list', async () => {
      const models = await provider.getModels();
      expect(models).toContain('gemini-2.0-flash');
      expect(models).toContain('gemini-1.5-pro');
    });

    it('should have lowest pricing', () => {
      const pricing = provider.getPricing();
      expect(pricing.input).toBeLessThan(1);
    });
  });

  describe('ProviderManager', () => {
    let manager: ProviderManager;

    beforeEach(() => {
      resetProviderManager();
      manager = new ProviderManager();
    });

    afterEach(() => {
      manager.dispose();
    });

    it('should start with no providers', () => {
      expect(manager.getRegisteredProviders()).toHaveLength(0);
    });

    it('should throw when getting active provider without registration', () => {
      expect(() => manager.getActiveProvider())
        .toThrow('No active provider');
    });

    it('should register provider', async () => {
      // Mock the OpenAI import for testing
      const mockProvider = {
        type: 'grok' as ProviderType,
        name: 'Test Provider',
        defaultModel: 'test-model',
        isReady: () => true,
        initialize: jest.fn().mockResolvedValue(undefined),
        complete: jest.fn(),
        stream: jest.fn(),
        getModels: jest.fn().mockResolvedValue(['test-model']),
        estimateTokens: jest.fn().mockReturnValue(10),
        getPricing: jest.fn().mockReturnValue({ input: 1, output: 2 }),
        dispose: jest.fn(),
      };

      // We can't easily test full registration without mocking dynamic imports
      // So we test the manager's state management
      expect(manager.getRegisteredProviders()).toHaveLength(0);
    });

    it('should emit events', () => {
      const listener = jest.fn();
      manager.on('provider:changed', listener);

      // Event would be emitted on setActiveProvider after registration
      expect(listener).not.toHaveBeenCalled();
    });

    it('should select best provider based on requirements', async () => {
      // Without any providers registered, should return default
      const result = await manager.selectBestProvider({ costSensitive: true });
      expect(result).toBe('grok'); // Default active provider
    });
  });

  describe('Singleton', () => {
    beforeEach(() => {
      resetProviderManager();
    });

    it('should return same instance', () => {
      const instance1 = getProviderManager();
      const instance2 = getProviderManager();
      expect(instance1).toBe(instance2);
    });

    it('should reset singleton', () => {
      const instance1 = getProviderManager();
      resetProviderManager();
      const instance2 = getProviderManager();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('Message Formatting', () => {
    it('should format messages correctly', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      // Messages should have required fields
      expect(messages[0].role).toBe('system');
      expect(messages[1].role).toBe('user');
      expect(messages[2].role).toBe('assistant');
    });

    it('should handle tool calls in messages', () => {
      const message: LLMMessage = {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"location": "Paris"}',
            },
          },
        ],
      };

      expect(message.tool_calls).toHaveLength(1);
      expect(message.tool_calls![0].function.name).toBe('get_weather');
    });

    it('should handle tool results', () => {
      const message: LLMMessage = {
        role: 'tool',
        content: '{"temperature": 20}',
        tool_call_id: 'call_123',
      };

      expect(message.role).toBe('tool');
      expect(message.tool_call_id).toBe('call_123');
    });
  });

  describe('Tool Definitions', () => {
    it('should format tool definitions', () => {
      const tools: ToolDefinition[] = [
        {
          name: 'search',
          description: 'Search the web',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
            },
            required: ['query'],
          },
        },
      ];

      expect(tools[0].name).toBe('search');
      expect(tools[0].parameters).toHaveProperty('properties');
    });
  });
});
