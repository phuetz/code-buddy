/**
 * Ollama Provider Unit Tests
 *
 * Comprehensive tests for the OllamaProvider class from local-llm-provider.ts.
 */

import { OllamaProvider } from '../../src/providers/local-llm-provider.js';
import type { LocalLLMMessage, LocalProviderConfig } from '../../src/providers/local-llm-provider.js';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('OllamaProvider', () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    provider = new OllamaProvider();
    mockFetch.mockClear();
  });

  afterEach(() => {
    provider.dispose();
  });

  describe('Provider Properties', () => {
    it('should have correct type', () => {
      expect(provider.type).toBe('ollama');
    });

    it('should have correct name', () => {
      expect(provider.name).toBe('Ollama');
    });
  });

  describe('Initialization', () => {
    it('should not be ready before initialization', () => {
      expect(provider.isReady()).toBe(false);
    });

    it('should throw if Ollama is not running', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      await expect(provider.initialize({}))
        .rejects.toThrow('Ollama is not running');
    });

    it('should throw with helpful message if Ollama not available', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      try {
        await provider.initialize({});
      } catch (error) {
        expect((error as Error).message).toContain('ollama serve');
        expect((error as Error).message).toContain('https://ollama.com');
      }
    });

    it('should initialize when Ollama is available', async () => {
      // Mock Ollama server is running with model available
      mockFetch
        .mockResolvedValueOnce({ ok: true }) // isAvailable check
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.1' }] }),
        }); // getModels check

      await provider.initialize({});
      expect(provider.isReady()).toBe(true);
    });

    it('should use default endpoint', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.1' }] }),
        });

      await provider.initialize({});

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.anything()
      );
    });

    it('should use custom endpoint', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.1' }] }),
        });

      await provider.initialize({ endpoint: 'http://custom:8080' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://custom:8080/api/tags',
        expect.anything()
      );
    });

    it('should pull model if not available', async () => {
      const mockReader = {
        read: jest.fn()
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('{"status":"pulling"}\n') })
          .mockResolvedValueOnce({ done: true }),
        releaseLock: jest.fn(),
      };

      mockFetch
        .mockResolvedValueOnce({ ok: true }) // isAvailable
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [] }), // No models initially
        })
        .mockResolvedValueOnce({
          ok: true,
          body: { getReader: () => mockReader },
        }); // pullModel

      const progressListener = jest.fn();
      provider.on('progress', progressListener);

      await provider.initialize({ model: 'llama3.1' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/pull',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'llama3.1', stream: true }),
        })
      );
    });

    it('should emit model:pulling event when pulling model', async () => {
      const mockReader = {
        read: jest.fn().mockResolvedValue({ done: true }),
        releaseLock: jest.fn(),
      };

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

      const pullingListener = jest.fn();
      provider.on('model:pulling', pullingListener);

      await provider.initialize({ model: 'llama3.1' });

      expect(pullingListener).toHaveBeenCalledWith({ model: 'llama3.1' });
    });

    it('should emit ready event after initialization', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.1' }] }),
        });

      const readyListener = jest.fn();
      provider.on('ready', readyListener);

      await provider.initialize({});

      expect(readyListener).toHaveBeenCalledWith({
        model: 'llama3.1',
        endpoint: 'http://localhost:11434',
      });
    });
  });

  describe('isAvailable', () => {
    it('should return true when Ollama is running', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const available = await provider.isAvailable();
      expect(available).toBe(true);
    });

    it('should return false when Ollama is not running', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const available = await provider.isAvailable();
      expect(available).toBe(false);
    });

    it('should return false on non-ok response', async () => {
      mockFetch.mockResolvedValue({ ok: false });

      const available = await provider.isAvailable();
      expect(available).toBe(false);
    });

    it('should use 2 second timeout', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      await provider.isAvailable();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });
  });

  describe('pullModel', () => {
    it('should make POST request to pull endpoint', async () => {
      const mockReader = {
        read: jest.fn().mockResolvedValue({ done: true }),
        releaseLock: jest.fn(),
      };

      mockFetch.mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader },
      });

      await provider.pullModel('llama3.1');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/pull',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'llama3.1', stream: true }),
        })
      );
    });

    it('should throw on failed pull', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Model not found',
      });

      await expect(provider.pullModel('invalid-model'))
        .rejects.toThrow('Failed to pull model');
    });

    it('should emit progress events during pull', async () => {
      const mockReader = {
        read: jest.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('{"status":"pulling manifest"}\n'),
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('{"status":"downloading","completed":50,"total":100}\n'),
          })
          .mockResolvedValueOnce({ done: true }),
        releaseLock: jest.fn(),
      };

      mockFetch.mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const progressListener = jest.fn();
      provider.on('progress', progressListener);

      await provider.pullModel('llama3.1');

      expect(progressListener).toHaveBeenCalledTimes(2);
      expect(progressListener).toHaveBeenCalledWith({ status: 'pulling manifest' });
      expect(progressListener).toHaveBeenCalledWith({
        status: 'downloading',
        completed: 50,
        total: 100,
      });
    });

    it('should skip malformed JSON during pull progress', async () => {
      const mockReader = {
        read: jest.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('invalid json\n{"status":"valid"}\n'),
          })
          .mockResolvedValueOnce({ done: true }),
        releaseLock: jest.fn(),
      };

      mockFetch.mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const progressListener = jest.fn();
      provider.on('progress', progressListener);

      await provider.pullModel('llama3.1');

      expect(progressListener).toHaveBeenCalledTimes(1);
      expect(progressListener).toHaveBeenCalledWith({ status: 'valid' });
    });

    it('should handle missing response body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: null,
      });

      // Should not throw
      await provider.pullModel('llama3.1');
    });

    it('should release reader lock', async () => {
      const mockReader = {
        read: jest.fn().mockResolvedValue({ done: true }),
        releaseLock: jest.fn(),
      };

      mockFetch.mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader },
      });

      await provider.pullModel('llama3.1');

      expect(mockReader.releaseLock).toHaveBeenCalled();
    });
  });

  describe('Complete Method', () => {
    const mockResponse = {
      message: { content: 'Hello! How can I help you?' },
      eval_count: 20,
      model: 'llama3.1',
    };

    beforeEach(async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.1' }] }),
        });

      await provider.initialize({});
      mockFetch.mockClear();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });
    });

    it('should throw if not initialized', async () => {
      const uninitProvider = new OllamaProvider();
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

      expect(response.content).toBe('Hello! How can I help you?');
      expect(response.tokensUsed).toBe(20);
      expect(response.model).toBe('llama3.1');
      expect(response.provider).toBe('ollama');
    });

    it('should use /api/chat endpoint', async () => {
      await provider.complete([{ role: 'user', content: 'Hello' }]);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/chat',
        expect.anything()
      );
    });

    it('should send POST request with JSON content type', async () => {
      await provider.complete([{ role: 'user', content: 'Hello' }]);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should format messages correctly', async () => {
      const messages: LocalLLMMessage[] = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
        { role: 'user', content: 'How are you?' },
      ];

      await provider.complete(messages);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.messages).toEqual([
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
        { role: 'user', content: 'How are you?' },
      ]);
    });

    it('should include stream: false', async () => {
      await provider.complete([{ role: 'user', content: 'Hello' }]);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.stream).toBe(false);
    });

    it('should use custom temperature', async () => {
      await provider.complete(
        [{ role: 'user', content: 'Hello' }],
        { temperature: 0.5 }
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.options.temperature).toBe(0.5);
    });

    it('should use custom maxTokens', async () => {
      await provider.complete(
        [{ role: 'user', content: 'Hello' }],
        { maxTokens: 1024 }
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.options.num_predict).toBe(1024);
    });

    it('should use custom model from options', async () => {
      await provider.complete(
        [{ role: 'user', content: 'Hello' }],
        { model: 'codellama' }
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.model).toBe('codellama');
    });

    it('should handle missing eval_count', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { content: 'Hello' },
          model: 'llama3.1',
        }),
      });

      const response = await provider.complete([
        { role: 'user', content: 'Hello' },
      ]);

      expect(response.tokensUsed).toBe(0);
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Model not found',
      });

      await expect(provider.complete([
        { role: 'user', content: 'Hello' },
      ])).rejects.toThrow('Ollama API error');
    });

    it('should include generation time', async () => {
      const response = await provider.complete([
        { role: 'user', content: 'Hello' },
      ]);

      expect(response.generationTime).toBeGreaterThanOrEqual(0);
    });

    it('should use default values when options not specified', async () => {
      await provider.complete([{ role: 'user', content: 'Hello' }]);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.options.num_predict).toBe(2048);
      expect(callBody.options.temperature).toBe(0.7);
    });
  });

  describe('Streaming', () => {
    beforeEach(async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.1' }] }),
        });

      await provider.initialize({});
      mockFetch.mockClear();
    });

    it('should throw if not initialized', async () => {
      const uninitProvider = new OllamaProvider();
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

    it('should stream content chunks', async () => {
      const mockReader = {
        read: jest.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('{"message":{"content":"Hello"}}\n'),
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('{"message":{"content":" World"}}\n'),
          })
          .mockResolvedValueOnce({ done: true }),
        releaseLock: jest.fn(),
      };

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

      expect(chunks).toEqual(['Hello', ' World']);
    });

    it('should use stream: true', async () => {
      const mockReader = {
        read: jest.fn().mockResolvedValue({ done: true }),
        releaseLock: jest.fn(),
      };

      mockFetch.mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader },
      });

      for await (const _chunk of provider.stream([
        { role: 'user', content: 'Hello' },
      ])) {
        // Consume stream
      }

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.stream).toBe(true);
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Server Error',
      });

      const stream = provider.stream([
        { role: 'user', content: 'Hello' },
      ]);

      await expect(async () => {
        for await (const _chunk of stream) {
          // Should throw
        }
      }).rejects.toThrow('Ollama API error');
    });

    it('should throw if no response body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: null,
      });

      const stream = provider.stream([
        { role: 'user', content: 'Hello' },
      ]);

      await expect(async () => {
        for await (const _chunk of stream) {
          // Should throw
        }
      }).rejects.toThrow('No response body');
    });

    it('should skip empty content', async () => {
      const mockReader = {
        read: jest.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('{"message":{}}\n'),
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('{"message":{"content":"Valid"}}\n'),
          })
          .mockResolvedValueOnce({ done: true }),
        releaseLock: jest.fn(),
      };

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

    it('should skip malformed JSON', async () => {
      const mockReader = {
        read: jest.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('invalid\n{"message":{"content":"Valid"}}\n'),
          })
          .mockResolvedValueOnce({ done: true }),
        releaseLock: jest.fn(),
      };

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

    it('should skip empty lines', async () => {
      const mockReader = {
        read: jest.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('\n  \n{"message":{"content":"Hello"}}\n'),
          })
          .mockResolvedValueOnce({ done: true }),
        releaseLock: jest.fn(),
      };

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

      expect(chunks).toEqual(['Hello']);
    });

    it('should release reader lock', async () => {
      const mockReader = {
        read: jest.fn().mockResolvedValue({ done: true }),
        releaseLock: jest.fn(),
      };

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

    it('should use custom options', async () => {
      const mockReader = {
        read: jest.fn().mockResolvedValue({ done: true }),
        releaseLock: jest.fn(),
      };

      mockFetch.mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader },
      });

      for await (const _chunk of provider.stream(
        [{ role: 'user', content: 'Hello' }],
        { model: 'codellama', temperature: 0.3, maxTokens: 512 }
      )) {
        // Consume stream
      }

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.model).toBe('codellama');
      expect(callBody.options.temperature).toBe(0.3);
      expect(callBody.options.num_predict).toBe(512);
    });
  });

  describe('getModels', () => {
    it('should return list of available models', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [
            { name: 'llama3.1' },
            { name: 'codellama' },
            { name: 'mistral' },
          ],
        }),
      });

      const models = await provider.getModels();

      expect(models).toEqual(['llama3.1', 'codellama', 'mistral']);
    });

    it('should return empty array on error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const models = await provider.getModels();

      expect(models).toEqual([]);
    });

    it('should return empty array on non-ok response', async () => {
      mockFetch.mockResolvedValue({ ok: false });

      const models = await provider.getModels();

      expect(models).toEqual([]);
    });

    it('should handle missing models array', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      const models = await provider.getModels();

      expect(models).toEqual([]);
    });

    it('should use /api/tags endpoint', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ models: [] }),
      });

      await provider.getModels();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('dispose', () => {
    it('should set ready to false', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.1' }] }),
        });

      await provider.initialize({});
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

    it('should be safe to call multiple times', () => {
      expect(() => {
        provider.dispose();
        provider.dispose();
        provider.dispose();
      }).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    beforeEach(async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.1' }] }),
        });

      await provider.initialize({});
      mockFetch.mockClear();
    });

    it('should handle empty messages array', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { content: 'Empty' },
          model: 'llama3.1',
        }),
      });

      const response = await provider.complete([]);

      expect(response.content).toBe('Empty');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(provider.complete([
        { role: 'user', content: 'Hello' },
      ])).rejects.toThrow('Network error');
    });

    it('should handle very long responses', async () => {
      const longContent = 'a'.repeat(10000);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { content: longContent },
          model: 'llama3.1',
        }),
      });

      const response = await provider.complete([
        { role: 'user', content: 'Generate long text' },
      ]);

      expect(response.content).toHaveLength(10000);
    });

    it('should handle unicode content', async () => {
      const unicodeContent = 'Hello! Here is some Unicode: \u4e2d\u6587 \ud83d\ude00 \u00e9\u00e8';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { content: unicodeContent },
          model: 'llama3.1',
        }),
      });

      const response = await provider.complete([
        { role: 'user', content: 'Unicode test' },
      ]);

      expect(response.content).toBe(unicodeContent);
    });

    it('should use config values when options not provided', async () => {
      mockFetch.mockClear();
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'custom-model' }] }),
        });

      const configuredProvider = new OllamaProvider();
      await configuredProvider.initialize({
        model: 'custom-model',
        temperature: 0.9,
        maxTokens: 4096,
      });

      mockFetch.mockClear();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { content: 'Response' },
          model: 'custom-model',
        }),
      });

      await configuredProvider.complete([{ role: 'user', content: 'Hello' }]);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.model).toBe('custom-model');
      expect(callBody.options.temperature).toBe(0.9);
      expect(callBody.options.num_predict).toBe(4096);

      configuredProvider.dispose();
    });
  });
});
