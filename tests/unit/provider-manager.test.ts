/**
 * Provider Manager Tests
 *
 * Tests for the multi-LLM provider orchestration system:
 * - Provider registration and lifecycle
 * - Provider selection and routing
 * - Active provider management
 * - Event emission
 */

import { EventEmitter } from 'events';

// Mock providers - define before jest.mock() calls
const mockGrokProvider = {
  name: 'Grok',
  type: 'grok',
  initialize: jest.fn().mockResolvedValue(undefined),
  complete: jest.fn().mockResolvedValue({
    id: 'test-completion',
    content: 'Test response',
    toolCalls: [],
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    model: 'grok-2',
    provider: 'grok',
  }),
  stream: jest.fn().mockImplementation(async function* () {
    yield { type: 'content', content: 'Hello' };
    yield { type: 'done' };
  }),
  dispose: jest.fn(),
};

const mockClaudeProvider = {
  name: 'Claude',
  type: 'claude',
  initialize: jest.fn().mockResolvedValue(undefined),
  complete: jest.fn().mockResolvedValue({
    id: 'test-claude',
    content: 'Claude response',
    toolCalls: [],
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    model: 'claude-3-5-sonnet',
    provider: 'claude',
  }),
  stream: jest.fn().mockImplementation(async function* () {
    yield { type: 'content', content: 'Claude says' };
    yield { type: 'done' };
  }),
  dispose: jest.fn(),
};

const mockOpenAIProvider = {
  name: 'OpenAI',
  type: 'openai',
  initialize: jest.fn().mockResolvedValue(undefined),
  complete: jest.fn().mockResolvedValue({
    id: 'test-openai',
    content: 'OpenAI response',
    toolCalls: [],
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    model: 'gpt-4o',
    provider: 'openai',
  }),
  stream: jest.fn().mockImplementation(async function* () {
    yield { type: 'content', content: 'GPT says' };
    yield { type: 'done' };
  }),
  dispose: jest.fn(),
};

const mockGeminiProvider = {
  name: 'Gemini',
  type: 'gemini',
  initialize: jest.fn().mockResolvedValue(undefined),
  complete: jest.fn().mockResolvedValue({
    id: 'test-gemini',
    content: 'Gemini response',
    toolCalls: [],
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    model: 'gemini-2.0-flash',
    provider: 'gemini',
  }),
  stream: jest.fn().mockImplementation(async function* () {
    yield { type: 'content', content: 'Gemini says' };
    yield { type: 'done' };
  }),
  dispose: jest.fn(),
};

// Mock the provider modules - jest.mock is hoisted
jest.mock('../../src/providers/grok-provider.js', () => ({
  GrokProvider: jest.fn().mockImplementation(() => mockGrokProvider),
}));

jest.mock('../../src/providers/claude-provider.js', () => ({
  ClaudeProvider: jest.fn().mockImplementation(() => mockClaudeProvider),
}));

jest.mock('../../src/providers/openai-provider.js', () => ({
  OpenAIProvider: jest.fn().mockImplementation(() => mockOpenAIProvider),
}));

jest.mock('../../src/providers/gemini-provider.js', () => ({
  GeminiProvider: jest.fn().mockImplementation(() => mockGeminiProvider),
}));

// Import after mocks are set up
import {
  ProviderManager,
  getProviderManager,
  resetProviderManager,
  autoConfigureProviders,
} from '../../src/providers/provider-manager.js';

describe('ProviderManager', () => {
  let manager: ProviderManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new ProviderManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('Provider Registration', () => {
    it('should register a provider successfully', async () => {
      await manager.registerProvider('grok', { apiKey: 'test-key' });

      expect(manager.getRegisteredProviders()).toContain('grok');
    });

    it('should emit provider:registered event', async () => {
      const handler = jest.fn();
      manager.on('provider:registered', handler);

      await manager.registerProvider('grok', { apiKey: 'test-key' });

      expect(handler).toHaveBeenCalledWith({ type: 'grok', name: 'Grok' });
    });

    it('should register multiple providers', async () => {
      await manager.registerProvider('grok', { apiKey: 'grok-key' });
      await manager.registerProvider('claude', { apiKey: 'claude-key' });
      await manager.registerProvider('openai', { apiKey: 'openai-key' });

      const registered = manager.getRegisteredProviders();
      expect(registered).toHaveLength(3);
      expect(registered).toContain('grok');
      expect(registered).toContain('claude');
      expect(registered).toContain('openai');
    });

    it('should throw error for unknown provider type', async () => {
      await expect(
        manager.registerProvider('unknown' as any, { apiKey: 'test' })
      ).rejects.toThrow('Unknown provider type');
    });

    it('should re-register provider with new config', async () => {
      await manager.registerProvider('grok', { apiKey: 'old-key' });
      await manager.registerProvider('grok', { apiKey: 'new-key' });

      expect(manager.getRegisteredProviders()).toHaveLength(1);
    });
  });

  describe('Active Provider Management', () => {
    beforeEach(async () => {
      await manager.registerProvider('grok', { apiKey: 'grok-key' });
      await manager.registerProvider('claude', { apiKey: 'claude-key' });
    });

    it('should set active provider', () => {
      manager.setActiveProvider('claude');

      expect(manager.getActiveProviderType()).toBe('claude');
    });

    it('should emit provider:changed event', () => {
      const handler = jest.fn();
      manager.on('provider:changed', handler);

      manager.setActiveProvider('claude');

      expect(handler).toHaveBeenCalledWith({ type: 'claude' });
    });

    it('should throw error for unregistered provider', () => {
      expect(() => manager.setActiveProvider('openai')).toThrow(
        'Provider openai not registered'
      );
    });

    it('should get active provider instance', () => {
      const provider = manager.getActiveProvider();

      expect(provider).toBeDefined();
      expect(provider.name).toBe('Grok');
    });

    it('should throw error if no provider is active', () => {
      const emptyManager = new ProviderManager();

      expect(() => emptyManager.getActiveProvider()).toThrow(
        'No active provider'
      );

      emptyManager.dispose();
    });
  });

  describe('Provider Selection', () => {
    beforeEach(async () => {
      await manager.registerProvider('grok', { apiKey: 'grok-key' });
      await manager.registerProvider('claude', { apiKey: 'claude-key' });
      await manager.registerProvider('openai', { apiKey: 'openai-key' });
      await manager.registerProvider('gemini', { apiKey: 'gemini-key' });
    });

    it('should select gemini for vision requirements', async () => {
      const selected = await manager.selectBestProvider({ requiresVision: true });

      expect(selected).toBe('gemini');
    });

    it('should select openai for vision if gemini not available', async () => {
      const limitedManager = new ProviderManager();
      await limitedManager.registerProvider('openai', { apiKey: 'test' });
      await limitedManager.registerProvider('grok', { apiKey: 'test' });

      const selected = await limitedManager.selectBestProvider({ requiresVision: true });

      expect(selected).toBe('openai');
      limitedManager.dispose();
    });

    it('should select gemini for long context requirements', async () => {
      const selected = await manager.selectBestProvider({ requiresLongContext: true });

      expect(selected).toBe('gemini');
    });

    it('should select claude for long context if gemini not available', async () => {
      const limitedManager = new ProviderManager();
      await limitedManager.registerProvider('claude', { apiKey: 'test' });
      await limitedManager.registerProvider('grok', { apiKey: 'test' });

      const selected = await limitedManager.selectBestProvider({ requiresLongContext: true });

      expect(selected).toBe('claude');
      limitedManager.dispose();
    });

    it('should select gemini for cost-sensitive tasks', async () => {
      const selected = await manager.selectBestProvider({ costSensitive: true });

      expect(selected).toBe('gemini');
    });

    it('should fallback to active provider if no special requirements', async () => {
      manager.setActiveProvider('claude');

      const selected = await manager.selectBestProvider({});

      expect(selected).toBe('claude');
    });
  });

  describe('Completion and Streaming', () => {
    beforeEach(async () => {
      await manager.registerProvider('grok', { apiKey: 'test-key' });
    });

    it('should complete via active provider', async () => {
      const response = await manager.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response).toBeDefined();
      expect(response.content).toBe('Test response');
      expect(response.provider).toBe('grok');
    });

    it('should stream via active provider', async () => {
      const chunks: any[] = [];
      for await (const chunk of manager.stream({
        messages: [{ role: 'user', content: 'Hello' }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].type).toBe('content');
    });
  });

  describe('Provider Retrieval', () => {
    beforeEach(async () => {
      await manager.registerProvider('grok', { apiKey: 'test' });
      await manager.registerProvider('claude', { apiKey: 'test' });
    });

    it('should get provider by type', () => {
      const provider = manager.getProvider('claude');

      expect(provider).toBeDefined();
      expect(provider?.name).toBe('Claude');
    });

    it('should return undefined for unregistered provider', () => {
      const provider = manager.getProvider('openai');

      expect(provider).toBeUndefined();
    });
  });

  describe('Dispose', () => {
    it('should dispose all providers and clear state', async () => {
      await manager.registerProvider('grok', { apiKey: 'test' });
      await manager.registerProvider('claude', { apiKey: 'test' });

      manager.dispose();

      expect(manager.getRegisteredProviders()).toHaveLength(0);
    });

    it('should remove all event listeners', async () => {
      const handler = jest.fn();
      manager.on('provider:registered', handler);

      manager.dispose();

      expect(manager.listenerCount('provider:registered')).toBe(0);
    });
  });
});

describe('Singleton Management', () => {
  afterEach(() => {
    resetProviderManager();
  });

  it('should return same instance on multiple calls', () => {
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
});

describe('Auto-Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetProviderManager();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    resetProviderManager();
  });

  it('should configure grok from GROK_API_KEY', async () => {
    process.env.GROK_API_KEY = 'test-grok-key';

    const manager = await autoConfigureProviders();

    expect(manager.getRegisteredProviders()).toContain('grok');
  });

  it('should configure grok from XAI_API_KEY', async () => {
    process.env.XAI_API_KEY = 'test-xai-key';

    const manager = await autoConfigureProviders();

    expect(manager.getRegisteredProviders()).toContain('grok');
  });

  it('should configure claude from ANTHROPIC_API_KEY', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-claude-key';

    const manager = await autoConfigureProviders();

    expect(manager.getRegisteredProviders()).toContain('claude');
  });

  it('should configure openai from OPENAI_API_KEY', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';

    const manager = await autoConfigureProviders();

    expect(manager.getRegisteredProviders()).toContain('openai');
  });

  it('should configure gemini from GOOGLE_API_KEY', async () => {
    process.env.GOOGLE_API_KEY = 'test-google-key';

    const manager = await autoConfigureProviders();

    expect(manager.getRegisteredProviders()).toContain('gemini');
  });

  it('should configure multiple providers from environment', async () => {
    process.env.GROK_API_KEY = 'test-grok';
    process.env.ANTHROPIC_API_KEY = 'test-claude';
    process.env.OPENAI_API_KEY = 'test-openai';

    const manager = await autoConfigureProviders();

    const providers = manager.getRegisteredProviders();
    expect(providers).toContain('grok');
    expect(providers).toContain('claude');
    expect(providers).toContain('openai');
  });

  it('should return empty providers if no API keys set', async () => {
    // Clear all API keys
    delete process.env.GROK_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const manager = await autoConfigureProviders();

    expect(manager.getRegisteredProviders()).toHaveLength(0);
  });
});

describe('Event Emission', () => {
  let manager: ProviderManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new ProviderManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  it('should be an EventEmitter', () => {
    expect(manager).toBeInstanceOf(EventEmitter);
  });

  it('should emit events in correct order', async () => {
    const events: string[] = [];

    manager.on('provider:registered', () => events.push('registered'));
    manager.on('provider:changed', () => events.push('changed'));

    await manager.registerProvider('grok', { apiKey: 'test' });
    await manager.registerProvider('claude', { apiKey: 'test' });
    manager.setActiveProvider('claude');

    expect(events).toEqual(['registered', 'registered', 'changed']);
  });
});
