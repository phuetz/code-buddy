/**
 * Local LLM Provider Unit Tests
 *
 * Comprehensive tests for LocalLLMProvider classes (NodeLlamaCppProvider, WebLLMProvider, LocalProviderManager).
 */

import {
  NodeLlamaCppProvider,
  WebLLMProvider,
  LocalProviderManager,
  getLocalProviderManager,
  resetLocalProviderManager,
} from '../../src/providers/local-llm-provider.js';
import type { LocalLLMMessage } from '../../src/providers/local-llm-provider.js';

// Mock fs-extra
jest.mock('fs-extra', () => ({
  ensureDir: jest.fn().mockResolvedValue(undefined),
  pathExists: jest.fn().mockResolvedValue(true),
  readdir: jest.fn().mockResolvedValue([]),
}));

// Mock node-llama-cpp
jest.mock('node-llama-cpp', () => ({
  LlamaModel: jest.fn().mockImplementation(() => ({})),
  LlamaContext: jest.fn().mockImplementation(() => ({})),
  LlamaChatSession: jest.fn().mockImplementation(() => ({
    prompt: jest.fn().mockResolvedValue('Mock response'),
  })),
}), { virtual: true });

// Mock @mlc-ai/web-llm
jest.mock('@mlc-ai/web-llm', () => ({
  MLCEngine: jest.fn().mockImplementation(() => ({
    reload: jest.fn().mockResolvedValue(undefined),
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content: 'Mock response' } }],
          usage: { total_tokens: 10 },
        }),
      },
    },
  })),
}), { virtual: true });

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock logger
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Local LLM Providers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetLocalProviderManager();
  });

  // ============================================================================
  // NodeLlamaCppProvider Tests
  // ============================================================================
  describe('NodeLlamaCppProvider', () => {
    let provider: NodeLlamaCppProvider;

    beforeEach(() => {
      provider = new NodeLlamaCppProvider();
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
    });

    describe('Initialization', () => {
      it('should not be ready before initialization', () => {
        expect(provider.isReady()).toBe(false);
      });

      it('should throw if model file not found', async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('fs-extra');
        fs.pathExists.mockResolvedValueOnce(false);

        await expect(provider.initialize({}))
          .rejects.toThrow('Model not found');
      });

      it('should ensure models directory exists', async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('fs-extra');
        fs.pathExists.mockResolvedValueOnce(true);

        await provider.initialize({ modelPath: '/path/to/model.gguf' });

        expect(fs.ensureDir).toHaveBeenCalled();
      });

      it('should emit ready event after initialization', async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('fs-extra');
        fs.pathExists.mockResolvedValueOnce(true);

        const readyListener = jest.fn();
        provider.on('ready', readyListener);

        await provider.initialize({ modelPath: '/path/to/model.gguf' });

        expect(readyListener).toHaveBeenCalled();
      });
    });

    describe('isAvailable', () => {
      it('should return true when node-llama-cpp is installed', async () => {
        const available = await provider.isAvailable();
        expect(available).toBe(true);
      });
    });

    describe('Complete Method', () => {
      beforeEach(async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('fs-extra');
        fs.pathExists.mockResolvedValueOnce(true);
        await provider.initialize({ modelPath: '/path/to/model.gguf' });
      });

      it('should throw if not initialized', async () => {
        const uninitProvider = new NodeLlamaCppProvider();
        await expect(uninitProvider.complete([
          { role: 'user', content: 'Hello' },
        ])).rejects.toThrow('Provider not initialized');
        uninitProvider.dispose();
      });

      it('should complete basic request', async () => {
        const messages: LocalLLMMessage[] = [
          { role: 'user', content: 'Hello' },
        ];

        const response = await provider.complete(messages);

        expect(response.content).toBe('Mock response');
        expect(response.provider).toBe('local-llama');
      });

      it('should include generation time', async () => {
        const response = await provider.complete([
          { role: 'user', content: 'Hello' },
        ]);

        expect(response.generationTime).toBeGreaterThanOrEqual(0);
      });
    });

    describe('Streaming', () => {
      beforeEach(async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('fs-extra');
        fs.pathExists.mockResolvedValueOnce(true);
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
        }).rejects.toThrow('Provider not initialized');
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
    });

    describe('getModels', () => {
      it('should return GGUF files from models directory', async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('fs-extra');
        fs.pathExists.mockResolvedValueOnce(true);
        fs.readdir.mockResolvedValueOnce([
          'model1.gguf',
          'model2.gguf',
          'readme.txt',
        ]);

        const models = await provider.getModels();

        expect(models).toHaveLength(2);
      });

      it('should return empty array if models directory does not exist', async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('fs-extra');
        fs.pathExists.mockResolvedValueOnce(false);

        const models = await provider.getModels();

        expect(models).toEqual([]);
      });
    });

    describe('dispose', () => {
      it('should set ready to false', async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('fs-extra');
        fs.pathExists.mockResolvedValueOnce(true);
        await provider.initialize({ modelPath: '/path/to/model.gguf' });

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
    });
  });

  // ============================================================================
  // WebLLMProvider Tests
  // ============================================================================
  describe('WebLLMProvider', () => {
    let provider: WebLLMProvider;

    beforeEach(() => {
      provider = new WebLLMProvider();
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
    });

    describe('Initialization', () => {
      it('should not be ready before initialization', () => {
        expect(provider.isReady()).toBe(false);
      });

      it('should initialize with default model', async () => {
        await provider.initialize({});
        expect(provider.isReady()).toBe(true);
      });

      it('should emit ready event after initialization', async () => {
        const readyListener = jest.fn();
        provider.on('ready', readyListener);

        await provider.initialize({});

        expect(readyListener).toHaveBeenCalled();
      });
    });

    describe('isAvailable', () => {
      it('should return false in Node.js environment (no navigator)', async () => {
        const available = await provider.isAvailable();
        expect(available).toBe(false);
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
        ])).rejects.toThrow('Provider not initialized');
        uninitProvider.dispose();
      });

      it('should complete basic request', async () => {
        const messages: LocalLLMMessage[] = [
          { role: 'user', content: 'Hello' },
        ];

        const response = await provider.complete(messages);

        expect(response.content).toBe('Mock response');
        expect(response.provider).toBe('webllm');
      });
    });

    describe('getModels', () => {
      it('should return list of supported models', async () => {
        const models = await provider.getModels();

        expect(models).toContain('Llama-3.1-8B-Instruct-q4f16_1-MLC');
        expect(models.length).toBeGreaterThan(0);
      });
    });

    describe('dispose', () => {
      it('should set ready to false', async () => {
        await provider.initialize({});
        expect(provider.isReady()).toBe(true);

        provider.dispose();
        expect(provider.isReady()).toBe(false);
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
      mockFetch.mockClear();
    });

    afterEach(() => {
      manager.dispose();
    });

    describe('registerProvider', () => {
      it('should register Ollama provider', async () => {
        mockFetch
          .mockResolvedValueOnce({ ok: true })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ models: [{ name: 'llama3.1' }] }),
          });

        await manager.registerProvider('ollama', {});

        expect(manager.getRegisteredProviders()).toContain('ollama');
      });

      it('should set first registered provider as active', async () => {
        mockFetch
          .mockResolvedValueOnce({ ok: true })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ models: [{ name: 'llama3.1' }] }),
          });

        await manager.registerProvider('ollama', {});

        expect(manager.getActiveProvider()).not.toBeNull();
      });

      it('should throw for unknown provider type', async () => {
        await expect(manager.registerProvider('unknown' as 'ollama', {}))
          .rejects.toThrow('Unknown local provider type');
      });
    });

    describe('getActiveProvider', () => {
      it('should return null when no providers registered', () => {
        expect(manager.getActiveProvider()).toBeNull();
      });

      it('should return active provider', async () => {
        mockFetch
          .mockResolvedValueOnce({ ok: true })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ models: [{ name: 'llama3.1' }] }),
          });

        await manager.registerProvider('ollama', {});

        const activeProvider = manager.getActiveProvider();
        expect(activeProvider).not.toBeNull();
        expect(activeProvider!.type).toBe('ollama');
      });
    });

    describe('setActiveProvider', () => {
      it('should throw for unregistered provider', () => {
        expect(() => manager.setActiveProvider('ollama'))
          .toThrow('Provider ollama not registered');
      });

      it('should emit provider:changed event', async () => {
        mockFetch
          .mockResolvedValueOnce({ ok: true })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ models: [{ name: 'llama3.1' }] }),
          });

        await manager.registerProvider('ollama', {});

        const changedListener = jest.fn();
        manager.on('provider:changed', changedListener);

        manager.setActiveProvider('ollama');

        expect(changedListener).toHaveBeenCalledWith({ type: 'ollama' });
      });
    });

    describe('autoDetectProvider', () => {
      it('should detect Ollama first', async () => {
        mockFetch.mockResolvedValue({ ok: true });

        const detected = await manager.autoDetectProvider();

        expect(detected).toBe('ollama');
      });
    });

    describe('complete', () => {
      it('should throw when no provider available', async () => {
        await expect(manager.complete([{ role: 'user', content: 'Hello' }]))
          .rejects.toThrow('No local provider available');
      });

      it('should complete with active provider', async () => {
        mockFetch
          .mockResolvedValueOnce({ ok: true })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ models: [{ name: 'llama3.1' }] }),
          })
          .mockResolvedValue({
            ok: true,
            json: async () => ({
              message: { content: 'Response' },
              model: 'llama3.1',
            }),
          });

        await manager.registerProvider('ollama', {});

        const response = await manager.complete([
          { role: 'user', content: 'Hello' },
        ]);

        expect(response.content).toBe('Response');
      });
    });

    describe('stream', () => {
      it('should throw when no provider available', () => {
        expect(() => manager.stream([{ role: 'user', content: 'Hello' }]))
          .toThrow('No local provider available');
      });
    });

    describe('getRegisteredProviders', () => {
      it('should return empty array initially', () => {
        expect(manager.getRegisteredProviders()).toEqual([]);
      });
    });

    describe('dispose', () => {
      it('should dispose all providers', async () => {
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
    });
  });

  // ============================================================================
  // Singleton Functions Tests
  // ============================================================================
  describe('Singleton Functions', () => {
    beforeEach(() => {
      resetLocalProviderManager();
    });

    describe('getLocalProviderManager', () => {
      it('should return same instance', () => {
        const instance1 = getLocalProviderManager();
        const instance2 = getLocalProviderManager();

        expect(instance1).toBe(instance2);
      });

      it('should create new instance if not exists', () => {
        const instance = getLocalProviderManager();
        expect(instance).toBeDefined();
        expect(instance).toBeInstanceOf(LocalProviderManager);
      });
    });

    describe('resetLocalProviderManager', () => {
      it('should reset singleton', () => {
        const instance1 = getLocalProviderManager();
        resetLocalProviderManager();
        const instance2 = getLocalProviderManager();

        expect(instance1).not.toBe(instance2);
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
});
