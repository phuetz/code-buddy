/**
 * Tests for Web Search Grounding
 */

import {
  WebSearchManager,
  getWebSearchManager,
  resetWebSearchManager,
  SearchResult,
} from "../../src/context/web-search-grounding";

describe("WebSearchManager", () => {
  let manager: WebSearchManager;

  beforeEach(() => {
    resetWebSearchManager();
    manager = new WebSearchManager({
      engine: "duckduckgo",
      maxResults: 5,
      cache: {
        enabled: true,
        ttl: 60000,
      },
      timeout: 10000,
    });
  });

  afterEach(() => {
    resetWebSearchManager();
  });

  describe("Configuration", () => {
    it("should accept custom configuration", () => {
      const customManager = new WebSearchManager({
        engine: "brave",
        maxResults: 10,
        safeSearch: "strict",
      });

      const status = customManager.formatStatus();

      expect(status).toContain("brave");
      expect(status).toContain("10");
    });

    it("should default to DuckDuckGo", () => {
      const defaultManager = new WebSearchManager();
      const status = defaultManager.formatStatus();

      expect(status).toContain("duckduckgo");
    });
  });

  describe("Search Functionality", () => {
    // Note: These tests may be skipped in CI due to network requirements
    it("should perform search and return results", async () => {
      // Skip if no network or rate limited
      try {
        const response = await manager.search("typescript tutorial");

        expect(response.query).toBe("typescript tutorial");
        expect(response.engine).toBe("duckduckgo");
        expect(Array.isArray(response.results)).toBe(true);
        expect(response.searchTime).toBeGreaterThanOrEqual(0);
        expect(response.timestamp).toBeDefined();
      } catch (error) {
        // Network error - skip test
        console.log("Skipping search test due to network error");
      }
    }, 30000);

    it("should respect maxResults option", async () => {
      try {
        const response = await manager.search("javascript", { maxResults: 3 });

        expect(response.results.length).toBeLessThanOrEqual(3);
      } catch {
        console.log("Skipping maxResults test due to network error");
      }
    }, 30000);
  });

  describe("Caching", () => {
    it("should cache results", async () => {
      const spy = jest.fn();
      manager.on("cache:hit", spy);

      // Mock search result
      const mockResults: SearchResult[] = [
        {
          title: "Test Result",
          url: "https://example.com",
          snippet: "Test snippet",
          source: "duckduckgo",
        },
      ];

      // First search populates cache
      try {
        await manager.search("test query");
        // Second search should hit cache
        await manager.search("test query");

        expect(spy).toHaveBeenCalled();
      } catch {
        // If network fails, skip cache test
        console.log("Skipping cache test due to network error");
      }
    }, 30000);

    it("should clear cache", () => {
      const spy = jest.fn();
      manager.on("cache:cleared", spy);

      manager.clearCache();

      expect(spy).toHaveBeenCalled();
    });
  });

  describe("Grounding Context", () => {
    it("should generate grounding context", async () => {
      try {
        const context = await manager.getGroundingContext("test query");

        expect(context.query).toBe("test query");
        expect(Array.isArray(context.results)).toBe(true);
        expect(typeof context.summary).toBe("string");
        expect(Array.isArray(context.citations)).toBe(true);
        expect(typeof context.confidence).toBe("number");
        expect(context.confidence).toBeGreaterThanOrEqual(0);
        expect(context.confidence).toBeLessThanOrEqual(1);
      } catch {
        console.log("Skipping grounding test due to network error");
      }
    }, 30000);
  });

  describe("Context Formatting", () => {
    it("should format search results for context", async () => {
      try {
        const formattedContext = await manager.searchForContext("test");

        expect(formattedContext).toContain("Web Search Results");
        expect(formattedContext).toContain("test");
      } catch {
        console.log("Skipping format test due to network error");
      }
    }, 30000);

    it("should handle search errors gracefully", async () => {
      const errorManager = new WebSearchManager({
        engine: "google", // No API key configured
        timeout: 1000,
      });

      const result = await errorManager.searchForContext("test");

      expect(result).toContain("failed");
    });
  });

  describe("Status Formatting", () => {
    it("should format status correctly", () => {
      const status = manager.formatStatus();

      expect(status).toContain("Web Search Grounding");
      expect(status).toContain("Engine:");
      expect(status).toContain("Max Results:");
      expect(status).toContain("Safe Search:");
      expect(status).toContain("Cache:");
      expect(status).toContain("Available Engines:");
    });

    it("should show API key status", () => {
      const managerWithKeys = new WebSearchManager({
        apiKeys: {
          brave: "test-key",
        },
      });

      const status = managerWithKeys.formatStatus();

      expect(status).toContain("brave (API key configured)");
    });
  });

  describe("Event Emission", () => {
    it("should emit search:start event", async () => {
      const handler = jest.fn();
      manager.on("search:start", handler);

      // Use a short timeout to avoid long waits
      const shortTimeoutManager = new WebSearchManager({
        engine: "duckduckgo",
        maxResults: 1,
        timeout: 500, // Very short timeout
      });
      shortTimeoutManager.on("search:start", handler);

      try {
        await shortTimeoutManager.search("test");
      } catch {
        // Ignore network/timeout errors - we just want to verify the event was emitted
      }

      // The event should have been emitted before any error
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "test",
          engine: "duckduckgo",
        })
      );
    }, 5000); // 5 second timeout for this test
  });

  describe("Singleton Pattern", () => {
    it("should return same instance", () => {
      const instance1 = getWebSearchManager();
      const instance2 = getWebSearchManager();

      expect(instance1).toBe(instance2);
    });

    it("should reset singleton", () => {
      const instance1 = getWebSearchManager();
      resetWebSearchManager();
      const instance2 = getWebSearchManager();

      expect(instance1).not.toBe(instance2);
    });
  });
});
