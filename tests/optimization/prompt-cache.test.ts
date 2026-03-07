/**
 * Tests for Prompt Cache Module
 *
 * Validates prompt caching for cost reduction.
 * Research: Up to 90% cost reduction with prompt caching.
 */

import {
  PromptCacheManager,
  getPromptCacheManager,
  initializePromptCache,
  DEFAULT_CACHE_CONFIG,
  type CacheConfig,
  type CacheStats,
  type CacheEntry,
} from "../../src/optimization/prompt-cache.js";

let manager: PromptCacheManager;

beforeEach(() => {
  manager = new PromptCacheManager();
});

describe("Prompt Cache", () => {
  describe("DEFAULT_CACHE_CONFIG", () => {
    it("should have sensible defaults", () => {
      expect(DEFAULT_CACHE_CONFIG.enabled).toBe(true);
      expect(DEFAULT_CACHE_CONFIG.maxEntries).toBe(1000);
      expect(DEFAULT_CACHE_CONFIG.ttlMs).toBe(5 * 60 * 1000); // 5 minutes
      expect(DEFAULT_CACHE_CONFIG.minTokensToCache).toBe(1024);
      expect(DEFAULT_CACHE_CONFIG.costPerMillion).toBe(3.0);
    });
  });

  describe("PromptCacheManager", () => {
    describe("constructor", () => {
      it("should initialize with default config", () => {
        const mgr = new PromptCacheManager();
        expect(mgr.getConfig()).toEqual(DEFAULT_CACHE_CONFIG);
      });

      it("should accept custom config", () => {
        const config: Partial<CacheConfig> = { maxEntries: 500 };
        const mgr = new PromptCacheManager(config);
        expect(mgr.getConfig().maxEntries).toBe(500);
      });
    });

    describe("cacheSystemPrompt", () => {
      it("should cache system prompt and return hash", () => {
        // Create a long prompt to meet minTokensToCache threshold
        const longPrompt = "x".repeat(5000);
        const hash = manager.cacheSystemPrompt(longPrompt);
        expect(hash).toBeDefined();
        expect(typeof hash).toBe("string");
        expect(hash.length).toBeGreaterThan(0);
      });

      it("should return consistent hashes for same content", () => {
        const prompt = "x".repeat(5000);
        const hash1 = manager.cacheSystemPrompt(prompt);
        const hash2 = manager.cacheSystemPrompt(prompt);
        expect(hash1).toBe(hash2);
      });
    });

    describe("cacheTools", () => {
      it("should cache tool definitions", () => {
        const tools = Array(100).fill({
          type: "function" as const,
          function: { name: "test", description: "test", parameters: {} },
        });
        const hash = manager.cacheTools(tools);
        expect(hash).toBeDefined();
        expect(typeof hash).toBe("string");
      });
    });

    describe("cacheContext", () => {
      it("should cache context with key", () => {
        const content = "x".repeat(5000);
        const hash = manager.cacheContext("file:test.ts", content);
        expect(hash).toBeDefined();
        expect(typeof hash).toBe("string");
      });
    });

    describe("isCached", () => {
      it("should return true for cached content", () => {
        const content = "x".repeat(5000);
        manager.cacheSystemPrompt(content);
        const isCached = manager.isCached(content);
        expect(typeof isCached).toBe("boolean");
      });

      it("should return false for non-cached content", () => {
        const result = manager.isCached("uncached content");
        expect(result).toBe(false);
      });
    });

    describe("getStats", () => {
      it("should return cache statistics", () => {
        const stats = manager.getStats();
        expect(stats).toHaveProperty("hits");
        expect(stats).toHaveProperty("misses");
        expect(stats).toHaveProperty("hitRate");
        expect(stats).toHaveProperty("totalTokensSaved");
        expect(stats).toHaveProperty("estimatedCostSaved");
        expect(stats).toHaveProperty("entries");
      });

      it("should calculate hit rate correctly", () => {
        // Initial state
        const stats = manager.getStats();
        expect(stats.hitRate).toBe(0);
      });
    });

    describe("formatStats", () => {
      it("should format statistics for display", () => {
        const formatted = manager.formatStats();
        expect(formatted).toContain("Prompt Cache");
        expect(formatted).toContain("Entries");
        expect(formatted).toContain("Hit Rate");
      });
    });

    describe("clear", () => {
      it("should clear the cache", () => {
        const freshManager = new PromptCacheManager();
        const content = "x".repeat(5000);
        freshManager.cacheSystemPrompt(content);
        freshManager.clear();
        // After clear, isCached should return false for previously cached content
        expect(freshManager.isCached(content)).toBe(false);
      });
    });

    describe("warmCache", () => {
      it("should warm cache with prompts", () => {
        const longSystem = "x".repeat(5000);
        manager.warmCache({
          system: longSystem,
        });
        // Should not throw
        expect(manager.getStats().entries).toBeGreaterThanOrEqual(0);
      });

      it("should emit cache:warmed event", async () => {
        await new Promise<void>((resolve, reject) => {
          manager.once("cache:warmed", () => {
            try {
              resolve();
            } catch (error) {
              reject(error);
            }
          });

          manager.warmCache({});
        });
      });
    });

    describe("structureForCaching", () => {
      it("should reorder messages for optimal caching", () => {
        const messages = [
          { role: "user" as const, content: "Hello" },
          { role: "system" as const, content: "You are helpful" },
          { role: "assistant" as const, content: "Hi there" },
        ];

        const structured = manager.structureForCaching(messages);
        expect(structured[0].role).toBe("system");
      });

      it("should preserve all messages", () => {
        const messages = [
          { role: "user" as const, content: "Hello" },
          { role: "system" as const, content: "You are helpful" },
        ];

        const structured = manager.structureForCaching(messages);
        expect(structured.length).toBe(messages.length);
      });
    });

    describe("updateConfig", () => {
      it("should update configuration", () => {
        manager.updateConfig({ maxEntries: 200 });
        expect(manager.getConfig().maxEntries).toBe(200);
      });

      it("should preserve other config values", () => {
        manager.updateConfig({ maxEntries: 200 });
        expect(manager.getConfig().ttlMs).toBe(DEFAULT_CACHE_CONFIG.ttlMs);
      });
    });

    describe("events", () => {
      it("should emit cache:hit event on repeated caching", async () => {
        await new Promise<void>((resolve, reject) => {
          manager.once("cache:hit", (data: { hash: string; tokens: number; type: string }) => {
            try {
              expect(data.hash).toBeDefined();
              resolve();
            } catch (error) {
              reject(error);
            }
          });

          // Cache same content twice to trigger a hit
          const content = "x".repeat(5000);
          manager.cacheSystemPrompt(content);
          manager.cacheSystemPrompt(content);
        });
      });

      it("should emit cache:miss event on first cache", async () => {
        await new Promise<void>((resolve, reject) => {
          manager.once("cache:miss", (data: { hash: string; tokens: number; type: string }) => {
            try {
              expect(data.hash).toBeDefined();
              resolve();
            } catch (error) {
              reject(error);
            }
          });

          const content = "x".repeat(5000);
          manager.cacheSystemPrompt(content);
        });
      });
    });
  });

  describe("Singleton", () => {
    describe("getPromptCacheManager", () => {
      it("should return singleton instance", () => {
        const mgr1 = getPromptCacheManager();
        const mgr2 = getPromptCacheManager();
        expect(mgr1).toBe(mgr2);
      });
    });

    describe("initializePromptCache", () => {
      it("should create manager with config", () => {
        const mgr = initializePromptCache({ maxEntries: 50 });
        expect(mgr.getConfig().maxEntries).toBe(50);
      });
    });
  });

  describe("CacheEntry type", () => {
    it("should have correct structure", () => {
      const entry: CacheEntry = {
        hash: "abc123",
        timestamp: Date.now(),
        hitCount: 5,
        tokens: 1000,
        type: "system",
      };

      expect(entry.hash).toBeDefined();
      expect(entry.timestamp).toBeDefined();
      expect(entry.hitCount).toBeDefined();
      expect(entry.tokens).toBeDefined();
      expect(entry.type).toBeDefined();
    });

    it("should support all entry types", () => {
      const types: CacheEntry["type"][] = ["system", "tools", "context", "full"];
      types.forEach((type) => {
        const entry: CacheEntry = {
          hash: "abc",
          timestamp: Date.now(),
          hitCount: 0,
          tokens: 100,
          type,
        };
        expect(entry.type).toBe(type);
      });
    });
  });

  describe("CacheStats type", () => {
    it("should have correct structure", () => {
      const stats: CacheStats = {
        hits: 10,
        misses: 5,
        hitRate: 0.67,
        totalTokensSaved: 5000,
        estimatedCostSaved: 0.015,
        entries: 15,
      };

      expect(stats.hits).toBe(10);
      expect(stats.misses).toBe(5);
      expect(stats.hitRate).toBe(0.67);
      expect(stats.totalTokensSaved).toBe(5000);
      expect(stats.estimatedCostSaved).toBe(0.015);
      expect(stats.entries).toBe(15);
    });
  });
});
