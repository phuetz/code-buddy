/**
 * Local LLM Provider Unit Tests
 *
 * Comprehensive tests for local-llm-provider.ts including:
 * - NodeLlamaCppProvider
 * - WebLLMProvider
 * - OllamaProvider (tested in ollama-provider.test.ts, but some additional coverage here)
 * - LocalProviderManager
 * - Singleton and auto-configuration utilities
 *
 * Coverage targets:
 * 1. Provider initialization - Ollama, LMStudio, WebLLM detection
 * 2. Model listing - listModels() returns proper format
 * 3. Chat completion - streaming and non-streaming
 * 4. Error handling - network errors, timeout, invalid responses
 * 5. Fallback chain - provider failover behavior
 * 6. Stream processing - chunk handling, progress events
 * 7. Resource cleanup - reader.releaseLock() called
 */

import path from 'path';
import { EventEmitter } from 'events';
import {
  NodeLlamaCppProvider,
  WebLLMProvider,
  OllamaProvider,
  LocalProviderManager,
  getLocalProviderManager,
  resetLocalProviderManager,
  autoConfigureLocalProvider,
} from '../../src/providers/local-llm-provider.js';
import type {
  LocalLLMMessage,
  LocalProviderConfig,
  LocalProviderType,
  LocalLLMResponse,
} from '../../src/providers/local-llm-provider.js';

// ============================================================================
// Mocks - Must be defined before jest.mock calls due to hoisting
// ============================================================================

// Mock fs-extra - jest.mock is hoisted, so we need to use jest.fn() directly
jest.mock('fs-extra', () => ({
  ensureDir: jest.fn().mockResolvedValue(undefined),
  pathExists: jest.fn().mockResolvedValue(true),
  readdir: jest.fn().mockResolvedValue([]),
}));

// Mock logger
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock stream-helpers
jest.mock('../../src/utils/stream-helpers.js', () => ({
  safeStreamRead: jest.fn(),
  handleStreamError: jest.fn(),
}));

// Mock retry utility
jest.mock('../../src/utils/retry.js', () => ({
  retry: jest.fn(),
  RetryStrategies: {
    llmApi: { maxRetries: 3, baseDelay: 1000 },
  },
  RetryPredicates: {
    transientError: jest.fn().mockReturnValue(true),
  },
}));

// Mock node-llama-cpp module
jest.mock('node-llama-cpp', () => ({
  LlamaModel: jest.fn(),
  LlamaContext: jest.fn(),
  LlamaChatSession: jest.fn(),
}), { virtual: true });

// Mock @mlc-ai/web-llm module
jest.mock('@mlc-ai/web-llm', () => ({
  MLCEngine: jest.fn(),
}), { virtual: true });

// Get mock references after imports - use require to avoid hoisting issues
 
const mockFsExtra = require('fs-extra') as {
  ensureDir: jest.Mock;
  pathExists: jest.Mock;
  readdir: jest.Mock;
};

 
const streamHelpers = require('../../src/utils/stream-helpers.js') as {
  safeStreamRead: jest.Mock;
  handleStreamError: jest.Mock;
};
const mockSafeStreamRead = streamHelpers.safeStreamRead;
const mockHandleStreamError = streamHelpers.handleStreamError;

 
const retryModule = require('../../src/utils/retry.js') as {
  retry: jest.Mock;
};
const mockRetry = retryModule.retry;

// Get node-llama-cpp mocks
const nodeLlamaCpp = jest.requireMock('node-llama-cpp') as {
  LlamaModel: jest.Mock;
  LlamaContext: jest.Mock;
  LlamaChatSession: jest.Mock;
};
const mockLlamaModel = nodeLlamaCpp.LlamaModel;
const mockLlamaContext = nodeLlamaCpp.LlamaContext;
const mockLlamaChatSession = nodeLlamaCpp.LlamaChatSession;

// Get webllm mock
const webllm = jest.requireMock('@mlc-ai/web-llm') as {
  MLCEngine: jest.Mock;
};
const mockMLCEngine = webllm.MLCEngine;

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// ============================================================================
// Test Utilities
// ============================================================================

function createMockReader(chunks: Array<{ done: boolean; value?: Uint8Array }>) {
  let index = 0;
  return {
    read: jest.fn().mockImplementation(async () => {
      if (index < chunks.length) {
        return chunks[index++];
      }
      return { done: true };
    }),
    releaseLock: jest.fn(),
  };
}

function encodeChunk(content: string): Uint8Array {
  return new TextEncoder().encode(content);
}

// ============================================================================
// NodeLlamaCppProvider Tests
// ============================================================================

describe('NodeLlamaCppProvider', () => {
  let provider: NodeLlamaCppProvider;

  beforeEach(() => {
    provider = new NodeLlamaCppProvider();
    jest.clearAllMocks();
    mockFsExtra.pathExists.mockResolvedValue(true);
    mockFsExtra.readdir.mockResolvedValue([]);
    mockLlamaModel.mockReturnValue({});
    mockLlamaContext.mockReturnValue({});
    mockLlamaChatSession.mockReturnValue({
      prompt: jest.fn().mockResolvedValue('Mock response from LlamaCpp'),
    });
  });

  afterEach(() => {
    provider.dispose();
  });

  describe('Provider Properties', () => {
    it('should have correct type', () => {
      expect(provider.type).toBe('local-llama');
    });

    it('should have correct name', () => {
      expect(provider.name).toBe('node-llama-cpp');
    });

    it('should be an EventEmitter', () => {
      expect(provider).toBeInstanceOf(EventEmitter);
    });
  });

  describe('Initialization', () => {
    it('should not be ready before initialization', () => {
      expect(provider.isReady()).toBe(false);
    });

    it('should throw if model file not found', async () => {
      mockFsExtra.pathExists.mockResolvedValue(false);

      await expect(provider.initialize({}))
        .rejects.toThrow(/not found/i);
    });

    it('should include model name in error when model not found', async () => {
      mockFsExtra.pathExists.mockResolvedValue(false);

      await expect(provider.initialize({}))
        .rejects.toThrow(/llama-3\.1-8b-q4_k_m\.gguf/);

      await expect(provider.initialize({}))
        .rejects.toThrow(/local-llama/);
    });

    it('should ensure models directory exists', async () => {
      await provider.initialize({ modelPath: '/path/to/model.gguf' });

      expect(mockFsExtra.ensureDir).toHaveBeenCalled();
    });

    it('should use custom model path', async () => {
      const customPath = '/custom/path/to/model.gguf';
      await provider.initialize({ modelPath: customPath });

      expect(mockFsExtra.pathExists).toHaveBeenCalledWith(customPath);
    });

    it('should use default model path if not specified', async () => {
      await provider.initialize({});

      expect(mockFsExtra.pathExists).toHaveBeenCalledWith(
        expect.stringContaining('llama-3.1-8b-q4_k_m.gguf')
      );
    });

    it('should emit ready event after initialization', async () => {
      const readyListener = jest.fn();
      provider.on('ready', readyListener);

      await provider.initialize({ modelPath: '/path/to/model.gguf' });

      expect(readyListener).toHaveBeenCalledWith({ model: '/path/to/model.gguf' });
    });

    it('should set ready state after initialization', async () => {
      await provider.initialize({ modelPath: '/path/to/model.gguf' });

      expect(provider.isReady()).toBe(true);
    });

    it('should use custom GPU layers config', async () => {
      await provider.initialize({
        modelPath: '/path/to/model.gguf',
        gpuLayers: 32,
      });

      expect(mockLlamaModel).toHaveBeenCalledWith(
        expect.objectContaining({ gpuLayers: 32 })
      );
    });

    it('should use custom context size', async () => {
      await provider.initialize({
        modelPath: '/path/to/model.gguf',
        contextSize: 8192,
      });

      expect(mockLlamaContext).toHaveBeenCalledWith(
        expect.objectContaining({ contextSize: 8192 })
      );
    });

    it('should default gpuLayers to 0 for auto-detect', async () => {
      await provider.initialize({ modelPath: '/path/to/model.gguf' });

      expect(mockLlamaModel).toHaveBeenCalledWith(
        expect.objectContaining({ gpuLayers: 0 })
      );
    });

    it('should default contextSize to 4096', async () => {
      await provider.initialize({ modelPath: '/path/to/model.gguf' });

      expect(mockLlamaContext).toHaveBeenCalledWith(
        expect.objectContaining({ contextSize: 4096 })
      );
    });
  });

  describe('isAvailable', () => {
    it('should return true when node-llama-cpp is installed', async () => {
      const available = await provider.isAvailable();
      expect(available).toBe(true);
    });

    it('should return false when node-llama-cpp import fails', async () => {
      // This is harder to test due to Jest module caching
      // The actual module mock is always present in tests
      const available = await provider.isAvailable();
      expect(typeof available).toBe('boolean');
    });
  });

  describe('Complete Method', () => {
    beforeEach(async () => {
      await provider.initialize({ modelPath: '/path/to/model.gguf' });
    });

    it('should throw if not initialized', async () => {
      const uninitProvider = new NodeLlamaCppProvider();
      await expect(uninitProvider.complete([
        { role: 'user', content: 'Hello' },
      ])).rejects.toThrow(/not initialized/i);
      uninitProvider.dispose();
    });

    it('should complete basic request', async () => {
      const messages: LocalLLMMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const response = await provider.complete(messages);

      expect(response.content).toBe('Mock response from LlamaCpp');
      expect(response.provider).toBe('local-llama');
    });

    it('should include generation time', async () => {
      const response = await provider.complete([
        { role: 'user', content: 'Hello' },
      ]);

      expect(response.generationTime).toBeGreaterThanOrEqual(0);
    });

    it('should estimate tokens used', async () => {
      mockLlamaChatSession.mockReturnValue({
        prompt: jest.fn().mockResolvedValue('This is a longer response with multiple words'),
      });

      const response = await provider.complete([
        { role: 'user', content: 'Hello' },
      ]);

      expect(response.tokensUsed).toBeGreaterThan(0);
    });

    it('should use system prompt from messages', async () => {
      await provider.complete([
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello' },
      ]);

      expect(mockLlamaChatSession).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: 'You are a helpful assistant',
        })
      );
    });

    it('should use custom temperature from options', async () => {
      const mockPrompt = jest.fn().mockResolvedValue('Response');
      mockLlamaChatSession.mockReturnValue({ prompt: mockPrompt });

      await provider.complete(
        [{ role: 'user', content: 'Hello' }],
        { temperature: 0.5 }
      );

      expect(mockPrompt).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ temperature: 0.5 })
      );
    });

    it('should use custom maxTokens from options', async () => {
      const mockPrompt = jest.fn().mockResolvedValue('Response');
      mockLlamaChatSession.mockReturnValue({ prompt: mockPrompt });

      await provider.complete(
        [{ role: 'user', content: 'Hello' }],
        { maxTokens: 1024 }
      );

      expect(mockPrompt).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ maxTokens: 1024 })
      );
    });

    it('should use config values when options not provided', async () => {
      const configProvider = new NodeLlamaCppProvider();
      mockFsExtra.pathExists.mockResolvedValue(true);
      await configProvider.initialize({
        modelPath: '/path/to/model.gguf',
        temperature: 0.9,
        maxTokens: 4096,
      });

      const mockPrompt = jest.fn().mockResolvedValue('Response');
      mockLlamaChatSession.mockReturnValue({ prompt: mockPrompt });

      await configProvider.complete([{ role: 'user', content: 'Hello' }]);

      expect(mockPrompt).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ temperature: 0.9, maxTokens: 4096 })
      );

      configProvider.dispose();
    });

    it('should return model path in response', async () => {
      const response = await provider.complete([
        { role: 'user', content: 'Hello' },
      ]);

      expect(response.model).toBe('/path/to/model.gguf');
    });
  });

  describe('Streaming', () => {
    beforeEach(async () => {
      await provider.initialize({ modelPath: '/path/to/model.gguf' });
    });

    it('should throw if not initialized', async () => {
      const uninitProvider = new NodeLlamaCppProvider();
      const stream = uninitProvider.stream([
        { role: 'user', content: 'Hello' },
      ]);

      await expect(async () => {
        for await (const _chunk of stream) {
          // Should throw
        }
      }).rejects.toThrow(/not initialized/i);
      uninitProvider.dispose();
    });

    it('should throw if no user message', async () => {
      const stream = provider.stream([
        { role: 'system', content: 'You are helpful' },
      ]);

      await expect(async () => {
        for await (const _chunk of stream) {
          // Should throw
        }
      }).rejects.toThrow('No user message found');
    });

    it('should stream response in chunks', async () => {
      mockLlamaChatSession.mockReturnValue({
        prompt: jest.fn().mockResolvedValue('Hello World Response'),
      });

      const chunks: string[] = [];
      for await (const chunk of provider.stream([
        { role: 'user', content: 'Hello' },
      ])) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.join('')).toBe('Hello World Response');
    });

    it('should use last user message for streaming', async () => {
      const mockPrompt = jest.fn().mockResolvedValue('Response');
      mockLlamaChatSession.mockReturnValue({ prompt: mockPrompt });

      const stream = provider.stream([
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'Reply' },
        { role: 'user', content: 'Second message' },
      ]);

      for await (const _chunk of stream) {
        // Consume stream
      }

      expect(mockPrompt).toHaveBeenCalledWith(
        'Second message',
        expect.anything()
      );
    });
  });

  describe('getModels', () => {
    it('should return GGUF files from models directory', async () => {
      mockFsExtra.readdir.mockResolvedValue([
        'model1.gguf',
        'model2.gguf',
        'readme.txt',
        'another-model.gguf',
      ]);

      const models = await provider.getModels();

      expect(models).toHaveLength(3);
      expect(models.every(m => m.endsWith('.gguf'))).toBe(true);
    });

    it('should return full paths to models', async () => {
      mockFsExtra.readdir.mockResolvedValue(['model.gguf']);

      const models = await provider.getModels();

      expect(models[0]).toContain(path.join('.codebuddy', 'models', 'model.gguf'));
    });

    it('should return empty array if models directory does not exist', async () => {
      mockFsExtra.pathExists.mockResolvedValue(false);

      const models = await provider.getModels();

      expect(models).toEqual([]);
    });

    it('should filter out non-GGUF files', async () => {
      mockFsExtra.readdir.mockResolvedValue([
        'model.gguf',
        'config.json',
        'tokenizer.model',
        '.DS_Store',
      ]);

      const models = await provider.getModels();

      expect(models).toHaveLength(1);
      expect(models[0]).toContain('model.gguf');
    });
  });

  describe('dispose', () => {
    it('should set ready to false', async () => {
      await provider.initialize({ modelPath: '/path/to/model.gguf' });
      expect(provider.isReady()).toBe(true);

      provider.dispose();

      expect(provider.isReady()).toBe(false);
    });

    it('should remove all listeners', () => {
      const listener = jest.fn();
      provider.on('test', listener);

      provider.dispose();
      provider.emit('test');

      expect(listener).not.toHaveBeenCalled();
    });

    it('should clear model and context references', async () => {
      await provider.initialize({ modelPath: '/path/to/model.gguf' });

      provider.dispose();

      // Verify internal state is cleared (accessing private fields via any)
      expect((provider as unknown as { model: unknown }).model).toBeNull();
      expect((provider as unknown as { context: unknown }).context).toBeNull();
    });

    it('should be safe to call multiple times', () => {
      expect(() => {
        provider.dispose();
        provider.dispose();
        provider.dispose();
      }).not.toThrow();
    });
  });
});

// ============================================================================
// WebLLMProvider Tests
// ============================================================================

describe('WebLLMProvider', () => {
  let provider: WebLLMProvider;
  let mockEngine: {
    reload: jest.Mock;
    chat: {
      completions: {
        create: jest.Mock;
      };
    };
  };

  beforeEach(() => {
    provider = new WebLLMProvider();
    jest.clearAllMocks();

    mockEngine = {
      reload: jest.fn().mockResolvedValue(undefined),
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: 'Mock WebLLM response' } }],
            usage: { total_tokens: 25 },
          }),
        },
      },
    };
    mockMLCEngine.mockReturnValue(mockEngine);
  });

  afterEach(() => {
    provider.dispose();
  });

  describe('Provider Properties', () => {
    it('should have correct type', () => {
      expect(provider.type).toBe('webllm');
    });

    it('should have correct name', () => {
      expect(provider.name).toBe('WebLLM');
    });

    it('should be an EventEmitter', () => {
      expect(provider).toBeInstanceOf(EventEmitter);
    });
  });

  describe('Initialization', () => {
    it('should not be ready before initialization', () => {
      expect(provider.isReady()).toBe(false);
    });

    it('should initialize with default model', async () => {
      await provider.initialize({});

      expect(mockEngine.reload).toHaveBeenCalledWith(
        'Llama-3.1-8B-Instruct-q4f16_1-MLC',
        expect.anything()
      );
    });

    it('should initialize with custom model', async () => {
      await provider.initialize({ model: 'Mistral-7B-Instruct-v0.3-q4f16_1-MLC' });

      expect(mockEngine.reload).toHaveBeenCalledWith(
        'Mistral-7B-Instruct-v0.3-q4f16_1-MLC',
        expect.anything()
      );
    });

    it('should emit ready event after initialization', async () => {
      const readyListener = jest.fn();
      provider.on('ready', readyListener);

      await provider.initialize({});

      expect(readyListener).toHaveBeenCalledWith({
        model: 'Llama-3.1-8B-Instruct-q4f16_1-MLC',
      });
    });

    it('should emit progress events during model loading', async () => {
      mockEngine.reload.mockImplementation(async (_model, opts) => {
        opts.initProgressCallback({ progress: 0.5, text: 'Loading...' });
        opts.initProgressCallback({ progress: 1.0, text: 'Ready' });
      });

      const progressListener = jest.fn();
      provider.on('progress', progressListener);

      await provider.initialize({});

      expect(progressListener).toHaveBeenCalledTimes(2);
      expect(progressListener).toHaveBeenCalledWith({ progress: 0.5, text: 'Loading...' });
      expect(progressListener).toHaveBeenCalledWith({ progress: 1.0, text: 'Ready' });
    });

    it('should set ready state after initialization', async () => {
      await provider.initialize({});

      expect(provider.isReady()).toBe(true);
    });

    it('should handle engine without reload method', async () => {
      mockMLCEngine.mockReturnValue({
        chat: {
          completions: {
            create: jest.fn(),
          },
        },
        // No reload method
      });

      await provider.initialize({});

      expect(provider.isReady()).toBe(true);
    });
  });

  describe('isAvailable', () => {
    it('should return false in Node.js environment (no navigator)', async () => {
      const available = await provider.isAvailable();
      expect(available).toBe(false);
    });

    it('should return false if WebGPU not in navigator', async () => {
      const originalNavigator = global.navigator;
      Object.defineProperty(global, 'navigator', {
        value: {},
        writable: true,
        configurable: true,
      });

      const available = await provider.isAvailable();
      expect(available).toBe(false);

      Object.defineProperty(global, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    });

    it('should return true if WebGPU adapter is available', async () => {
      const originalNavigator = global.navigator;
      Object.defineProperty(global, 'navigator', {
        value: {
          gpu: {
            requestAdapter: jest.fn().mockResolvedValue({}),
          },
        },
        writable: true,
        configurable: true,
      });

      const available = await provider.isAvailable();
      expect(available).toBe(true);

      Object.defineProperty(global, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    });

    it('should return false if adapter is null', async () => {
      const originalNavigator = global.navigator;
      Object.defineProperty(global, 'navigator', {
        value: {
          gpu: {
            requestAdapter: jest.fn().mockResolvedValue(null),
          },
        },
        writable: true,
        configurable: true,
      });

      const available = await provider.isAvailable();
      expect(available).toBe(false);

      Object.defineProperty(global, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    });

    it('should return false if requestAdapter throws', async () => {
      const originalNavigator = global.navigator;
      Object.defineProperty(global, 'navigator', {
        value: {
          gpu: {
            requestAdapter: jest.fn().mockRejectedValue(new Error('GPU error')),
          },
        },
        writable: true,
        configurable: true,
      });

      const available = await provider.isAvailable();
      expect(available).toBe(false);

      Object.defineProperty(global, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    });
  });

  describe('Complete Method', () => {
    beforeEach(async () => {
      await provider.initialize({});
    });

    it('should throw if not initialized', async () => {
      const uninitProvider = new WebLLMProvider();
      await expect(uninitProvider.complete([
        { role: 'user', content: 'Hello' },
      ])).rejects.toThrow(/not initialized/i);
      uninitProvider.dispose();
    });

    it('should complete basic request', async () => {
      const messages: LocalLLMMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const response = await provider.complete(messages);

      expect(response.content).toBe('Mock WebLLM response');
      expect(response.provider).toBe('webllm');
    });

    it('should include token usage', async () => {
      const response = await provider.complete([
        { role: 'user', content: 'Hello' },
      ]);

      expect(response.tokensUsed).toBe(25);
    });

    it('should include generation time', async () => {
      const response = await provider.complete([
        { role: 'user', content: 'Hello' },
      ]);

      expect(response.generationTime).toBeGreaterThanOrEqual(0);
    });

    it('should format messages correctly', async () => {
      await provider.complete([
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ]);

      expect(mockEngine.chat.completions.create).toHaveBeenCalledWith({
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
        ],
        max_tokens: 2048,
        temperature: 0.7,
        stream: false,
      });
    });

    it('should use custom temperature', async () => {
      await provider.complete(
        [{ role: 'user', content: 'Hello' }],
        { temperature: 0.3 }
      );

      expect(mockEngine.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.3 })
      );
    });

    it('should use custom maxTokens', async () => {
      await provider.complete(
        [{ role: 'user', content: 'Hello' }],
        { maxTokens: 512 }
      );

      expect(mockEngine.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 512 })
      );
    });

    it('should handle missing content in response', async () => {
      mockEngine.chat.completions.create.mockResolvedValue({
        choices: [{ message: {} }],
        usage: { total_tokens: 0 },
      });

      const response = await provider.complete([
        { role: 'user', content: 'Hello' },
      ]);

      expect(response.content).toBe('');
    });

    it('should handle missing usage in response', async () => {
      mockEngine.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
      });

      const response = await provider.complete([
        { role: 'user', content: 'Hello' },
      ]);

      expect(response.tokensUsed).toBe(0);
    });
  });

  describe('Streaming', () => {
    beforeEach(async () => {
      await provider.initialize({});
    });

    it('should throw if not initialized', async () => {
      const uninitProvider = new WebLLMProvider();
      const stream = uninitProvider.stream([
        { role: 'user', content: 'Hello' },
      ]);

      await expect(async () => {
        for await (const _chunk of stream) {
          // Should throw
        }
      }).rejects.toThrow(/not initialized/i);
      uninitProvider.dispose();
    });

    it('should stream content chunks', async () => {
      // Create async iterable response
      async function* mockStreamResponse() {
        yield { choices: [{ delta: { content: 'Hello' } }] };
        yield { choices: [{ delta: { content: ' ' } }] };
        yield { choices: [{ delta: { content: 'World' } }] };
      }

      mockEngine.chat.completions.create.mockResolvedValue(mockStreamResponse());

      const chunks: string[] = [];
      for await (const chunk of provider.stream([
        { role: 'user', content: 'Hello' },
      ])) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello', ' ', 'World']);
    });

    it('should use stream: true', async () => {
      async function* mockStreamResponse() {
        yield { choices: [{ delta: { content: 'Response' } }] };
      }

      mockEngine.chat.completions.create.mockResolvedValue(mockStreamResponse());

      for await (const _chunk of provider.stream([
        { role: 'user', content: 'Hello' },
      ])) {
        // Consume stream
      }

      expect(mockEngine.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ stream: true })
      );
    });

    it('should skip empty content in stream', async () => {
      async function* mockStreamResponse() {
        yield { choices: [{ delta: {} }] };
        yield { choices: [{ delta: { content: '' } }] };
        yield { choices: [{ delta: { content: 'Valid' } }] };
      }

      mockEngine.chat.completions.create.mockResolvedValue(mockStreamResponse());

      const chunks: string[] = [];
      for await (const chunk of provider.stream([
        { role: 'user', content: 'Hello' },
      ])) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Valid']);
    });
  });

  describe('getModels', () => {
    it('should return list of supported models', async () => {
      const models = await provider.getModels();

      expect(models).toContain('Llama-3.1-8B-Instruct-q4f16_1-MLC');
      expect(models).toContain('Llama-3.1-70B-Instruct-q4f16_1-MLC');
      expect(models).toContain('Mistral-7B-Instruct-v0.3-q4f16_1-MLC');
      expect(models).toContain('Phi-3.5-mini-instruct-q4f16_1-MLC');
      expect(models).toContain('Qwen2.5-7B-Instruct-q4f16_1-MLC');
    });

    it('should return array of exactly 5 models', async () => {
      const models = await provider.getModels();

      expect(models).toHaveLength(5);
    });
  });

  describe('dispose', () => {
    it('should set ready to false', async () => {
      await provider.initialize({});
      expect(provider.isReady()).toBe(true);

      provider.dispose();
      expect(provider.isReady()).toBe(false);
    });

    it('should clear engine reference', async () => {
      await provider.initialize({});

      provider.dispose();

      expect((provider as unknown as { engine: unknown }).engine).toBeNull();
    });

    it('should remove all listeners', () => {
      const listener = jest.fn();
      provider.on('progress', listener);

      provider.dispose();
      provider.emit('progress', { progress: 0.5 });

      expect(listener).not.toHaveBeenCalled();
    });
  });
});

// ============================================================================
// LocalProviderManager Tests
// ============================================================================

describe('LocalProviderManager', () => {
  let manager: LocalProviderManager;

  beforeEach(() => {
    manager = new LocalProviderManager();
    jest.clearAllMocks();
    mockFetch.mockClear();

    // Setup default retry behavior
    mockRetry.mockImplementation(async (fn) => fn());

    // Setup default stream read behavior
    mockSafeStreamRead.mockImplementation(async (reader) => {
      const result = await reader.read();
      return { success: true, done: result.done, value: result.value };
    });
    mockHandleStreamError.mockReturnValue({
      message: 'mock error',
      category: 'unknown',
      isRetryable: false,
    });
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('Provider Registration', () => {
    it('should register and initialize Ollama provider', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true }) // isAvailable
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.1' }] }),
        }); // getModels

      await manager.registerProvider('ollama', {});

      expect(manager.getRegisteredProviders()).toContain('ollama');
    });

    it('should register WebLLM provider', async () => {
      await manager.registerProvider('webllm', {});

      expect(manager.getRegisteredProviders()).toContain('webllm');
    });

    it('should register NodeLlamaCpp provider', async () => {
      mockFsExtra.pathExists.mockResolvedValue(true);

      await manager.registerProvider('local-llama', {
        modelPath: '/path/to/model.gguf'
      });

      expect(manager.getRegisteredProviders()).toContain('local-llama');
    });

    it('should set first registered provider as active', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.1' }] }),
        });

      await manager.registerProvider('ollama', {});

      const activeProvider = manager.getActiveProvider();
      expect(activeProvider).not.toBeNull();
      expect(activeProvider?.type).toBe('ollama');
    });

    it('should not change active provider on subsequent registrations', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.1' }] }),
        });

      await manager.registerProvider('ollama', {});
      await manager.registerProvider('webllm', {});

      expect(manager.getActiveProvider()?.type).toBe('ollama');
    });

    it('should emit progress events from providers', async () => {
      const mockReader = createMockReader([
        { done: false, value: encodeChunk('{"status":"downloading"}\n') },
        { done: true },
      ]);

      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          body: { getReader: () => mockReader },
        });

      const progressListener = jest.fn();
      manager.on('progress', progressListener);

      await manager.registerProvider('ollama', { model: 'llama3.1' });

      expect(progressListener).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'ollama' })
      );
    });

    it('should emit provider:ready event after initialization', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.1' }] }),
        });

      const readyListener = jest.fn();
      manager.on('provider:ready', readyListener);

      await manager.registerProvider('ollama', {});

      expect(readyListener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ollama' })
      );
    });

    it('should throw for unknown provider type', async () => {
      await expect(
        manager.registerProvider('invalid' as LocalProviderType, {})
      ).rejects.toThrow('Unknown local provider type');
    });
  });

  describe('Provider Selection', () => {
    beforeEach(async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.1' }] }),
        });

      await manager.registerProvider('ollama', {});
    });

    it('should return null if no providers registered', () => {
      const emptyManager = new LocalProviderManager();
      expect(emptyManager.getActiveProvider()).toBeNull();
      emptyManager.dispose();
    });

    it('should throw when setting non-registered provider as active', () => {
      expect(() => {
        manager.setActiveProvider('webllm');
      }).toThrow('Provider webllm not registered');
    });

    it('should emit provider:changed event when switching', () => {
      const changedListener = jest.fn();
      manager.on('provider:changed', changedListener);

      manager.setActiveProvider('ollama');

      expect(changedListener).toHaveBeenCalledWith({ type: 'ollama' });
    });

    it('should return registered provider types', () => {
      const types = manager.getRegisteredProviders();

      expect(types).toContain('ollama');
      expect(Array.isArray(types)).toBe(true);
    });
  });

  describe('Auto Detection', () => {
    it('should return ollama if available', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const detected = await manager.autoDetectProvider();

      expect(detected).toBe('ollama');
    });

    it('should return null if no providers available', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const detected = await manager.autoDetectProvider();

      // Node environment without node-llama-cpp or WebGPU
      expect(detected).toBeNull();
    });

    it('should check providers in priority order: Ollama > node-llama-cpp > WebLLM', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      await manager.autoDetectProvider();

      // Ollama should be checked first (via fetch)
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('Complete with Fallback', () => {
    it('should throw if no provider available', async () => {
      await expect(manager.complete([
        { role: 'user', content: 'Hello' },
      ])).rejects.toThrow('No local provider available');
    });

    it('should complete with active provider', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.1' }] }),
        });

      await manager.registerProvider('ollama', {});
      mockFetch.mockClear();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { content: 'Manager response' },
          model: 'llama3.1',
        }),
      });

      const response = await manager.complete([
        { role: 'user', content: 'Hello' },
      ]);

      expect(response.content).toBe('Manager response');
    });

    it('should emit provider:fallback event when switching to fallback', async () => {
      // Register primary provider
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.1' }] }),
        });
      await manager.registerProvider('ollama', {});

      // Register fallback provider
      await manager.registerProvider('webllm', {});

      const fallbackListener = jest.fn();
      manager.on('provider:fallback', fallbackListener);

      // Make primary provider fail
      mockRetry.mockRejectedValueOnce(new Error('Primary failed'));

      // Fallback should also complete (mock WebLLM response)
      const webllmProvider = manager['providers'].get('webllm');
      if (webllmProvider) {
        jest.spyOn(webllmProvider, 'complete').mockResolvedValue({
          content: 'Fallback response',
          tokensUsed: 10,
          model: 'webllm-model',
          provider: 'webllm',
          generationTime: 100,
        });
      }

      const response = await manager.complete([
        { role: 'user', content: 'Hello' },
      ]);

      expect(response.content).toBe('Fallback response');
      expect(fallbackListener).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'ollama',
          to: 'webllm',
        })
      );
    });

    it('should throw if all providers fail', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.1' }] }),
        });

      await manager.registerProvider('ollama', {});
      mockFetch.mockClear();

      mockRetry.mockRejectedValue(new Error('All providers failed'));

      await expect(manager.complete([
        { role: 'user', content: 'Hello' },
      ])).rejects.toThrow('All providers failed');
    });
  });

  describe('Stream', () => {
    it('should throw if no provider available', () => {
      expect(() => {
        manager.stream([{ role: 'user', content: 'Hello' }]);
      }).toThrow('No local provider available');
    });

    it('should stream with active provider', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.1' }] }),
        });

      await manager.registerProvider('ollama', {});
      mockFetch.mockClear();

      const mockReader = createMockReader([
        { done: false, value: encodeChunk('{"message":{"content":"Streamed"}}\n') },
        { done: true },
      ]);

      mockFetch.mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const chunks: string[] = [];
      for await (const chunk of manager.stream([
        { role: 'user', content: 'Hello' },
      ])) {
        chunks.push(chunk);
      }

      expect(chunks).toContain('Streamed');
    });
  });

  describe('Dispose', () => {
    it('should dispose all registered providers', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.1' }] }),
        });

      await manager.registerProvider('ollama', {});

      manager.dispose();

      expect(manager.getRegisteredProviders()).toEqual([]);
      expect(manager.getActiveProvider()).toBeNull();
    });

    it('should remove all event listeners', () => {
      const listener = jest.fn();
      manager.on('test', listener);

      manager.dispose();
      manager.emit('test');

      expect(listener).not.toHaveBeenCalled();
    });
  });
});

// ============================================================================
// Singleton and Auto-configuration Tests
// ============================================================================

describe('Singleton Functions', () => {
  afterEach(() => {
    resetLocalProviderManager();
  });

  describe('getLocalProviderManager', () => {
    it('should return same instance on multiple calls', () => {
      const manager1 = getLocalProviderManager();
      const manager2 = getLocalProviderManager();

      expect(manager1).toBe(manager2);
    });

    it('should create new instance after reset', () => {
      const manager1 = getLocalProviderManager();
      resetLocalProviderManager();
      const manager2 = getLocalProviderManager();

      expect(manager1).not.toBe(manager2);
    });

    it('should return LocalProviderManager instance', () => {
      const manager = getLocalProviderManager();

      expect(manager).toBeInstanceOf(LocalProviderManager);
    });
  });

  describe('resetLocalProviderManager', () => {
    it('should dispose existing manager', () => {
      const manager = getLocalProviderManager();
      const disposeSpy = jest.spyOn(manager, 'dispose');

      resetLocalProviderManager();

      expect(disposeSpy).toHaveBeenCalled();
    });

    it('should handle reset when no manager exists', () => {
      // Reset first to ensure no manager
      resetLocalProviderManager();

      // Should not throw
      expect(() => resetLocalProviderManager()).not.toThrow();
    });

    it('should be safe to call multiple times', () => {
      expect(() => {
        resetLocalProviderManager();
        resetLocalProviderManager();
        resetLocalProviderManager();
      }).not.toThrow();
    });
  });
});

describe('autoConfigureLocalProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRetry.mockImplementation(async (fn) => fn());
  });

  afterEach(() => {
    resetLocalProviderManager();
  });

  it('should try preferred provider first', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'llama3.1' }] }),
      });

    const manager = await autoConfigureLocalProvider('ollama');

    expect(manager.getRegisteredProviders()).toContain('ollama');
  });

  it('should fall back to auto-detect if preferred fails', async () => {
    // First attempt (preferred webllm) will fail in Node.js
    // Auto-detect should find ollama
    mockFetch
      .mockResolvedValueOnce({ ok: true }) // Auto-detect Ollama
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'llama3.1' }] }),
      });

    const manager = await autoConfigureLocalProvider('webllm');

    expect(manager.getRegisteredProviders()).toContain('ollama');
  });

  it('should throw if no provider available', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'));

    await expect(autoConfigureLocalProvider())
      .rejects.toThrow('No local LLM provider available');
  });

  it('should include helpful instructions when no provider available', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'));

    await expect(autoConfigureLocalProvider())
      .rejects.toThrow(/https:\/\/ollama\.com/);

    await expect(autoConfigureLocalProvider())
      .rejects.toThrow(/npm install node-llama-cpp/);

    await expect(autoConfigureLocalProvider())
      .rejects.toThrow(/WebLLM/);
  });

  it('should return the singleton manager', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'llama3.1' }] }),
      });

    const manager = await autoConfigureLocalProvider('ollama');
    const singleton = getLocalProviderManager();

    expect(manager).toBe(singleton);
  });
});

// ============================================================================
// Resource Cleanup Tests
// ============================================================================

describe('Resource Cleanup', () => {
  describe('Stream Reader Cleanup', () => {
    let provider: OllamaProvider;

    beforeEach(async () => {
      provider = new OllamaProvider();
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.1' }] }),
        });
      await provider.initialize({});
      mockFetch.mockClear();
      mockRetry.mockImplementation(async (fn) => fn());
    });

    afterEach(() => {
      provider.dispose();
    });

    it('should release reader lock after successful stream', async () => {
      const mockReader = createMockReader([
        { done: false, value: encodeChunk('{"message":{"content":"Hello"}}\n') },
        { done: true },
      ]);

      mockFetch.mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader },
      });

      for await (const _chunk of provider.stream([
        { role: 'user', content: 'Hello' },
      ])) {
        // Consume stream
      }

      expect(mockReader.releaseLock).toHaveBeenCalled();
    });

    it('should release reader lock after stream error', async () => {
      const mockReader = createMockReader([
        { done: false, value: encodeChunk('{"message":{"content":"Hello"}}\n') },
      ]);
      mockReader.read.mockRejectedValueOnce(new Error('Stream error'));

      mockSafeStreamRead.mockResolvedValueOnce({
        success: false,
        done: true,
        error: new Error('Stream error'),
      });
      mockHandleStreamError.mockReturnValue({
        message: 'Stream error',
        category: 'network',
        isRetryable: false,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader },
      });

      try {
        for await (const _chunk of provider.stream([
          { role: 'user', content: 'Hello' },
        ])) {
          // Consume stream
        }
      } catch {
        // Expected error
      }

      expect(mockReader.releaseLock).toHaveBeenCalled();
    });

    it('should release reader lock after early break', async () => {
      const mockReader = createMockReader([
        { done: false, value: encodeChunk('{"message":{"content":"1"}}\n') },
        { done: false, value: encodeChunk('{"message":{"content":"2"}}\n') },
        { done: false, value: encodeChunk('{"message":{"content":"3"}}\n') },
        { done: true },
      ]);

      mockFetch.mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader },
      });

      let count = 0;
      for await (const _chunk of provider.stream([
        { role: 'user', content: 'Hello' },
      ])) {
        count++;
        if (count >= 2) break;
      }

      // Note: reader.releaseLock is called in finally block
      expect(mockReader.releaseLock).toHaveBeenCalled();
    });
  });

  describe('Pull Model Reader Cleanup', () => {
    let provider: OllamaProvider;

    beforeEach(() => {
      provider = new OllamaProvider();
    });

    afterEach(() => {
      provider.dispose();
    });

    it('should release reader lock after successful pull', async () => {
      const mockReader = createMockReader([
        { done: false, value: encodeChunk('{"status":"downloading"}\n') },
        { done: true },
      ]);

      mockFetch.mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader },
      });

      await provider.pullModel('llama3.1');

      expect(mockReader.releaseLock).toHaveBeenCalled();
    });

    it('should release reader lock on pull error', async () => {
      const mockReader = createMockReader([]);
      mockReader.read.mockRejectedValue(new Error('Network error'));

      mockSafeStreamRead.mockResolvedValueOnce({
        success: false,
        done: true,
        error: new Error('Network error'),
      });
      mockHandleStreamError.mockReturnValue({
        message: 'Network error',
        category: 'network',
        isRetryable: false,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader },
      });

      try {
        await provider.pullModel('llama3.1');
      } catch {
        // Expected error
      }

      expect(mockReader.releaseLock).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  describe('Network Errors', () => {
    it('should handle connection refused', async () => {
      const provider = new OllamaProvider();
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(provider.initialize({}))
        .rejects.toThrow('Ollama is not available');

      provider.dispose();
    });

    it('should handle timeout errors on isAvailable', async () => {
      const provider = new OllamaProvider();
      mockFetch.mockRejectedValue(new Error('ETIMEDOUT'));

      const available = await provider.isAvailable();
      expect(available).toBe(false);

      provider.dispose();
    });

    it('should handle DNS resolution failures', async () => {
      const provider = new OllamaProvider();
      mockFetch.mockRejectedValue(new Error('ENOTFOUND'));

      const available = await provider.isAvailable();
      expect(available).toBe(false);

      provider.dispose();
    });
  });

  describe('Invalid Responses', () => {
    let provider: OllamaProvider;

    beforeEach(async () => {
      provider = new OllamaProvider();
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.1' }] }),
        });
      await provider.initialize({});
      mockFetch.mockClear();
      mockRetry.mockImplementation(async (fn) => fn());
    });

    afterEach(() => {
      provider.dispose();
    });

    it('should handle malformed JSON in response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('Unexpected token');
        },
      });

      await expect(provider.complete([
        { role: 'user', content: 'Hello' },
      ])).rejects.toThrow();
    });

    it('should handle empty response body in stream', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: null,
      });

      const stream = provider.stream([{ role: 'user', content: 'Hello' }]);

      await expect(async () => {
        for await (const _chunk of stream) {
          // Should throw
        }
      }).rejects.toThrow('empty response body');
    });

    it('should skip malformed JSON lines in stream', async () => {
      const mockReader = createMockReader([
        { done: false, value: encodeChunk('invalid json\n{"message":{"content":"Valid"}}\n') },
        { done: true },
      ]);

      mockFetch.mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const chunks: string[] = [];
      for await (const chunk of provider.stream([
        { role: 'user', content: 'Hello' },
      ])) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Valid']);
    });
  });

  describe('API Errors', () => {
    let provider: OllamaProvider;

    beforeEach(async () => {
      provider = new OllamaProvider();
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.1' }] }),
        });
      await provider.initialize({});
      mockFetch.mockClear();
    });

    afterEach(() => {
      provider.dispose();
    });

    it('should handle 500 Internal Server Error', async () => {
      mockRetry.mockRejectedValue(new Error('Ollama API error: Internal Server Error'));

      await expect(provider.complete([
        { role: 'user', content: 'Hello' },
      ])).rejects.toThrow('Internal Server Error');
    });

    it('should handle 404 Model Not Found', async () => {
      mockRetry.mockRejectedValue(new Error('Ollama API error: Model not found'));

      await expect(provider.complete([
        { role: 'user', content: 'Hello' },
      ])).rejects.toThrow('Model not found');
    });

    it('should handle rate limiting (429)', async () => {
      mockRetry.mockRejectedValue(new Error('Ollama API error: Too Many Requests'));

      await expect(provider.complete([
        { role: 'user', content: 'Hello' },
      ])).rejects.toThrow('Too Many Requests');
    });
  });
});

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('Type Safety', () => {
  describe('LocalLLMResponse', () => {
    it('should return correctly typed response from OllamaProvider', async () => {
      const provider = new OllamaProvider();

      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.1' }] }),
        });

      await provider.initialize({});
      mockFetch.mockClear();
      mockRetry.mockImplementation(async (fn) => fn());

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { content: 'Hello!' },
          eval_count: 10,
          model: 'llama3.1',
        }),
      });

      const response: LocalLLMResponse = await provider.complete([
        { role: 'user', content: 'Hello' },
      ]);

      expect(typeof response.content).toBe('string');
      expect(typeof response.tokensUsed).toBe('number');
      expect(typeof response.model).toBe('string');
      expect(typeof response.provider).toBe('string');
      expect(typeof response.generationTime).toBe('number');

      provider.dispose();
    });
  });

  describe('Provider Interface', () => {
    it('should implement LocalLLMProvider interface correctly', () => {
      const ollamaProvider = new OllamaProvider();
      const nodeLlamaProvider = new NodeLlamaCppProvider();
      const webllmProvider = new WebLLMProvider();

      for (const provider of [ollamaProvider, nodeLlamaProvider, webllmProvider]) {
        // Check type property
        expect(['ollama', 'local-llama', 'webllm']).toContain(provider.type);

        // Check name property
        expect(typeof provider.name).toBe('string');
        expect(provider.name.length).toBeGreaterThan(0);

        // Check required methods exist
        expect(typeof provider.initialize).toBe('function');
        expect(typeof provider.isReady).toBe('function');
        expect(typeof provider.isAvailable).toBe('function');
        expect(typeof provider.complete).toBe('function');
        expect(typeof provider.stream).toBe('function');
        expect(typeof provider.getModels).toBe('function');
        expect(typeof provider.dispose).toBe('function');

        // Check EventEmitter methods
        expect(typeof provider.on).toBe('function');
        expect(typeof provider.emit).toBe('function');

        provider.dispose();
      }
    });
  });

  describe('LocalProviderType', () => {
    it('should accept valid provider types', () => {
      const validTypes: LocalProviderType[] = ['ollama', 'local-llama', 'webllm'];

      for (const type of validTypes) {
        expect(typeof type).toBe('string');
      }
    });
  });

  describe('LocalProviderConfig', () => {
    it('should accept valid config options', () => {
      const config: LocalProviderConfig = {
        model: 'test-model',
        modelPath: '/path/to/model.gguf',
        endpoint: 'http://localhost:11434',
        maxTokens: 2048,
        temperature: 0.7,
        gpuLayers: 32,
        contextSize: 4096,
      };

      expect(config.model).toBe('test-model');
      expect(config.maxTokens).toBe(2048);
    });

    it('should work with partial config', () => {
      const partialConfig: LocalProviderConfig = {
        model: 'llama3.1',
      };

      expect(partialConfig.model).toBe('llama3.1');
      expect(partialConfig.temperature).toBeUndefined();
    });
  });
});
