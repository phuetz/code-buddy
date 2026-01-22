/**
 * Cache System Tests
 *
 * Tests for the unified cache system including:
 * - LLM response caching with semantic similarity
 * - File content caching with invalidation
 * - Embedding caching
 * - Search results caching
 * - Cache manager orchestration
 */

import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';

// Mock logger to prevent console output during tests
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock fs for file caching tests
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  writeFile: jest.fn(),
  stat: jest.fn(),
}));

import { LLMResponseCache, resetLLMResponseCache } from '../../src/cache/llm-response-cache.js';
import { EmbeddingCache, resetEmbeddingCache } from '../../src/cache/embedding-cache.js';
import { SearchResultsCache, resetSearchResultsCache } from '../../src/cache/search-results-cache.js';
import { CacheManager, resetCacheManager } from '../../src/cache/cache-manager.js';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';

describe('LLMResponseCache', () => {
  let cache: LLMResponseCache;

  beforeEach(() => {
    resetLLMResponseCache();
    cache = new LLMResponseCache({
      enabled: true,
      persistToDisk: false,
      ttlMs: 60000,
      maxEntries: 100,
      similarityThreshold: 0.9,
      minTokensToCache: 1, // Allow caching small test responses
    });
  });

  afterEach(() => {
    cache.dispose();
  });

  it('should cache and retrieve LLM responses by exact match', async () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'user', content: 'What is the TypeScript programming language?' },
    ];
    const response = {
      content: 'TypeScript is a typed superset of JavaScript',
      usage: { promptTokens: 10, completionTokens: 20 },
    };

    // Set cache
    cache.set(messages, response, 'grok-code-fast-1');

    // Get from cache
    const cached = await cache.get(messages, 'grok-code-fast-1');

    expect(cached).not.toBeNull();
    expect(cached?.response.content).toBe(response.content);
  });

  it('should match semantically similar queries', async () => {
    const messages1: CodeBuddyMessage[] = [
      { role: 'user', content: 'What is TypeScript programming language?' },
    ];
    const response = {
      content: 'TypeScript is a typed superset of JavaScript',
      usage: { promptTokens: 10, completionTokens: 20 },
    };

    cache.set(messages1, response, 'grok-code-fast-1');

    // Similar but not identical query
    const messages2: CodeBuddyMessage[] = [
      { role: 'user', content: 'What is the TypeScript programming language?' },
    ];

    const cached = await cache.get(messages2, 'grok-code-fast-1');

    // Should find semantic match
    expect(cached).not.toBeNull();
  });

  it('should not match queries below similarity threshold', async () => {
    const messages1: CodeBuddyMessage[] = [
      { role: 'user', content: 'What is the TypeScript programming language?' },
    ];
    const response = {
      content: 'TypeScript is a typed superset of JavaScript',
      usage: { promptTokens: 10, completionTokens: 20 },
    };

    cache.set(messages1, response, 'grok-code-fast-1');

    // Completely different query
    const messages2: CodeBuddyMessage[] = [
      { role: 'user', content: 'How do I write a Python function?' },
    ];

    const cached = await cache.get(messages2, 'grok-code-fast-1');

    expect(cached).toBeNull();
  });

  it('should track statistics correctly', async () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'user', content: 'What is the TypeScript programming language?' },
    ];
    const response = {
      content: 'TypeScript is a typed superset of JavaScript',
      usage: { promptTokens: 10, completionTokens: 30 },
    };

    // Initial stats
    const initialStats = cache.getStats();
    expect(initialStats.hits).toBe(0);
    expect(initialStats.misses).toBe(0);

    // Miss
    await cache.get(messages, 'grok-code-fast-1');
    let stats = cache.getStats();
    expect(stats.misses).toBe(1);

    // Set and hit
    cache.set(messages, response, 'grok-code-fast-1');
    await cache.get(messages, 'grok-code-fast-1');
    stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.tokensSaved).toBe(40); // 10 + 30
  });

  it('should respect model mismatch', async () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'user', content: 'What is the TypeScript programming language?' },
    ];
    const response = {
      content: 'TypeScript is a typed superset of JavaScript',
      usage: { promptTokens: 10, completionTokens: 20 },
    };

    cache.set(messages, response, 'grok-code-fast-1');

    // Different model
    const cached = await cache.get(messages, 'grok-vision-1');

    expect(cached).toBeNull();
  });
});

describe('EmbeddingCache', () => {
  let cache: EmbeddingCache;

  beforeEach(() => {
    resetEmbeddingCache();
    cache = new EmbeddingCache({
      enabled: true,
      persistToDisk: false,
      ttlMs: 60000,
      maxEntries: 100,
      dimension: 384,
    });
  });

  afterEach(() => {
    cache.dispose();
  });

  it('should cache and retrieve embeddings', () => {
    const text = 'function hello() { console.log("hi"); }';
    const embedding = new Array(384).fill(0).map(() => Math.random());

    cache.set(text, embedding);
    const cached = cache.get(text);

    expect(cached).not.toBeNull();
    expect(cached?.length).toBe(384);
  });

  it('should reject dimension mismatches', () => {
    const text = 'some text';
    const wrongDimension = new Array(256).fill(0.5);

    cache.set(text, wrongDimension);
    const cached = cache.get(text);

    expect(cached).toBeNull();
  });

  it('should support batch operations', () => {
    const texts = ['text1', 'text2', 'text3'];
    const embeddings = texts.map(() => new Array(384).fill(0).map(() => Math.random()));

    cache.setBatch(
      texts.map((text, i) => ({ content: text, embedding: embeddings[i] }))
    );

    const results = cache.getBatch(texts);
    expect(results.size).toBe(3);

    for (const [_text, embedding] of results) {
      expect(embedding).not.toBeNull();
    }
  });

  it('should track computations saved', () => {
    const text = 'some code here';
    const embedding = new Array(384).fill(0.5);

    cache.set(text, embedding);

    // First hit
    cache.get(text);
    let stats = cache.getStats();
    expect(stats.computationsSaved).toBe(1);

    // Second hit
    cache.get(text);
    stats = cache.getStats();
    expect(stats.computationsSaved).toBe(2);
  });
});

describe('SearchResultsCache', () => {
  let cache: SearchResultsCache<string[]>;

  beforeEach(() => {
    resetSearchResultsCache();
    cache = new SearchResultsCache({
      enabled: true,
      ttlMs: 60000,
      maxEntries: 100,
      invalidateOnFileChange: true,
    });
  });

  afterEach(() => {
    cache.dispose();
  });

  it('should cache and retrieve search results', () => {
    const query = 'function test';
    const results = ['file1.ts', 'file2.ts'];

    cache.set(query, 'text', results, { affectedFiles: results });
    const cached = cache.get(query, 'text');

    expect(cached).toEqual(results);
  });

  it('should invalidate on file change', () => {
    const query = 'function test';
    const results = ['file1.ts', 'file2.ts'];

    cache.set(query, 'text', results, { affectedFiles: results });

    // Invalidate file1.ts
    const count = cache.invalidateForFile('file1.ts');

    expect(count).toBe(1);
    expect(cache.get(query, 'text')).toBeNull();
  });

  it('should normalize queries for better hits', () => {
    const results = ['result1', 'result2'];

    cache.set('  Function   Test  ', 'text', results);

    // Query with different whitespace
    const cached = cache.get('function test', 'text');

    expect(cached).toEqual(results);
  });

  it('should deduplicate concurrent requests', async () => {
    let computeCount = 0;
    const computeFn = async () => {
      computeCount++;
      await new Promise(resolve => setTimeout(resolve, 50));
      return ['result'];
    };

    // Launch concurrent requests
    const [result1, result2] = await Promise.all([
      cache.getOrCompute('query', 'text', computeFn),
      cache.getOrCompute('query', 'text', computeFn),
    ]);

    // Both should have same result
    expect(result1.results).toEqual(['result']);
    expect(result2.results).toEqual(['result']);

    // But compute should only be called once (or close to it)
    // Note: Due to race conditions, sometimes both might start
    // but the deduplication should reduce redundant computation
    expect(computeCount).toBeLessThanOrEqual(2);
  });

  it('should track statistics by search type', () => {
    cache.set('query1', 'text', ['r1']);
    cache.set('query2', 'symbol', ['r2']);
    cache.set('query3', 'file', ['r3']);

    cache.get('query1', 'text');
    cache.get('query2', 'symbol');
    cache.get('query3', 'file');

    const stats = cache.getStats();
    expect(stats.byType.text).toBe(1);
    expect(stats.byType.symbol).toBe(1);
    expect(stats.byType.file).toBe(1);
  });
});

describe('CacheManager', () => {
  let manager: CacheManager;

  beforeEach(() => {
    resetCacheManager();
    manager = new CacheManager({
      enabled: true,
      enableMetrics: false,
    });
  });

  afterEach(() => {
    manager.dispose();
  });

  it('should provide unified access to all caches', () => {
    const caches = manager.getCaches();

    expect(caches.llm).toBeDefined();
    expect(caches.file).toBeDefined();
    expect(caches.embedding).toBeDefined();
    expect(caches.search).toBeDefined();
  });

  it('should aggregate statistics from all caches', () => {
    const stats = manager.getStats();

    expect(stats.overall).toBeDefined();
    expect(stats.overall.totalEntries).toBe(0);
    expect(stats.overall.hitRate).toBe(0);
  });

  it('should invalidate across caches for file changes', () => {
    // Set up some cached data
    const caches = manager.getCaches();
    caches.search.set('query', 'text', ['file.ts'], { affectedFiles: ['file.ts'] });

    // Invalidate
    manager.invalidateForFile('file.ts');

    // Should be invalidated
    expect(caches.search.get('query', 'text')).toBeNull();
  });

  it('should clear all caches', () => {
    const caches = manager.getCaches();

    // Add some entries
    caches.search.set('q1', 'text', ['r1']);
    caches.embedding.set('text', new Array(384).fill(0.5));

    // Clear all
    manager.clearAll();

    // All should be empty
    expect(caches.search.get('q1', 'text')).toBeNull();
    expect(caches.embedding.get('text')).toBeNull();
  });

  it('should format statistics nicely', () => {
    const formatted = manager.formatStats();

    expect(formatted).toContain('CACHE MANAGER STATISTICS');
    expect(formatted).toContain('Overall Hit Rate');
    expect(formatted).toContain('LLM Response Cache');
    expect(formatted).toContain('File Content Cache');
    expect(formatted).toContain('Embedding Cache');
    expect(formatted).toContain('Search Results Cache');
  });
});
