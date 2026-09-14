/**
 * Tests for SkillManager
 */

import { SkillManager, Skill } from "../../src/skills/skill-manager.js";
import * as fs from "fs-extra";
import * as path from "path";
import * as os from "os";
import { getSkillsHub, resetSkillsHub } from "../../src/skills/hub.js";

describe("SkillManager", () => {
  let skillManager: SkillManager;
  let tempDir: string;

  beforeEach(async () => {
    resetSkillsHub();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-test-"));
    getSkillsHub({
      lockfilePath: path.join(tempDir, "skills-lock.json"),
      cacheDir: path.join(tempDir, "cache"),
      skillsDir: path.join(tempDir, "managed"),
      tapsPath: path.join(tempDir, "taps.json"),
      trustedKeysPath: path.join(tempDir, "trusted-keys.json"),
    });
    skillManager = new SkillManager(tempDir);
    await skillManager.initialize();
  });

  afterEach(async () => {
    resetSkillsHub();
    await fs.remove(tempDir);
  });

  describe("Predefined Skills", () => {
    it("should load predefined skills", () => {
      const skills = skillManager.getAvailableSkills();
      expect(skills).toContain("typescript-expert");
      expect(skills).toContain("react-specialist");
      expect(skills).toContain("api-designer");
      expect(skills).toContain("database-expert");
      expect(skills).toContain("security-auditor");
    });

    it("should get skill by name", () => {
      const skill = skillManager.getSkill("typescript-expert");
      expect(skill).not.toBeNull();
      expect(skill?.name).toBe("typescript-expert");
      expect(skill?.triggers).toContain("typescript");
      expect(skill?.autoActivate).toBe(true);
    });

    it("should return null for unknown skill", () => {
      const skill = skillManager.getSkill("nonexistent-skill");
      expect(skill).toBeNull();
    });
  });

  describe("Skill Matching", () => {
    it("should match skills based on input text", () => {
      const matches = skillManager.matchSkills("I have a typescript type error");
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].skill.name).toBe("typescript-expert");
      expect(matches[0].matchedTriggers).toContain("typescript");
    });

    it("should match multiple triggers", () => {
      const matches = skillManager.matchSkills("React component with useState hook");
      expect(matches.length).toBeGreaterThan(0);
      const reactMatch = matches.find(m => m.skill.name === "react-specialist");
      expect(reactMatch).toBeDefined();
      expect(reactMatch?.matchedTriggers.length).toBeGreaterThanOrEqual(2);
    });

    it("should sort matches by score", () => {
      const matches = skillManager.matchSkills("typescript react component", 3);
      expect(matches.length).toBeGreaterThanOrEqual(2);
      // Higher scores should come first
      for (let i = 1; i < matches.length; i++) {
        expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
      }
    });

    it("should return empty array when no matches", () => {
      const matches = skillManager.matchSkills("random unrelated text xyz");
      expect(matches).toEqual([]);
    });

    it("should respect topN parameter", () => {
      const matches = skillManager.matchSkills("typescript react api database", 2);
      expect(matches.length).toBeLessThanOrEqual(2);
    });
  });

  describe("Auto Select Skill", () => {
    it("should auto-select best matching skill", () => {
      const skill = skillManager.autoSelectSkill("Fix this typescript generic type");
      expect(skill).not.toBeNull();
      expect(skill?.name).toBe("typescript-expert");
    });

    it("should return null when score too low", () => {
      const skill = skillManager.autoSelectSkill("hi");
      expect(skill).toBeNull();
    });
  });

  describe("Custom Skills", () => {
    it("should register skill programmatically", () => {
      const customSkill: Skill = {
        name: "custom-test",
        description: "Test skill",
        triggers: ["custom", "test"],
        systemPrompt: "You are a test assistant",
        priority: 5,
        autoActivate: true,
      };

      skillManager.registerSkill(customSkill);

      const skill = skillManager.getSkill("custom-test");
      expect(skill).not.toBeNull();
      expect(skill?.description).toBe("Test skill");
    });

    it("should load skills from SKILL.md files", async () => {
      // Create a custom skill directory
      const skillDir = path.join(tempDir, ".codebuddy", "skills", "my-skill");
      await fs.ensureDir(skillDir);

      const skillContent = `---
name: my-skill
description: My custom skill
triggers: [mytest, custom]
priority: 10
autoActivate: true
---

You are a custom assistant for testing.
`;
      await fs.writeFile(path.join(skillDir, "SKILL.md"), skillContent);

      // Reload skills
      const manager = new SkillManager(tempDir);
      await manager.initialize();

      const skill = manager.getSkill("my-skill");
      expect(skill).not.toBeNull();
      expect(skill?.triggers).toContain("mytest");
      expect(skill?.systemPrompt).toContain("custom assistant");
    });
  });

  describe("Skill Activation", () => {
    it("should activate skill and emit event", () => {
      const eventHandler = jest.fn();
      skillManager.on("skill:activated", eventHandler);

      const result = skillManager.activateSkill("typescript-expert");

      expect(result).not.toBeNull();
      expect(skillManager.getActiveSkill()?.name).toBe("typescript-expert");
      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({ skill: "typescript-expert", manual: true })
      );
    });

    it("should deactivate skill and emit event", () => {
      const eventHandler = jest.fn();
      skillManager.on("skill:deactivated", eventHandler);

      skillManager.activateSkill("typescript-expert");
      skillManager.deactivateSkill();

      expect(skillManager.getActiveSkill()).toBeNull();
      expect(eventHandler).toHaveBeenCalled();
    });

    it("should return null when activating unknown skill", () => {
      const result = skillManager.activateSkill("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("Priority Handling", () => {
    it("should boost score based on priority", () => {
      // Register two skills with same triggers but different priorities
      skillManager.registerSkill({
        name: "low-priority",
        description: "Low priority",
        triggers: ["testpriority"],
        systemPrompt: "Low",
        priority: 1,
        autoActivate: true,
      });

      skillManager.registerSkill({
        name: "high-priority",
        description: "High priority",
        triggers: ["testpriority"],
        systemPrompt: "High",
        priority: 20,
        autoActivate: true,
      });

      const matches = skillManager.matchSkills("testpriority trigger");
      const highMatch = matches.find(m => m.skill.name === "high-priority");
      const lowMatch = matches.find(m => m.skill.name === "low-priority");

      expect(highMatch?.score).toBeGreaterThan(lowMatch?.score ?? 0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty input", () => {
      const matches = skillManager.matchSkills("");
      expect(matches).toEqual([]);
    });

    it("should be case insensitive", () => {
      const matches = skillManager.matchSkills("TYPESCRIPT TYPE ERROR");
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].skill.name).toBe("typescript-expert");
    });

    it("should handle skills without autoActivate", () => {
      skillManager.registerSkill({
        name: "manual-only",
        description: "Manual skill",
        triggers: ["manual"],
        systemPrompt: "Manual",
        autoActivate: false,
      });

      // Should not match in auto-match
      const matches = skillManager.matchSkills("manual trigger");
      const manualMatch = matches.find(m => m.skill.name === "manual-only");
      expect(manualMatch).toBeUndefined();

      // But should be activatable (returns the skill, not boolean)
      const result = skillManager.activateSkill("manual-only");
      expect(result).not.toBeNull();
      expect(result?.name).toBe("manual-only");
    });
  });

  describe("Disabled Skills", () => {
    it("should exclude disabled skills from matching", async () => {
      // 1. Initialize the hub with the temp lockfile first (so getSkillsHub() uses it throughout this test)
      const { getSkillsHub } = await import("../../src/skills/hub.js");
      const hub = getSkillsHub({ lockfilePath: path.join(tempDir, "skills-lock.json") });

      // Register custom skill we can disable
      const skillName = "custom-disable-test";
      skillManager.registerSkill({
        name: skillName,
        description: "To be disabled",
        triggers: ["disabletrigger"],
        systemPrompt: "Prompt",
        autoActivate: true,
      });

      // Initially it should match
      let matches = skillManager.matchSkills("disabletrigger test");
      expect(matches.some(m => m.skill.name === skillName)).toBe(true);

      // Disable the skill via the hub
      hub.setEnabled(skillName, false, { path: path.join(tempDir, "dummy-path") });

      // Now matching should ignore it
      matches = skillManager.matchSkills("disabletrigger test");
      expect(matches.some(m => m.skill.name === skillName)).toBe(false);
    });

    it("should exclude disabled skills from system prompt injection", async () => {
      // 1. Initialize the hub with the temp lockfile first
      const { getSkillsHub } = await import("../../src/skills/hub.js");
      const hub = getSkillsHub({ lockfilePath: path.join(tempDir, "skills-lock.json") });

      const skillName = "custom-prompt-disable-test";
      skillManager.registerSkill({
        name: skillName,
        description: "To be disabled",
        triggers: ["promptdisable"],
        systemPrompt: "System Prompt content",
        autoActivate: true,
      });

      // Activate the skill
      skillManager.activateSkill(skillName);
      let prompt = skillManager.getSkillPromptEnhancement();
      expect(prompt).toContain("System Prompt content");

      // Disable it via the hub
      hub.setEnabled(skillName, false, { path: path.join(tempDir, "dummy-path") });

      // System prompt should now be empty for the disabled skill
      prompt = skillManager.getSkillPromptEnhancement();
      expect(prompt).toBe("");
    });
  });
});
