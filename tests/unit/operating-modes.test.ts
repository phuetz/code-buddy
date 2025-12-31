/**
 * Unit tests for OperatingModeManager
 *
 * Tests the operating modes system that controls
 * quality/cost/speed tradeoffs.
 */

import {
  OperatingModeManager,
  getOperatingModeManager,
  resetOperatingModeManager,
  OperatingMode,
  ModeConfig,
} from "../../src/agent/operating-modes";
import { EventEmitter } from "events";

describe("OperatingModeManager", () => {
  let manager: OperatingModeManager;

  beforeEach(() => {
    resetOperatingModeManager();
    manager = new OperatingModeManager();
  });

  afterEach(() => {
    if (manager) {
      manager.dispose();
    }
  });

  describe("Constructor", () => {
    it("should create with default balanced mode", () => {
      expect(manager.getMode()).toBe("balanced");
    });

    it("should accept initial mode in constructor", () => {
      const qualityManager = new OperatingModeManager("quality");
      expect(qualityManager.getMode()).toBe("quality");
      qualityManager.dispose();
    });

    it("should be an EventEmitter", () => {
      expect(manager).toBeInstanceOf(EventEmitter);
      expect(manager.on).toBeDefined();
      expect(manager.emit).toBeDefined();
    });

    it("should accept fast mode in constructor", () => {
      const fastManager = new OperatingModeManager("fast");
      expect(fastManager.getMode()).toBe("fast");
      fastManager.dispose();
    });

    it("should accept custom mode in constructor", () => {
      const customManager = new OperatingModeManager("custom");
      expect(customManager.getMode()).toBe("custom");
      customManager.dispose();
    });
  });

  describe("getMode", () => {
    it("should return current mode", () => {
      expect(manager.getMode()).toBe("balanced");

      manager.setMode("quality");
      expect(manager.getMode()).toBe("quality");
    });
  });

  describe("getModeConfig", () => {
    it("should return quality mode config", () => {
      manager.setMode("quality");
      const config = manager.getModeConfig();

      expect(config.name).toBe("Quality");
      expect(config.preferredModel).toBe("grok-3");
      expect(config.enableExtendedThinking).toBe(true);
      expect(config.thinkingBudget).toBe(32000);
      expect(config.maxToolRounds).toBe(30);
      expect(config.enableSelfReview).toBe(true);
      expect(config.enableIterativeRefinement).toBe(true);
    });

    it("should return balanced mode config", () => {
      manager.setMode("balanced");
      const config = manager.getModeConfig();

      expect(config.name).toBe("Balanced");
      expect(config.preferredModel).toBe("grok-2-latest");
      expect(config.enableExtendedThinking).toBe(true);
      expect(config.thinkingBudget).toBe(8000);
      expect(config.maxToolRounds).toBe(20);
      expect(config.enableSelfReview).toBe(false);
    });

    it("should return fast mode config", () => {
      manager.setMode("fast");
      const config = manager.getModeConfig();

      expect(config.name).toBe("Fast");
      expect(config.preferredModel).toBe("grok-2-mini");
      expect(config.enableExtendedThinking).toBe(false);
      expect(config.thinkingBudget).toBe(0);
      expect(config.maxToolRounds).toBe(10);
      expect(config.enableSelfReview).toBe(false);
      expect(config.enableIterativeRefinement).toBe(false);
      expect(config.eagerExecution).toBe(true);
    });

    it("should return custom mode config with overrides", () => {
      manager.setMode("custom");
      manager.setCustomConfig({
        maxToolRounds: 50,
        enableSelfReview: true,
      });

      const config = manager.getModeConfig();
      expect(config.maxToolRounds).toBe(50);
      expect(config.enableSelfReview).toBe(true);
    });

    it("should merge custom config with balanced defaults", () => {
      manager.setMode("custom");
      manager.setCustomConfig({
        maxToolRounds: 100,
      });

      const config = manager.getModeConfig();
      // Custom override
      expect(config.maxToolRounds).toBe(100);
      // Defaults from balanced
      expect(config.preferredModel).toBe("grok-2-latest");
    });
  });

  describe("setMode", () => {
    it("should change the current mode", () => {
      manager.setMode("quality");
      expect(manager.getMode()).toBe("quality");

      manager.setMode("fast");
      expect(manager.getMode()).toBe("fast");
    });

    it("should emit mode:changed event", () => {
      const handler = jest.fn();
      manager.on("mode:changed", handler);

      manager.setMode("quality", "User requested");

      expect(handler).toHaveBeenCalledWith({
        previousMode: "balanced",
        newMode: "quality",
        config: expect.objectContaining({ name: "Quality" }),
        reason: "User requested",
      });
    });

    it("should add entry to mode history", () => {
      manager.setMode("quality", "Test reason");

      const history = manager.getModeHistory();
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        mode: "quality",
        reason: "Test reason",
      });
      expect(history[0].timestamp).toBeDefined();
    });

    it("should limit history to 100 entries", () => {
      for (let i = 0; i < 110; i++) {
        manager.setMode(i % 2 === 0 ? "quality" : "fast");
      }

      const history = manager.getModeHistory();
      expect(history.length).toBeLessThanOrEqual(100);
    });
  });

  describe("setCustomConfig", () => {
    it("should update custom config", () => {
      manager.setMode("custom");
      manager.setCustomConfig({
        maxInputTokens: 256000,
        enableRAG: false,
      });

      const config = manager.getModeConfig();
      expect(config.maxInputTokens).toBe(256000);
      expect(config.enableRAG).toBe(false);
    });

    it("should merge with existing custom config", () => {
      manager.setMode("custom");
      manager.setCustomConfig({ maxInputTokens: 256000 });
      manager.setCustomConfig({ enableRAG: false });

      const config = manager.getModeConfig();
      expect(config.maxInputTokens).toBe(256000);
      expect(config.enableRAG).toBe(false);
    });

    it("should emit config:updated event when in custom mode", () => {
      const handler = jest.fn();
      manager.on("config:updated", handler);

      manager.setMode("custom");
      manager.setCustomConfig({ maxToolRounds: 50 });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ maxToolRounds: 50 })
      );
    });

    it("should not emit config:updated event when not in custom mode", () => {
      const handler = jest.fn();
      manager.on("config:updated", handler);

      manager.setMode("balanced");
      manager.setCustomConfig({ maxToolRounds: 50 });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("autoSelectMode", () => {
    it("should return fast for high urgency", () => {
      const mode = manager.autoSelectMode({
        estimatedComplexity: "medium",
        urgency: "high",
      });
      expect(mode).toBe("fast");
    });

    it("should return fast for cost sensitive tasks", () => {
      const mode = manager.autoSelectMode({
        estimatedComplexity: "medium",
        costSensitive: true,
      });
      expect(mode).toBe("fast");
    });

    it("should return quality for high complexity", () => {
      const mode = manager.autoSelectMode({
        estimatedComplexity: "high",
      });
      expect(mode).toBe("quality");
    });

    it("should return quality when accuracy is required", () => {
      const mode = manager.autoSelectMode({
        estimatedComplexity: "medium",
        requiresAccuracy: true,
      });
      expect(mode).toBe("quality");
    });

    it("should return balanced by default", () => {
      const mode = manager.autoSelectMode({
        estimatedComplexity: "medium",
      });
      expect(mode).toBe("balanced");
    });

    it("should return balanced for low complexity", () => {
      const mode = manager.autoSelectMode({
        estimatedComplexity: "low",
      });
      expect(mode).toBe("balanced");
    });

    it("should prioritize urgency over complexity", () => {
      const mode = manager.autoSelectMode({
        estimatedComplexity: "high",
        urgency: "high",
      });
      expect(mode).toBe("fast");
    });
  });

  describe("getRecommendedModel", () => {
    it("should return quality mode model", () => {
      manager.setMode("quality");
      expect(manager.getRecommendedModel()).toBe("grok-3");
    });

    it("should return balanced mode model", () => {
      manager.setMode("balanced");
      expect(manager.getRecommendedModel()).toBe("grok-2-latest");
    });

    it("should return fast mode model", () => {
      manager.setMode("fast");
      expect(manager.getRecommendedModel()).toBe("grok-2-mini");
    });

    it("should return custom preferred model when set", () => {
      manager.setMode("custom");
      manager.setCustomConfig({ preferredModel: "custom-model" });
      expect(manager.getRecommendedModel()).toBe("custom-model");
    });
  });

  describe("isFeatureEnabled", () => {
    it("should return true for enabled boolean features", () => {
      manager.setMode("quality");
      expect(manager.isFeatureEnabled("enableExtendedThinking")).toBe(true);
      expect(manager.isFeatureEnabled("enableSelfReview")).toBe(true);
    });

    it("should return false for disabled boolean features", () => {
      manager.setMode("fast");
      expect(manager.isFeatureEnabled("enableExtendedThinking")).toBe(false);
      expect(manager.isFeatureEnabled("enableSelfReview")).toBe(false);
      expect(manager.isFeatureEnabled("enableRAG")).toBe(false);
    });

    it("should return true for non-boolean features", () => {
      manager.setMode("balanced");
      // Non-boolean features should return true (they're enabled with a value)
      expect(manager.isFeatureEnabled("maxToolRounds")).toBe(true);
    });
  });

  describe("getTokenBudget", () => {
    it("should return quality mode token budgets", () => {
      manager.setMode("quality");
      const budget = manager.getTokenBudget();

      expect(budget).toEqual({
        input: 128000,
        output: 16000,
        context: 200000,
        thinking: 32000,
      });
    });

    it("should return balanced mode token budgets", () => {
      manager.setMode("balanced");
      const budget = manager.getTokenBudget();

      expect(budget).toEqual({
        input: 64000,
        output: 8000,
        context: 100000,
        thinking: 8000,
      });
    });

    it("should return fast mode token budgets", () => {
      manager.setMode("fast");
      const budget = manager.getTokenBudget();

      expect(budget).toEqual({
        input: 32000,
        output: 4000,
        context: 50000,
        thinking: 0,
      });
    });
  });

  describe("getCostLimits", () => {
    it("should return quality mode cost limits", () => {
      manager.setMode("quality");
      const limits = manager.getCostLimits();

      expect(limits).toEqual({
        max: 5.0,
        warn: 2.0,
      });
    });

    it("should return balanced mode cost limits", () => {
      manager.setMode("balanced");
      const limits = manager.getCostLimits();

      expect(limits).toEqual({
        max: 2.0,
        warn: 1.0,
      });
    });

    it("should return fast mode cost limits", () => {
      manager.setMode("fast");
      const limits = manager.getCostLimits();

      expect(limits).toEqual({
        max: 0.5,
        warn: 0.25,
      });
    });
  });

  describe("getAvailableModes", () => {
    it("should return all available modes", () => {
      const modes = manager.getAvailableModes();

      expect(modes).toHaveLength(4);
      expect(modes.map((m) => m.mode)).toEqual([
        "quality",
        "balanced",
        "fast",
        "custom",
      ]);
    });

    it("should include name and description for each mode", () => {
      const modes = manager.getAvailableModes();

      for (const mode of modes) {
        expect(mode.name).toBeDefined();
        expect(mode.description).toBeDefined();
      }
    });

    it("should have correct names for modes", () => {
      const modes = manager.getAvailableModes();
      const modeMap = new Map(modes.map((m) => [m.mode, m]));

      expect(modeMap.get("quality")?.name).toBe("Quality");
      expect(modeMap.get("balanced")?.name).toBe("Balanced");
      expect(modeMap.get("fast")?.name).toBe("Fast");
      expect(modeMap.get("custom")?.name).toBe("Custom");
    });
  });

  describe("getModeHistory", () => {
    it("should return empty array initially", () => {
      expect(manager.getModeHistory()).toHaveLength(0);
    });

    it("should track mode changes", () => {
      manager.setMode("quality");
      manager.setMode("fast");
      manager.setMode("balanced");

      const history = manager.getModeHistory();
      expect(history).toHaveLength(3);
      expect(history.map((h) => h.mode)).toEqual(["quality", "fast", "balanced"]);
    });

    it("should return a copy of history", () => {
      manager.setMode("quality");

      const history1 = manager.getModeHistory();
      const history2 = manager.getModeHistory();

      expect(history1).toEqual(history2);
      expect(history1).not.toBe(history2);
    });

    it("should include timestamps in history", () => {
      const before = Date.now();
      manager.setMode("quality");
      const after = Date.now();

      const history = manager.getModeHistory();
      expect(history[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(history[0].timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("getModeStats", () => {
    it("should return zero counts initially", () => {
      const stats = manager.getModeStats();

      expect(stats).toEqual({
        quality: 0,
        balanced: 0,
        fast: 0,
        custom: 0,
      });
    });

    it("should count mode changes", () => {
      manager.setMode("quality");
      manager.setMode("quality");
      manager.setMode("fast");
      manager.setMode("balanced");

      const stats = manager.getModeStats();
      expect(stats.quality).toBe(2);
      expect(stats.fast).toBe(1);
      expect(stats.balanced).toBe(1);
      expect(stats.custom).toBe(0);
    });
  });

  describe("withMode", () => {
    it("should temporarily use different mode", () => {
      manager.setMode("balanced");

      const result = manager.withMode("quality", () => {
        expect(manager.getMode()).toBe("quality");
        return "done";
      });

      expect(result).toBe("done");
      expect(manager.getMode()).toBe("balanced");
    });

    it("should restore mode even if function throws", () => {
      manager.setMode("balanced");

      expect(() => {
        manager.withMode("quality", () => {
          throw new Error("Test error");
        });
      }).toThrow("Test error");

      expect(manager.getMode()).toBe("balanced");
    });

    it("should pass through return value", () => {
      const result = manager.withMode("fast", () => 42);
      expect(result).toBe(42);
    });

    it("should work with objects", () => {
      const obj = { value: "test" };
      const result = manager.withMode("quality", () => obj);
      expect(result).toBe(obj);
    });
  });

  describe("withModeAsync", () => {
    it("should temporarily use different mode for async operations", async () => {
      manager.setMode("balanced");

      const result = await manager.withModeAsync("quality", async () => {
        expect(manager.getMode()).toBe("quality");
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "done";
      });

      expect(result).toBe("done");
      expect(manager.getMode()).toBe("balanced");
    });

    it("should restore mode even if async function rejects", async () => {
      manager.setMode("balanced");

      await expect(
        manager.withModeAsync("quality", async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error("Test error");
        })
      ).rejects.toThrow("Test error");

      expect(manager.getMode()).toBe("balanced");
    });

    it("should pass through async return value", async () => {
      const result = await manager.withModeAsync("fast", async () => {
        return 42;
      });
      expect(result).toBe(42);
    });
  });

  describe("dispose", () => {
    it("should remove all listeners", () => {
      const handler = jest.fn();
      manager.on("mode:changed", handler);

      manager.dispose();

      // Trying to emit should not call handler
      manager.emit("mode:changed", {});
      expect(handler).not.toHaveBeenCalled();
    });

    it("should be safe to call multiple times", () => {
      expect(() => {
        manager.dispose();
        manager.dispose();
      }).not.toThrow();
    });
  });
});

describe("Singleton Functions", () => {
  beforeEach(() => {
    resetOperatingModeManager();
  });

  describe("getOperatingModeManager", () => {
    it("should create a singleton instance", () => {
      const manager1 = getOperatingModeManager();
      const manager2 = getOperatingModeManager();

      expect(manager1).toBe(manager2);
    });

    it("should use initial mode on first call", () => {
      const manager = getOperatingModeManager("quality");
      expect(manager.getMode()).toBe("quality");
    });

    it("should ignore initial mode on subsequent calls", () => {
      const manager1 = getOperatingModeManager("quality");
      const manager2 = getOperatingModeManager("fast");

      expect(manager2.getMode()).toBe("quality");
    });
  });

  describe("resetOperatingModeManager", () => {
    it("should clear the singleton instance", () => {
      const manager1 = getOperatingModeManager("quality");
      manager1.setMode("fast");

      resetOperatingModeManager();

      const manager2 = getOperatingModeManager("balanced");
      expect(manager2.getMode()).toBe("balanced");
      expect(manager2).not.toBe(manager1);
    });

    it("should dispose the existing instance", () => {
      const manager = getOperatingModeManager();
      const handler = jest.fn();
      manager.on("mode:changed", handler);

      resetOperatingModeManager();

      // Previous instance should be disposed
      manager.emit("mode:changed", {});
      expect(handler).not.toHaveBeenCalled();
    });

    it("should be safe to call when no instance exists", () => {
      expect(() => {
        resetOperatingModeManager();
        resetOperatingModeManager();
      }).not.toThrow();
    });
  });
});

describe("Mode Configurations", () => {
  let manager: OperatingModeManager;

  beforeEach(() => {
    manager = new OperatingModeManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  describe("Quality Mode", () => {
    beforeEach(() => {
      manager.setMode("quality");
    });

    it("should have highest token limits", () => {
      const budget = manager.getTokenBudget();
      expect(budget.input).toBe(128000);
      expect(budget.context).toBe(200000);
    });

    it("should enable extended thinking with large budget", () => {
      const config = manager.getModeConfig();
      expect(config.enableExtendedThinking).toBe(true);
      expect(config.thinkingBudget).toBe(32000);
    });

    it("should enable all quality features", () => {
      const config = manager.getModeConfig();
      expect(config.enableSelfReview).toBe(true);
      expect(config.enableIterativeRefinement).toBe(true);
      expect(config.enableRAG).toBe(true);
      expect(config.enableRepoMap).toBe(true);
    });

    it("should use sequential tool calls for accuracy", () => {
      const config = manager.getModeConfig();
      expect(config.parallelToolCalls).toBe(false);
    });

    it("should have highest cost limits", () => {
      const limits = manager.getCostLimits();
      expect(limits.max).toBe(5.0);
    });
  });

  describe("Balanced Mode", () => {
    beforeEach(() => {
      manager.setMode("balanced");
    });

    it("should have moderate token limits", () => {
      const budget = manager.getTokenBudget();
      expect(budget.input).toBe(64000);
      expect(budget.context).toBe(100000);
    });

    it("should enable extended thinking with moderate budget", () => {
      const config = manager.getModeConfig();
      expect(config.enableExtendedThinking).toBe(true);
      expect(config.thinkingBudget).toBe(8000);
    });

    it("should disable self-review but enable refinement", () => {
      const config = manager.getModeConfig();
      expect(config.enableSelfReview).toBe(false);
      expect(config.enableIterativeRefinement).toBe(true);
    });

    it("should allow parallel tool calls", () => {
      const config = manager.getModeConfig();
      expect(config.parallelToolCalls).toBe(true);
    });
  });

  describe("Fast Mode", () => {
    beforeEach(() => {
      manager.setMode("fast");
    });

    it("should have lowest token limits", () => {
      const budget = manager.getTokenBudget();
      expect(budget.input).toBe(32000);
      expect(budget.context).toBe(50000);
    });

    it("should disable extended thinking", () => {
      const config = manager.getModeConfig();
      expect(config.enableExtendedThinking).toBe(false);
      expect(config.thinkingBudget).toBe(0);
    });

    it("should disable all expensive features", () => {
      const config = manager.getModeConfig();
      expect(config.enableSelfReview).toBe(false);
      expect(config.enableIterativeRefinement).toBe(false);
      expect(config.enableRAG).toBe(false);
      expect(config.enableRepoMap).toBe(false);
    });

    it("should enable eager execution", () => {
      const config = manager.getModeConfig();
      expect(config.eagerExecution).toBe(true);
    });

    it("should have lowest cost limits", () => {
      const limits = manager.getCostLimits();
      expect(limits.max).toBe(0.5);
    });

    it("should have fewest tool rounds", () => {
      const config = manager.getModeConfig();
      expect(config.maxToolRounds).toBe(10);
    });
  });
});
