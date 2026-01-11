/**
 * Unit tests for PromptCacheManager
 */

import { PromptCacheManager } from '../../src/optimization/prompt-cache';
import { CodeBuddyTool } from '../../src/codebuddy/client';

describe('PromptCacheManager', () => {
  let cacheManager: PromptCacheManager;

  beforeEach(() => {
    cacheManager = new PromptCacheManager({
      enabled: true,
      maxEntries: 10,
      ttlMs: 60000,
      minTokensToCache: 1, // Set low for testing
    });
  });

  describe('Caching', () => {
    it('should cache system prompt', () => {
      const prompt = 'System prompt content';
      const hash = cacheManager.cacheSystemPrompt(prompt);
      
      expect(hash).toBeDefined();
      expect(cacheManager.isCached(prompt)).toBe(true);
      expect(cacheManager.getStats().entries).toBe(1);
    });

    it('should cache tools', () => {
      const tools: CodeBuddyTool[] = [{
        type: 'function',
        function: {
          name: 'test',
          description: 'test',
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      }];

      const hash = cacheManager.cacheTools(tools);

      expect(hash).toBeDefined();
      expect(cacheManager.getStats().entries).toBe(1);
    });

    it('should cache context', () => {
      const key = 'file.ts';
      const content = 'file content';
      
      const hash = cacheManager.cacheContext(key, content);
      
      expect(hash).toBeDefined();
      expect(cacheManager.isCached(content)).toBe(true);
    });
  });

  describe('Eviction', () => {
    it('should evict LRU entries', () => {
      const smallCache = new PromptCacheManager({
        enabled: true,
        maxEntries: 2,
        minTokensToCache: 0,
      });

      smallCache.cacheSystemPrompt('prompt 1');
      smallCache.cacheSystemPrompt('prompt 2');
      smallCache.cacheSystemPrompt('prompt 3');

      expect(smallCache.getStats().entries).toBe(2);
      expect(smallCache.isCached('prompt 1')).toBe(false); // Evicted
      expect(smallCache.isCached('prompt 3')).toBe(true);  // Kept
    });

    it('should evict expired entries', async () => {
      const shortCache = new PromptCacheManager({
        enabled: true,
        ttlMs: 100, // 100ms TTL
        minTokensToCache: 1,
      });

      shortCache.cacheSystemPrompt('prompt 1');
      expect(shortCache.isCached('prompt 1')).toBe(true);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));

      // Accessing again should trigger eviction check
      expect(shortCache.isCached('prompt 1')).toBe(false);
    });
  });

  describe('Structure for Caching', () => {
    it('should move system messages to the beginning', () => {
      const messages = [
        { role: 'user', content: 'hello' },
        { role: 'system', content: 'you are a bot' },
        { role: 'user', content: 'how are you?' },
      ] as any[];

      const structured = cacheManager.structureForCaching(messages);

      expect(structured[0].role).toBe('system');
      expect(structured[1].role).toBe('user');
      expect(structured[2].role).toBe('user');
    });
  });
});
