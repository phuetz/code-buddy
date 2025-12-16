/**
 * Tests for ThinkingKeywords - Extended thinking trigger system
 */

import {
  ThinkingKeywordsManager,
  ThinkingKeywordResult,
  getThinkingKeywordsManager,
  resetThinkingKeywordsManager,
  hasThinkingKeyword,
  extractThinkingLevel,
} from "../../src/agent/thinking-keywords";

describe("ThinkingKeywordsManager", () => {
  let manager: ThinkingKeywordsManager;

  beforeEach(() => {
    resetThinkingKeywordsManager();
    manager = new ThinkingKeywordsManager();
  });

  afterEach(() => {
    manager.removeAllListeners();
  });

  describe("Constructor", () => {
    it("should create instance with default options", () => {
      expect(manager).toBeInstanceOf(ThinkingKeywordsManager);
      expect(manager.isEnabled()).toBe(true);
      expect(manager.getDefaultLevel()).toBe("none");
    });

    it("should accept custom default level", () => {
      const customManager = new ThinkingKeywordsManager({ defaultLevel: "standard" });
      expect(customManager.getDefaultLevel()).toBe("standard");
    });

    it("should accept enabled option", () => {
      const disabledManager = new ThinkingKeywordsManager({ enabled: false });
      expect(disabledManager.isEnabled()).toBe(false);
    });
  });

  describe("Keyword Detection - Standard Level", () => {
    it("should detect 'think' keyword", () => {
      const result = manager.detectThinkingLevel("think about this problem");
      expect(result.detected).toBe(true);
      expect(result.level).toBe("standard");
      expect(result.keyword).toMatch(/think/i);
    });

    it("should detect 'think about' pattern", () => {
      const result = manager.detectThinkingLevel("think about how to solve this");
      expect(result.detected).toBe(true);
      expect(result.level).toBe("standard");
    });

    it("should detect 'think through' pattern", () => {
      const result = manager.detectThinkingLevel("think through this issue");
      expect(result.detected).toBe(true);
      expect(result.level).toBe("standard");
    });

    it("should detect 'consider carefully' pattern", () => {
      const result = manager.detectThinkingLevel("please consider carefully this design");
      expect(result.detected).toBe(true);
      expect(result.level).toBe("standard");
    });
  });

  describe("Keyword Detection - Deep Level", () => {
    it("should detect 'megathink' keyword", () => {
      const result = manager.detectThinkingLevel("megathink about the architecture");
      expect(result.detected).toBe(true);
      expect(result.level).toBe("deep");
      expect(result.keyword).toMatch(/megathink/i);
    });

    it("should detect 'think hard' pattern", () => {
      const result = manager.detectThinkingLevel("think hard about this");
      expect(result.detected).toBe(true);
      expect(result.level).toBe("deep");
    });

    it("should detect 'think harder' pattern", () => {
      const result = manager.detectThinkingLevel("think harder about the problem");
      expect(result.detected).toBe(true);
      expect(result.level).toBe("deep");
    });

    it("should detect 'deep think' pattern", () => {
      const result = manager.detectThinkingLevel("deep think on this architecture");
      expect(result.detected).toBe(true);
      expect(result.level).toBe("deep");
    });

    it("should detect 'think deeply' pattern", () => {
      const result = manager.detectThinkingLevel("think deeply about security");
      expect(result.detected).toBe(true);
      expect(result.level).toBe("deep");
    });

    it("should detect 'analyze thoroughly' pattern", () => {
      const result = manager.detectThinkingLevel("analyze thoroughly this code");
      expect(result.detected).toBe(true);
      expect(result.level).toBe("deep");
    });
  });

  describe("Keyword Detection - Exhaustive Level", () => {
    it("should detect 'ultrathink' keyword", () => {
      const result = manager.detectThinkingLevel("ultrathink about the security");
      expect(result.detected).toBe(true);
      expect(result.level).toBe("exhaustive");
      expect(result.keyword).toMatch(/ultrathink/i);
    });

    it("should detect 'think even harder' pattern", () => {
      const result = manager.detectThinkingLevel("think even harder about this");
      expect(result.detected).toBe(true);
      expect(result.level).toBe("exhaustive");
    });

    it("should detect 'think very hard' pattern", () => {
      const result = manager.detectThinkingLevel("think very hard about scaling");
      expect(result.detected).toBe(true);
      expect(result.level).toBe("exhaustive");
    });

    it("should detect 'exhaustive analysis' pattern", () => {
      const result = manager.detectThinkingLevel("do an exhaustive analysis");
      expect(result.detected).toBe(true);
      expect(result.level).toBe("exhaustive");
    });

    it("should detect 'deep dive' pattern", () => {
      const result = manager.detectThinkingLevel("deep dive into the codebase");
      expect(result.detected).toBe(true);
      expect(result.level).toBe("exhaustive");
    });

    it("should detect 'think maximum' pattern", () => {
      const result = manager.detectThinkingLevel("think maximum about this");
      expect(result.detected).toBe(true);
      expect(result.level).toBe("exhaustive");
    });
  });

  describe("No Keyword Detection", () => {
    it("should return none when no keyword detected", () => {
      const result = manager.detectThinkingLevel("solve this problem");
      expect(result.detected).toBe(false);
      expect(result.level).toBe("none");
      expect(result.keyword).toBeNull();
    });

    it("should preserve original input when no keyword", () => {
      const input = "write a function that sorts numbers";
      const result = manager.detectThinkingLevel(input);
      expect(result.cleanedInput).toBe(input);
    });
  });

  describe("Input Cleaning", () => {
    it("should remove keyword from input", () => {
      const result = manager.detectThinkingLevel("think about refactoring this function");
      expect(result.cleanedInput).not.toContain("think about");
      expect(result.cleanedInput).toContain("refactoring this function");
    });

    it("should clean up extra spaces", () => {
      const result = manager.detectThinkingLevel("megathink   about   this");
      expect(result.cleanedInput).not.toMatch(/\s{2,}/);
    });

    it("should handle keyword at start of input", () => {
      const result = manager.detectThinkingLevel("ultrathink: design an API");
      expect(result.cleanedInput).toBe("design an API");
    });

    it("should handle keyword at end of input", () => {
      const result = manager.detectThinkingLevel("solve this problem, think harder");
      expect(result.cleanedInput).toContain("solve this problem");
    });
  });

  describe("Token Budgets", () => {
    it("should return 0 tokens for none level", () => {
      expect(manager.getTokenBudget("none")).toBe(0);
    });

    it("should return 4000 tokens for standard level", () => {
      expect(manager.getTokenBudget("standard")).toBe(4000);
    });

    it("should return 10000 tokens for deep level", () => {
      expect(manager.getTokenBudget("deep")).toBe(10000);
    });

    it("should return 32000 tokens for exhaustive level", () => {
      expect(manager.getTokenBudget("exhaustive")).toBe(32000);
    });

    it("should include token budget in detection result", () => {
      const result = manager.detectThinkingLevel("megathink about this");
      expect(result.tokenBudget).toBe(10000);
    });
  });

  describe("Configuration", () => {
    it("should get config for a level", () => {
      const config = manager.getConfig("deep");
      expect(config.level).toBe("deep");
      expect(config.tokenBudget).toBe(10000);
      expect(config.keywords).toContain("megathink");
    });

    it("should return copy of config to prevent mutation", () => {
      const config1 = manager.getConfig("standard");
      const config2 = manager.getConfig("standard");
      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });

    it("should get all available levels", () => {
      const levels = manager.getAvailableLevels();
      expect(levels).toHaveLength(4);
      expect(levels.map(l => l.level)).toContain("none");
      expect(levels.map(l => l.level)).toContain("standard");
      expect(levels.map(l => l.level)).toContain("deep");
      expect(levels.map(l => l.level)).toContain("exhaustive");
    });
  });

  describe("Extended Thinking Check", () => {
    it("should return false for none level", () => {
      expect(manager.requiresExtendedThinking("none")).toBe(false);
    });

    it("should return true for standard level", () => {
      expect(manager.requiresExtendedThinking("standard")).toBe(true);
    });

    it("should return true for deep level", () => {
      expect(manager.requiresExtendedThinking("deep")).toBe(true);
    });

    it("should return true for exhaustive level", () => {
      expect(manager.requiresExtendedThinking("exhaustive")).toBe(true);
    });
  });

  describe("Format Level", () => {
    it("should format none level", () => {
      const formatted = manager.formatLevel("none");
      expect(formatted).toContain("No extended thinking");
    });

    it("should format standard level with single brain emoji", () => {
      const formatted = manager.formatLevel("standard");
      expect(formatted).toContain("🧠");
      expect(formatted).toContain("4K tokens");
    });

    it("should format deep level with double brain emoji", () => {
      const formatted = manager.formatLevel("deep");
      expect(formatted).toContain("🧠🧠");
      expect(formatted).toContain("10K tokens");
    });

    it("should format exhaustive level with triple brain emoji", () => {
      const formatted = manager.formatLevel("exhaustive");
      expect(formatted).toContain("🧠🧠🧠");
      expect(formatted).toContain("32K tokens");
    });
  });

  describe("Help Text", () => {
    it("should provide help text", () => {
      const help = manager.getHelpText();
      expect(help).toContain("Extended Thinking Keywords");
      expect(help).toContain("think");
      expect(help).toContain("megathink");
      expect(help).toContain("ultrathink");
    });

    it("should include examples", () => {
      const help = manager.getHelpText();
      expect(help).toContain("Examples:");
    });
  });

  describe("Enable/Disable", () => {
    it("should disable detection when disabled", () => {
      manager.setEnabled(false);
      const result = manager.detectThinkingLevel("ultrathink about this");
      expect(result.detected).toBe(false);
      expect(result.level).toBe("none");
    });

    it("should re-enable detection", () => {
      manager.setEnabled(false);
      manager.setEnabled(true);
      const result = manager.detectThinkingLevel("megathink about this");
      expect(result.detected).toBe(true);
    });

    it("should emit event on enable/disable", (done) => {
      manager.on("thinking:enabled", (enabled) => {
        expect(enabled).toBe(false);
        done();
      });
      manager.setEnabled(false);
    });
  });

  describe("Default Level", () => {
    it("should use default level when no keyword detected", () => {
      manager.setDefaultLevel("standard");
      const result = manager.detectThinkingLevel("solve this problem");
      expect(result.level).toBe("standard");
      expect(result.detected).toBe(true);
    });

    it("should emit event on default level change", (done) => {
      manager.on("thinking:default-changed", (level) => {
        expect(level).toBe("deep");
        done();
      });
      manager.setDefaultLevel("deep");
    });
  });

  describe("Events", () => {
    it("should be an EventEmitter", () => {
      expect(manager.on).toBeDefined();
      expect(manager.emit).toBeDefined();
      expect(manager.off).toBeDefined();
    });

    it("should emit thinking:detected event", (done) => {
      manager.on("thinking:detected", (result: ThinkingKeywordResult) => {
        expect(result.detected).toBe(true);
        expect(result.level).toBe("deep");
        done();
      });
      manager.detectThinkingLevel("megathink about this");
    });
  });

  describe("Case Insensitivity", () => {
    it("should detect ULTRATHINK in uppercase", () => {
      const result = manager.detectThinkingLevel("ULTRATHINK about this");
      expect(result.level).toBe("exhaustive");
    });

    it("should detect MegaThink in mixed case", () => {
      const result = manager.detectThinkingLevel("MegaThink about this");
      expect(result.level).toBe("deep");
    });
  });
});

describe("Singleton Functions", () => {
  beforeEach(() => {
    resetThinkingKeywordsManager();
  });

  describe("getThinkingKeywordsManager", () => {
    it("should return same instance on multiple calls", () => {
      const instance1 = getThinkingKeywordsManager();
      const instance2 = getThinkingKeywordsManager();
      expect(instance1).toBe(instance2);
    });

    it("should accept options on first call", () => {
      const instance = getThinkingKeywordsManager({ defaultLevel: "deep" });
      expect(instance.getDefaultLevel()).toBe("deep");
    });
  });

  describe("resetThinkingKeywordsManager", () => {
    it("should reset the singleton", () => {
      const instance1 = getThinkingKeywordsManager({ defaultLevel: "deep" });
      resetThinkingKeywordsManager();
      const instance2 = getThinkingKeywordsManager();
      expect(instance1).not.toBe(instance2);
      expect(instance2.getDefaultLevel()).toBe("none");
    });
  });
});

describe("Utility Functions", () => {
  describe("hasThinkingKeyword", () => {
    it("should return true for input with keyword", () => {
      expect(hasThinkingKeyword("think about this")).toBe(true);
      expect(hasThinkingKeyword("megathink on this")).toBe(true);
      expect(hasThinkingKeyword("ultrathink")).toBe(true);
    });

    it("should return false for input without keyword", () => {
      expect(hasThinkingKeyword("solve this problem")).toBe(false);
      expect(hasThinkingKeyword("write code")).toBe(false);
    });
  });

  describe("extractThinkingLevel", () => {
    it("should extract standard level", () => {
      expect(extractThinkingLevel("think about this")).toBe("standard");
    });

    it("should extract deep level", () => {
      expect(extractThinkingLevel("megathink on this")).toBe("deep");
      expect(extractThinkingLevel("think harder")).toBe("deep");
    });

    it("should extract exhaustive level", () => {
      expect(extractThinkingLevel("ultrathink")).toBe("exhaustive");
      expect(extractThinkingLevel("think even harder")).toBe("exhaustive");
    });

    it("should return none when no keyword", () => {
      expect(extractThinkingLevel("solve this")).toBe("none");
    });
  });
});

describe("System Prompt Additions", () => {
  let manager: ThinkingKeywordsManager;

  beforeEach(() => {
    manager = new ThinkingKeywordsManager();
  });

  it("should have no system prompt for none level", () => {
    const config = manager.getConfig("none");
    expect(config.systemPromptAddition).toBe("");
  });

  it("should have system prompt for standard level", () => {
    const config = manager.getConfig("standard");
    expect(config.systemPromptAddition).toContain("step by step");
    expect(config.systemPromptAddition).toContain("Understand the problem");
  });

  it("should have detailed system prompt for deep level", () => {
    const config = manager.getConfig("deep");
    expect(config.systemPromptAddition).toContain("deep analysis");
    expect(config.systemPromptAddition).toContain("edge cases");
  });

  it("should have exhaustive system prompt for exhaustive level", () => {
    const config = manager.getConfig("exhaustive");
    expect(config.systemPromptAddition).toContain("exhaustive analysis");
    expect(config.systemPromptAddition).toContain("confidence levels");
  });

  it("should include system prompt in detection result", () => {
    const result = manager.detectThinkingLevel("megathink about this");
    expect(result.systemPromptAddition).toContain("deep analysis");
  });
});

describe("Edge Cases", () => {
  let manager: ThinkingKeywordsManager;

  beforeEach(() => {
    manager = new ThinkingKeywordsManager();
  });

  it("should handle empty input", () => {
    const result = manager.detectThinkingLevel("");
    expect(result.detected).toBe(false);
    expect(result.level).toBe("none");
  });

  it("should handle input with only whitespace", () => {
    const result = manager.detectThinkingLevel("   ");
    expect(result.detected).toBe(false);
  });

  it("should handle multiple keywords - uses first match (most specific)", () => {
    // "ultrathink" is checked before "think"
    const result = manager.detectThinkingLevel("ultrathink and think");
    expect(result.level).toBe("exhaustive");
  });

  it("should not match partial words", () => {
    // "thinking" should not match "think" due to word boundary
    const result = manager.detectThinkingLevel("I was thinking about something");
    expect(result.detected).toBe(false);
  });

  it("should handle special characters in input", () => {
    const result = manager.detectThinkingLevel("think about @#$%^& this");
    expect(result.detected).toBe(true);
    expect(result.level).toBe("standard");
  });

  it("should handle very long input", () => {
    const longText = "a".repeat(10000) + " megathink " + "b".repeat(10000);
    const result = manager.detectThinkingLevel(longText);
    expect(result.detected).toBe(true);
    expect(result.level).toBe("deep");
  });
});
