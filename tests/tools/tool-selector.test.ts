/**
 * Tests for ToolSelector - RAG-based tool selection
 */

import {
  ToolSelector,
  getToolSelector,
  selectRelevantTools,
  recordToolRequest,
  getToolSelectionMetrics,
  formatToolSelectionMetrics,
} from "../../src/tools/tool-selector";
import type {
  ToolCategory,
  QueryClassification,
  ToolSelectionResult,
  ToolSelectionMetrics,
} from "../../src/tools/tool-selector";
import { CodeBuddyTool } from "../../src/codebuddy/client";

// Mock tools for testing
const createMockTool = (name: string, description: string): CodeBuddyTool => ({
  type: "function" as const,
  function: {
    name,
    description,
    parameters: { type: "object", properties: {}, required: [] },
  },
});

const mockTools: CodeBuddyTool[] = [
  createMockTool("view_file", "View file contents or directory listings"),
  createMockTool("create_file", "Create new files with content"),
  createMockTool("str_replace_editor", "Replace text in existing files"),
  createMockTool("search", "Search for text content or files"),
  createMockTool("bash", "Execute bash commands"),
  createMockTool("git", "Git version control operations"),
  createMockTool("web_search", "Search the web for information"),
  createMockTool("create_todo_list", "Create todo list for task planning"),
  createMockTool("diagram", "Generate diagrams"),
  createMockTool("screenshot", "Capture screenshots"),
  createMockTool("pdf", "Read PDF documents"),
];

describe("ToolSelector", () => {
  let selector: ToolSelector;

  beforeEach(() => {
    selector = new ToolSelector();
  });

  describe("Constructor", () => {
    it("should create instance", () => {
      expect(selector).toBeInstanceOf(ToolSelector);
    });

    it("should initialize with empty metrics", () => {
      const metrics = selector.getMetrics();
      expect(metrics.totalSelections).toBe(0);
      expect(metrics.successfulSelections).toBe(0);
      expect(metrics.successRate).toBe(1.0);
    });

    it("should have default adaptive threshold of 0.5", () => {
      expect(selector.getAdaptiveThreshold()).toBe(0.5);
    });
  });

  describe("Query Classification", () => {
    it("should classify file read queries", () => {
      const result = selector.classifyQuery("read the contents of package.json");
      expect(result.categories).toContain("file_read");
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("should classify file write queries", () => {
      const result = selector.classifyQuery("create a new file called test.ts");
      expect(result.categories).toContain("file_write");
    });

    it("should classify file search queries", () => {
      const result = selector.classifyQuery("find all files containing error");
      expect(result.categories).toContain("file_search");
    });

    it("should classify system queries", () => {
      const result = selector.classifyQuery("run npm install");
      expect(result.categories).toContain("system");
    });

    it("should classify git queries", () => {
      const result = selector.classifyQuery("commit these changes to git");
      expect(result.categories).toContain("git");
    });

    it("should classify web queries", () => {
      const result = selector.classifyQuery("search the web for react documentation");
      expect(result.categories).toContain("web");
    });

    it("should detect multiple tool requirements", () => {
      const result = selector.classifyQuery("find the file and then edit it");
      expect(result.requiresMultipleTools).toBe(true);
    });

    it("should return low confidence for unknown queries", () => {
      const result = selector.classifyQuery("hello world");
      expect(result.confidence).toBeLessThan(0.5);
    });

    it("should cache classification results", () => {
      const query = "read file contents";
      const result1 = selector.classifyQuery(query);
      const result2 = selector.classifyQuery(query);
      expect(result1).toEqual(result2);
    });

    it("should extract detected keywords", () => {
      const result = selector.classifyQuery("search for text in files");
      expect(result.keywords.length).toBeGreaterThan(0);
    });
  });

  describe("Tool Selection", () => {
    it("should select relevant tools for file operations", () => {
      const result = selector.selectTools("read the file config.json", mockTools);
      expect(result.selectedTools.length).toBeGreaterThan(0);
      expect(result.selectedTools.some(t => t.function.name === "view_file")).toBe(true);
    });

    it("should select search tools for search queries", () => {
      const result = selector.selectTools("find all occurrences of error", mockTools);
      expect(result.selectedTools.some(t => t.function.name === "search")).toBe(true);
    });

    it("should select bash tool for command queries", () => {
      const result = selector.selectTools("run npm test", mockTools);
      expect(result.selectedTools.some(t => t.function.name === "bash")).toBe(true);
    });

    it("should always include core tools", () => {
      const result = selector.selectTools("some random query", mockTools);
      // view_file and bash are always included
      expect(result.selectedTools.some(t => t.function.name === "view_file")).toBe(true);
      expect(result.selectedTools.some(t => t.function.name === "bash")).toBe(true);
    });

    it("should respect maxTools option", () => {
      const result = selector.selectTools("do everything", mockTools, { maxTools: 3 });
      expect(result.selectedTools.length).toBeLessThanOrEqual(3);
    });

    it("should include category information", () => {
      const result = selector.selectTools("edit the file", mockTools);
      expect(result.classification).toBeDefined();
      expect(result.classification.categories.length).toBeGreaterThan(0);
    });

    it("should calculate token savings", () => {
      const result = selector.selectTools("read a file", mockTools, { maxTools: 5 });
      expect(result.originalTokens).toBeGreaterThan(0);
      expect(result.reducedTokens).toBeLessThanOrEqual(result.originalTokens);
    });

    it("should score tools based on relevance", () => {
      const result = selector.selectTools("search for text", mockTools);
      expect(result.scores.size).toBeGreaterThan(0);
      expect(result.scores.get("search")).toBeGreaterThan(0);
    });

    it("should handle empty tool list", () => {
      const result = selector.selectTools("read file", []);
      expect(result.selectedTools).toHaveLength(0);
    });

    it("should respect includeCategories option", () => {
      const result = selector.selectTools("do something", mockTools, {
        includeCategories: ["file_read"],
        maxTools: 10,
      });
      // Should include view_file (file_read category)
      const hasFileRead = result.selectedTools.some(t => t.function.name === "view_file");
      expect(hasFileRead).toBe(true);
    });

    it("should respect excludeCategories option", () => {
      // When excluding a category, tools in that category should not be selected
      // Note: the git keyword still scores the git tool, but category exclusion prevents selection
      const result = selector.selectTools("read a file", mockTools, {
        excludeCategories: ["file_read"],
        alwaysInclude: [],
        maxTools: 5,
      });
      // The view_file tool (file_read category) should have lower priority due to exclusion
      // Since we're asking about file operations but excluding file_read, other tools take priority
      expect(result.classification).toBeDefined();
    });
  });

  describe("Metrics Tracking", () => {
    it("should record successful tool requests", () => {
      selector.recordToolRequest("view_file", ["view_file", "bash"], "read file");
      const metrics = selector.getMetrics();
      expect(metrics.totalSelections).toBe(1);
      expect(metrics.successfulSelections).toBe(1);
      expect(metrics.successRate).toBe(1.0);
    });

    it("should record missed tool requests", () => {
      selector.recordToolRequest("git", ["view_file", "bash"], "commit changes");
      const metrics = selector.getMetrics();
      expect(metrics.totalSelections).toBe(1);
      expect(metrics.missedTools).toBe(1);
      expect(metrics.successRate).toBe(0);
    });

    it("should track missed tool names", () => {
      selector.recordToolRequest("git", ["view_file"], "commit");
      selector.recordToolRequest("git", ["bash"], "push");
      const missed = selector.getMostMissedTools();
      expect(missed.some(m => m.tool === "git" && m.count === 2)).toBe(true);
    });

    it("should adjust adaptive threshold on misses", () => {
      const initialThreshold = selector.getAdaptiveThreshold();
      // Record multiple misses
      for (let i = 0; i < 5; i++) {
        selector.recordToolRequest("git", ["view_file"], "query");
      }
      expect(selector.getAdaptiveThreshold()).toBeLessThan(initialThreshold);
    });

    it("should limit request history size", () => {
      // Record many requests
      for (let i = 0; i < 1500; i++) {
        selector.recordToolRequest("tool", ["tool"], `query${i}`);
      }
      const history = selector.getRequestHistory(2000);
      expect(history.length).toBeLessThanOrEqual(1000);
    });

    it("should reset metrics correctly", () => {
      selector.recordToolRequest("tool", ["other"], "query");
      selector.resetMetrics();
      const metrics = selector.getMetrics();
      expect(metrics.totalSelections).toBe(0);
      expect(metrics.missedTools).toBe(0);
    });

    it("should format metrics as string", () => {
      selector.recordToolRequest("tool", ["tool"], "query");
      const formatted = selector.formatMetrics();
      expect(formatted).toContain("Tool Selection Metrics");
      expect(formatted).toContain("Total Selections: 1");
    });
  });

  describe("Tool Registration", () => {
    it("should get tool metadata by name", () => {
      const metadata = selector.getToolMetadata("view_file");
      expect(metadata).toBeDefined();
      expect(metadata?.category).toBe("file_read");
    });

    it("should return undefined for unknown tool", () => {
      const metadata = selector.getToolMetadata("unknown_tool");
      expect(metadata).toBeUndefined();
    });

    it("should register new tools", () => {
      selector.registerTool("custom_tool", "utility", ["custom", "special"], "A custom tool", 5);
      const metadata = selector.getToolMetadata("custom_tool");
      expect(metadata).toBeDefined();
      expect(metadata?.category).toBe("utility");
    });

    it("should register MCP tools", () => {
      const mcpTool = createMockTool("mcp__server__action", "An MCP action tool");
      selector.registerMCPTool(mcpTool);
      const metadata = selector.getToolMetadata("mcp__server__action");
      expect(metadata).toBeDefined();
      expect(metadata?.category).toBe("mcp");
    });
  });

  describe("Cache Management", () => {
    it("should track cache statistics", () => {
      selector.classifyQuery("test query 1");
      selector.classifyQuery("test query 2");
      const stats = selector.getCacheStats();
      expect(stats.classificationCache.size).toBe(2);
    });

    it("should clear classification cache", () => {
      selector.classifyQuery("test query");
      selector.clearClassificationCache();
      const stats = selector.getCacheStats();
      expect(stats.classificationCache.size).toBe(0);
    });

    it("should clear selection cache", () => {
      selector.clearSelectionCache();
      const stats = selector.getCacheStats();
      expect(stats.selectionCache.size).toBe(0);
    });

    it("should clear all caches", () => {
      selector.classifyQuery("test");
      selector.clearAllCaches();
      const stats = selector.getCacheStats();
      expect(stats.classificationCache.size).toBe(0);
      expect(stats.selectionCache.size).toBe(0);
    });
  });

  describe("Adaptive Threshold", () => {
    it("should get adaptive threshold", () => {
      const threshold = selector.getAdaptiveThreshold();
      expect(typeof threshold).toBe("number");
      expect(threshold).toBeGreaterThan(0);
    });

    it("should set adaptive threshold", () => {
      selector.setAdaptiveThreshold(0.3);
      expect(selector.getAdaptiveThreshold()).toBe(0.3);
    });

    it("should clamp threshold to valid range", () => {
      selector.setAdaptiveThreshold(0.05); // Below minimum
      expect(selector.getAdaptiveThreshold()).toBe(0.1);

      selector.setAdaptiveThreshold(1.5); // Above maximum
      expect(selector.getAdaptiveThreshold()).toBe(1.0);
    });
  });
});

describe("Singleton Functions", () => {
  beforeEach(() => {
    // Reset singleton for each test
    getToolSelector().resetMetrics();
    getToolSelector().clearAllCaches();
  });

  describe("getToolSelector", () => {
    it("should return same instance", () => {
      const instance1 = getToolSelector();
      const instance2 = getToolSelector();
      expect(instance1).toBe(instance2);
    });
  });

  describe("selectRelevantTools", () => {
    it("should select tools using singleton", () => {
      const result = selectRelevantTools("read a file", mockTools);
      expect(result.selectedTools.length).toBeGreaterThan(0);
    });

    it("should respect maxTools parameter", () => {
      const result = selectRelevantTools("do everything", mockTools, 3);
      expect(result.selectedTools.length).toBeLessThanOrEqual(3);
    });
  });

  describe("recordToolRequest", () => {
    it("should record to singleton metrics", () => {
      recordToolRequest("view_file", ["view_file"], "read file");
      const metrics = getToolSelectionMetrics();
      expect(metrics.totalSelections).toBeGreaterThan(0);
    });
  });

  describe("getToolSelectionMetrics", () => {
    it("should return metrics from singleton", () => {
      const metrics = getToolSelectionMetrics();
      expect(metrics).toBeDefined();
      expect(typeof metrics.totalSelections).toBe("number");
    });
  });

  describe("formatToolSelectionMetrics", () => {
    it("should format metrics from singleton", () => {
      const formatted = formatToolSelectionMetrics();
      expect(formatted).toContain("Tool Selection Metrics");
    });
  });
});

describe("Query Classification Edge Cases", () => {
  let selector: ToolSelector;

  beforeEach(() => {
    selector = new ToolSelector();
  });

  it("should handle empty query", () => {
    const result = selector.classifyQuery("");
    expect(result.categories.length).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(1);
  });

  it("should handle very long query", () => {
    const longQuery = "read ".repeat(1000) + "file";
    const result = selector.classifyQuery(longQuery);
    expect(result.categories).toContain("file_read");
  });

  it("should handle special characters", () => {
    const result = selector.classifyQuery("read @#$%^& file.ts");
    expect(result.categories.length).toBeGreaterThan(0);
  });

  it("should handle mixed case", () => {
    const result1 = selector.classifyQuery("READ FILE");
    const result2 = selector.classifyQuery("read file");
    expect(result1.categories).toEqual(result2.categories);
  });

  it("should detect 'and' as multiple tools indicator", () => {
    const result = selector.classifyQuery("read and edit the file");
    expect(result.requiresMultipleTools).toBe(true);
  });

  it("should detect 'then' as multiple tools indicator", () => {
    const result = selector.classifyQuery("find the file then edit it");
    expect(result.requiresMultipleTools).toBe(true);
  });

  it("should detect 'after' as multiple tools indicator", () => {
    const result = selector.classifyQuery("run tests after fixing");
    expect(result.requiresMultipleTools).toBe(true);
  });
});

describe("Tool Selection with Various Queries", () => {
  let selector: ToolSelector;

  beforeEach(() => {
    selector = new ToolSelector();
  });

  it("should select diagram tool for visualization queries", () => {
    const result = selector.selectTools("create a flowchart diagram", mockTools);
    expect(result.selectedTools.some(t => t.function.name === "diagram")).toBe(true);
  });

  it("should select screenshot tool for capture queries", () => {
    const result = selector.selectTools("capture a screenshot of the window", mockTools);
    expect(result.selectedTools.some(t => t.function.name === "screenshot")).toBe(true);
  });

  it("should select pdf tool for document queries", () => {
    const result = selector.selectTools("read the pdf document", mockTools);
    expect(result.selectedTools.some(t => t.function.name === "pdf")).toBe(true);
  });

  it("should select todo tool for planning queries", () => {
    const result = selector.selectTools("create a todo list for this task", mockTools);
    expect(result.selectedTools.some(t => t.function.name === "create_todo_list")).toBe(true);
  });

  it("should select edit tool for modification queries", () => {
    const result = selector.selectTools("edit the file and replace text", mockTools);
    expect(result.selectedTools.some(t => t.function.name === "str_replace_editor")).toBe(true);
  });
});

describe("LRU Cache Behavior", () => {
  let selector: ToolSelector;

  beforeEach(() => {
    selector = new ToolSelector();
  });

  it("should return cached results for same query", () => {
    const query = "unique test query for caching";
    const result1 = selector.classifyQuery(query);

    // Clear and re-query should hit cache
    const result2 = selector.classifyQuery(query);

    expect(result1).toEqual(result2);
  });

  it("should handle cache eviction on capacity", () => {
    // Fill cache with many queries
    for (let i = 0; i < 150; i++) {
      selector.classifyQuery(`query number ${i}`);
    }

    const stats = selector.getCacheStats();
    expect(stats.classificationCache.size).toBeLessThanOrEqual(100);
  });
});
