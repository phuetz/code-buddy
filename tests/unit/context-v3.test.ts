import { ContextManagerV3, createContextManager } from '../../src/context/context-manager-v3.js';
import { createTokenCounter } from '../../src/context/token-counter.js';
import { ContextCompressor } from '../../src/context/compression.js';
import { CodeBuddyMessage } from '../../src/codebuddy/client.js';

// Mock logger
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock tiktoken (optional, but good for consistent testing environment)
// But wait, our token-counter.ts handles the fallback logic internally. 
// We will test the integrated behavior.

describe('ContextManagerV3', () => {
  let manager: ContextManagerV3;

  beforeEach(() => {
    manager = new ContextManagerV3({
      maxContextTokens: 100, // Small limit for easy testing
      responseReserveTokens: 20,
      recentMessagesCount: 2,
      model: 'gpt-4'
    });
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('Stats & Warning', () => {
    it('should calculate stats correctly', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'hello' }
      ];
      const stats = manager.getStats(messages);
      
      expect(stats.totalTokens).toBeGreaterThan(0);
      expect(stats.maxTokens).toBe(100);
      expect(stats.messageCount).toBe(1);
    });

    it('should trigger warnings', () => {
      // Create enough messages to trigger warning
      const longText = 'word '.repeat(20); // ~20 tokens + overhead
      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: longText },
        { role: 'assistant', content: longText },
        { role: 'user', content: longText },
        { role: 'assistant', content: longText } 
      ];
      // total ~80+ tokens, limit 100. 80% threshold.

      const warning = manager.shouldWarn(messages);
      expect(warning.warn).toBe(true);
      expect(warning.percentage).toBeGreaterThanOrEqual(80);
    });
  });

  describe('Compression', () => {
    it('should compress when over limit', () => {
      // Limit is 100, effective is 80.
      const longText = 'word '.repeat(50); // ~50 tokens
      const messages: CodeBuddyMessage[] = [
        { role: 'system', content: 'sys' }, // ~4
        { role: 'user', content: longText }, // ~53
        { role: 'assistant', content: longText }, // ~53
        { role: 'user', content: 'recent' } // ~4
      ];
      // Total > 110. Should compress.

      const prepared = manager.prepareMessages(messages);
      
      // Should preserve system and recent
      expect(prepared[0].role).toBe('system');
      expect(prepared[prepared.length - 1].content).toBe('recent');
      
      // Middle messages should be truncated/removed
      const stats = manager.getStats(prepared);
      expect(stats.totalTokens).toBeLessThanOrEqual(80);
    });

    it('should preserve system prompt', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'system', content: 'IMPORTANT SYSTEM PROMPT' },
        { role: 'user', content: 'word '.repeat(100) }, // Huge message
        { role: 'user', content: 'recent' }
      ];

      const prepared = manager.prepareMessages(messages);
      expect(prepared[0].content).toBe('IMPORTANT SYSTEM PROMPT');
    });
  });
});

describe('TokenCounter', () => {
  const counter = createTokenCounter('gpt-4');

  it('should count tokens accurately', () => {
    const count = counter.countTokens('hello world');
    expect(count).toBeGreaterThan(0);
  });

  it('should handle streaming estimation', () => {
    const count = counter.estimateStreamingTokens('hello');
    expect(count).toBe(counter.countTokens('hello'));
  });
});

describe('ContextCompressor', () => {
  const counter = createTokenCounter('gpt-4');
  const compressor = new ContextCompressor(counter);

  it('should truncate tool outputs', () => {
    const hugeToolOutput = 'The quick brown fox jumps over the lazy dog. '.repeat(100);
    const messages: CodeBuddyMessage[] = [
      { role: 'tool', content: hugeToolOutput, tool_call_id: 'call_123' }
    ];

    // 100 reps * ~10 tokens = ~1000 tokens
    // Truncated to 500 chars ~ 100-150 tokens
    // Limit 500 should trigger compression but fit tool truncation
    const result = compressor.compress(messages, 500, { preserveRecentMessages: 0 });
    
    expect(result.compressed).toBe(true);
    expect(result.strategy).toBe('tool_truncation');
    expect((result.messages[0].content as string).endsWith('[truncated]')).toBe(true);
  });
});
