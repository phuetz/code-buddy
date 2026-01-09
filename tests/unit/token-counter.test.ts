/**
 * Tests for Token Counter
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock tiktoken
jest.mock('tiktoken', () => ({
  encoding_for_model: jest.fn(() => ({
    encode: jest.fn((text: string) => new Array(Math.ceil(text.length / 4))),
    free: jest.fn()
  })),
  get_encoding: jest.fn(() => ({
    encode: jest.fn((text: string) => new Array(Math.ceil(text.length / 4))),
    free: jest.fn()
  }))
}));

describe('TokenCounter', () => {
  let createTokenCounter: typeof import('../../src/context/token-counter.js').createTokenCounter;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await import('../../src/context/token-counter.js');
    createTokenCounter = module.createTokenCounter;
  });

  describe('createTokenCounter', () => {
    it('should create a token counter with default model', () => {
      const counter = createTokenCounter();
      expect(counter).toBeDefined();
      expect(counter.countTokens).toBeDefined();
      expect(counter.countMessageTokens).toBeDefined();
      expect(counter.estimateStreamingTokens).toBeDefined();
      expect(counter.dispose).toBeDefined();
    });

    it('should create a token counter with specific model', () => {
      const counter = createTokenCounter('gpt-4');
      expect(counter).toBeDefined();
    });
  });

  describe('countTokens', () => {
    it('should count tokens for a string', () => {
      const counter = createTokenCounter();
      const tokens = counter.countTokens('Hello, world!');
      expect(tokens).toBeGreaterThan(0);
    });

    it('should return 0 for empty string', () => {
      const counter = createTokenCounter();
      const tokens = counter.countTokens('');
      expect(tokens).toBe(0);
    });

    it('should handle long text', () => {
      const counter = createTokenCounter();
      const longText = 'a'.repeat(1000);
      const tokens = counter.countTokens(longText);
      expect(tokens).toBeGreaterThan(100);
    });
  });

  describe('countMessageTokens', () => {
    it('should count tokens for simple messages', () => {
      const counter = createTokenCounter();
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' }
      ];
      const tokens = counter.countMessageTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle messages with null content', () => {
      const counter = createTokenCounter();
      const messages = [
        { role: 'assistant', content: null, tool_calls: [{ id: '1', function: { name: 'test' } }] }
      ];
      const tokens = counter.countMessageTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle messages with content array (OpenAI format)', () => {
      const counter = createTokenCounter();
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'text', text: 'World' }
          ]
        }
      ];
      const tokens = counter.countMessageTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle empty messages array', () => {
      const counter = createTokenCounter();
      const tokens = counter.countMessageTokens([]);
      expect(tokens).toBe(3); // Just priming tokens
    });

    it('should include tool calls in count', () => {
      const counter = createTokenCounter();
      const messagesWithoutTools = [
        { role: 'assistant', content: 'Hello' }
      ];
      const messagesWithTools = [
        {
          role: 'assistant',
          content: 'Hello',
          tool_calls: [{ id: '1', function: { name: 'bash', arguments: '{"command": "ls"}' } }]
        }
      ];

      const tokensWithout = counter.countMessageTokens(messagesWithoutTools);
      const tokensWith = counter.countMessageTokens(messagesWithTools);

      expect(tokensWith).toBeGreaterThan(tokensWithout);
    });
  });

  describe('estimateStreamingTokens', () => {
    it('should estimate tokens for a chunk', () => {
      const counter = createTokenCounter();
      const tokens = counter.estimateStreamingTokens('Hello');
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('dispose', () => {
    it('should dispose without error', () => {
      const counter = createTokenCounter();
      expect(() => counter.dispose()).not.toThrow();
    });
  });
});

describe('EstimatingTokenCounter (fallback)', () => {
  let createTokenCounter: typeof import('../../src/context/token-counter.js').createTokenCounter;

  beforeEach(async () => {
    // Make tiktoken fail
    jest.resetModules();
    jest.doMock('tiktoken', () => ({
      encoding_for_model: jest.fn(() => { throw new Error('No tiktoken'); }),
      get_encoding: jest.fn(() => { throw new Error('No tiktoken'); })
    }));

    const module = await import('../../src/context/token-counter.js');
    createTokenCounter = module.createTokenCounter;
  });

  it('should fall back to estimation when tiktoken fails', () => {
    const counter = createTokenCounter();
    expect(counter).toBeDefined();

    // Estimation uses character count / 3.5
    const text = 'Hello, world!'; // 13 chars
    const tokens = counter.countTokens(text);
    expect(tokens).toBeGreaterThan(0);
  });
});
