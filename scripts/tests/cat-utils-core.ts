/**
 * Cat 54: Token Counter (6 tests, no API)
 * Cat 55: Retry Utility (7 tests, no API)
 * Cat 56: LRU Cache (7 tests, no API)
 * Cat 57: Fuzzy Match (5 tests, no API)
 */

import type { TestDef } from './types.js';

// ============================================================================
// Cat 54: Token Counter
// ============================================================================

export function cat54TokenCounter(): TestDef[] {
  return [
    {
      name: '54.1-create-token-counter',
      timeout: 5000,
      fn: async () => {
        const { createTokenCounter } = await import('../../src/utils/token-counter.js');
        const counter = createTokenCounter('gpt-4');
        return { pass: counter !== undefined };
      },
    },
    {
      name: '54.2-count-tokens-string',
      timeout: 5000,
      fn: async () => {
        const { createTokenCounter } = await import('../../src/utils/token-counter.js');
        const counter = createTokenCounter();
        const count = counter.countTokens('Hello, this is a test string for token counting.');
        return {
          pass: count > 0 && count < 100,
          metadata: { count },
        };
      },
    },
    {
      name: '54.3-count-tokens-empty',
      timeout: 5000,
      fn: async () => {
        const { createTokenCounter } = await import('../../src/utils/token-counter.js');
        const counter = createTokenCounter();
        const count = counter.countTokens('');
        return { pass: count === 0 };
      },
    },
    {
      name: '54.4-count-message-tokens',
      timeout: 5000,
      fn: async () => {
        const { createTokenCounter } = await import('../../src/utils/token-counter.js');
        const counter = createTokenCounter();
        const count = counter.countMessageTokens([
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ]);
        return {
          pass: count > 0 && count < 500,
          metadata: { count },
        };
      },
    },
    {
      name: '54.5-format-token-count',
      timeout: 5000,
      fn: async () => {
        const { formatTokenCount } = await import('../../src/utils/token-counter.js');
        return {
          pass: formatTokenCount(500) === '500' &&
                formatTokenCount(1000) === '1k' &&
                formatTokenCount(1500) === '1.5k' &&
                formatTokenCount(1000000) === '1m',
          metadata: {
            r500: formatTokenCount(500),
            r1000: formatTokenCount(1000),
            r1500: formatTokenCount(1500),
            r1m: formatTokenCount(1000000),
          },
        };
      },
    },
    {
      name: '54.6-estimate-streaming-tokens',
      timeout: 5000,
      fn: async () => {
        const { createTokenCounter } = await import('../../src/utils/token-counter.js');
        const counter = createTokenCounter();
        const est = counter.estimateStreamingTokens('accumulated streaming content here');
        return {
          pass: est > 0,
          metadata: { estimate: est },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 55: Retry Utility
// ============================================================================

export function cat55RetryUtility(): TestDef[] {
  return [
    {
      name: '55.1-retry-succeeds-first-try',
      timeout: 5000,
      fn: async () => {
        const { retry } = await import('../../src/utils/retry.js');
        let callCount = 0;
        const result = await retry(async () => {
          callCount++;
          return 'success';
        }, { maxRetries: 3 });
        return {
          pass: result === 'success' && callCount === 1,
          metadata: { callCount },
        };
      },
    },
    {
      name: '55.2-retry-succeeds-after-failures',
      timeout: 10000,
      fn: async () => {
        const { retry } = await import('../../src/utils/retry.js');
        let callCount = 0;
        const result = await retry(async () => {
          callCount++;
          if (callCount < 3) throw new Error('transient');
          return 'recovered';
        }, { maxRetries: 5, baseDelay: 50, jitter: false });
        return {
          pass: result === 'recovered' && callCount === 3,
          metadata: { callCount },
        };
      },
    },
    {
      name: '55.3-retry-exhausted-throws',
      timeout: 10000,
      fn: async () => {
        const { retry } = await import('../../src/utils/retry.js');
        try {
          await retry(async () => {
            throw new Error('permanent');
          }, { maxRetries: 2, baseDelay: 50, jitter: false });
          return { pass: false, metadata: { reason: 'should have thrown' } };
        } catch (e: any) {
          return {
            pass: e.message === 'permanent',
            metadata: { error: e.message },
          };
        }
      },
    },
    {
      name: '55.4-retry-isRetryable-filter',
      timeout: 5000,
      fn: async () => {
        const { retry } = await import('../../src/utils/retry.js');
        let callCount = 0;
        try {
          await retry(async () => {
            callCount++;
            throw new Error('non-retryable');
          }, {
            maxRetries: 5,
            baseDelay: 50,
            isRetryable: (err: any) => !err.message.includes('non-retryable'),
          });
          return { pass: false };
        } catch {
          return {
            pass: callCount === 1,
            metadata: { callCount },
          };
        }
      },
    },
    {
      name: '55.5-retry-onRetry-callback',
      timeout: 10000,
      fn: async () => {
        const { retry } = await import('../../src/utils/retry.js');
        const retryAttempts: number[] = [];
        let callCount = 0;
        await retry(async () => {
          callCount++;
          if (callCount < 3) throw new Error('fail');
          return 'ok';
        }, {
          maxRetries: 5,
          baseDelay: 50,
          jitter: false,
          onRetry: (_err, attempt) => { retryAttempts.push(attempt); },
        });
        return {
          pass: retryAttempts.length === 2,
          metadata: { retryAttempts },
        };
      },
    },
    {
      name: '55.6-retry-abort-signal',
      timeout: 5000,
      fn: async () => {
        const { retry } = await import('../../src/utils/retry.js');
        const controller = new AbortController();
        controller.abort();
        try {
          await retry(async () => 'should not reach', {
            maxRetries: 3,
            signal: controller.signal,
          });
          return { pass: false };
        } catch (e: any) {
          return {
            pass: e.message.includes('abort'),
            metadata: { error: e.message },
          };
        }
      },
    },
    {
      name: '55.7-retry-timeout',
      timeout: 10000,
      fn: async () => {
        const { retry } = await import('../../src/utils/retry.js');
        try {
          await retry(async () => {
            await new Promise(r => setTimeout(r, 200));
            throw new Error('slow');
          }, { maxRetries: 100, baseDelay: 50, timeout: 300, jitter: false });
          return { pass: false };
        } catch (e: any) {
          return {
            pass: e.message.includes('timeout') || e.message === 'slow',
            metadata: { error: e.message },
          };
        }
      },
    },
  ];
}

// ============================================================================
// Cat 56: LRU Cache
// ============================================================================

export function cat56LRUCache(): TestDef[] {
  return [
    {
      name: '56.1-basic-set-get',
      timeout: 5000,
      fn: async () => {
        const { LRUCache } = await import('../../src/utils/lru-cache.js');
        const cache = new LRUCache<string>({ maxSize: 10 });
        cache.set('key1', 'value1');
        const val = cache.get('key1');
        return {
          pass: val === 'value1',
          metadata: { val },
        };
      },
    },
    {
      name: '56.2-eviction-on-max-size',
      timeout: 5000,
      fn: async () => {
        const { LRUCache } = await import('../../src/utils/lru-cache.js');
        const cache = new LRUCache<number>({ maxSize: 3 });
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);
        cache.set('d', 4); // Should evict 'a'
        return {
          pass: cache.get('a') === undefined && cache.get('d') === 4,
          metadata: { a: cache.get('a'), d: cache.get('d') },
        };
      },
    },
    {
      name: '56.3-lru-ordering',
      timeout: 5000,
      fn: async () => {
        const { LRUCache } = await import('../../src/utils/lru-cache.js');
        const cache = new LRUCache<number>({ maxSize: 3 });
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);
        cache.get('a'); // Touch 'a', making 'b' the LRU
        cache.set('d', 4); // Should evict 'b'
        return {
          pass: cache.get('a') === 1 && cache.get('b') === undefined && cache.get('d') === 4,
        };
      },
    },
    {
      name: '56.4-delete-entry',
      timeout: 5000,
      fn: async () => {
        const { LRUCache } = await import('../../src/utils/lru-cache.js');
        const cache = new LRUCache<string>({ maxSize: 10 });
        cache.set('x', 'hello');
        const deleted = cache.delete('x');
        const val = cache.get('x');
        return {
          pass: deleted === true && val === undefined,
        };
      },
    },
    {
      name: '56.5-cache-stats',
      timeout: 5000,
      fn: async () => {
        const { LRUCache } = await import('../../src/utils/lru-cache.js');
        const cache = new LRUCache<number>({ maxSize: 10 });
        cache.set('a', 1);
        cache.set('b', 2);
        cache.get('a'); // hit
        cache.get('missing'); // miss
        const stats = cache.getStats();
        return {
          pass: stats.size === 2 && stats.hits >= 1 && stats.misses >= 1,
          metadata: { size: stats.size, hits: stats.hits, misses: stats.misses },
        };
      },
    },
    {
      name: '56.6-clear-cache',
      timeout: 5000,
      fn: async () => {
        const { LRUCache } = await import('../../src/utils/lru-cache.js');
        const cache = new LRUCache<number>({ maxSize: 10 });
        cache.set('a', 1);
        cache.set('b', 2);
        cache.clear();
        const stats = cache.getStats();
        return {
          pass: stats.size === 0 && cache.get('a') === undefined,
        };
      },
    },
    {
      name: '56.7-has-method',
      timeout: 5000,
      fn: async () => {
        const { LRUCache } = await import('../../src/utils/lru-cache.js');
        const cache = new LRUCache<string>({ maxSize: 10 });
        cache.set('exists', 'yes');
        return {
          pass: cache.has('exists') === true && cache.has('nope') === false,
        };
      },
    },
  ];
}

// ============================================================================
// Cat 57: Fuzzy Match
// ============================================================================

export function cat57FuzzyMatch(): TestDef[] {
  return [
    {
      name: '57.1-exact-match-similarity-1',
      timeout: 5000,
      fn: async () => {
        const { calculateSimilarity } = await import('../../src/utils/fuzzy-match.js');
        const sim = calculateSimilarity('hello world', 'hello world');
        return { pass: sim === 1.0, metadata: { similarity: sim } };
      },
    },
    {
      name: '57.2-empty-string-similarity-0',
      timeout: 5000,
      fn: async () => {
        const { calculateSimilarity } = await import('../../src/utils/fuzzy-match.js');
        const sim = calculateSimilarity('hello', '');
        return { pass: sim === 0.0, metadata: { similarity: sim } };
      },
    },
    {
      name: '57.3-similar-strings-high-score',
      timeout: 5000,
      fn: async () => {
        const { calculateSimilarity } = await import('../../src/utils/fuzzy-match.js');
        const sim = calculateSimilarity('function hello()', 'function helo()');
        return {
          pass: sim > 0.8 && sim < 1.0,
          metadata: { similarity: sim },
        };
      },
    },
    {
      name: '57.4-very-different-strings-low-score',
      timeout: 5000,
      fn: async () => {
        const { calculateSimilarity } = await import('../../src/utils/fuzzy-match.js');
        const sim = calculateSimilarity('abcdefg', 'xyz12345');
        return {
          pass: sim < 0.3,
          metadata: { similarity: sim },
        };
      },
    },
    {
      name: '57.5-find-fuzzy-matches',
      timeout: 5000,
      fn: async () => {
        const { findFuzzyMatches } = await import('../../src/utils/fuzzy-match.js');
        const content = 'function hello() {\n  return "world";\n}\n\nfunction goodbye() {\n  return "bye";\n}';
        const results = findFuzzyMatches(content, 'function helo()', { threshold: 0.7, maxResults: 3 });
        return {
          pass: results.length >= 1 && results[0].similarity > 0.7,
          metadata: { count: results.length, topSim: results[0]?.similarity },
        };
      },
    },
  ];
}
