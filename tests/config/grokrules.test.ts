/**
 * Tests for .codebuddyrules Support
 */

import {
  CodeBuddyRulesManager,
  getCodeBuddyRulesManager,
  initializeCodeBuddyRules,
  resetCodeBuddyRulesManager,
  CodeBuddyRules,
} from "../../src/config/codebuddyrules";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("CodeBuddyRulesManager", () => {
  let manager: CodeBuddyRulesManager;
  let tempDir: string;

  beforeEach(() => {
    resetCodeBuddyRulesManager();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebuddyrules-test-"));
    manager = new CodeBuddyRulesManager({
      enableGlobalRules: false,
      inheritFromParent: false,
    });
  });

  afterEach(() => {
    resetCodeBuddyRulesManager();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Initialization", () => {
    it("should initialize with default rules", async () => {
      await manager.initialize(tempDir);

      const rules = manager.getRules();

      expect(rules).toBeDefined();
      expect(rules.version).toBeDefined();
    });

    it("should report initialization status", async () => {
      expect(manager.isInitialized()).toBe(false);

      await manager.initialize(tempDir);

      expect(manager.isInitialized()).toBe(true);
    });
  });

  describe("Loading Rules Files", () => {
    it("should load .codebuddyrules YAML file", async () => {
      const rulesContent = `
description: Test Project
languages:
  - typescript
instructions:
  - Use strict mode
`;
      fs.writeFileSync(path.join(tempDir, ".codebuddyrules"), rulesContent);

      await manager.initialize(tempDir);
      const rules = manager.getRules();

      expect(rules.description).toBe("Test Project");
      expect(rules.languages).toContain("typescript");
      expect(rules.instructions).toContain("Use strict mode");
    });

    it("should load .codebuddyrules.json file", async () => {
      const rulesContent: CodeBuddyRules = {
        description: "JSON Project",
        frameworks: ["react", "next"],
      };
      fs.writeFileSync(
        path.join(tempDir, ".codebuddyrules.json"),
        JSON.stringify(rulesContent)
      );

      await manager.initialize(tempDir);
      const rules = manager.getRules();

      expect(rules.description).toBe("JSON Project");
      expect(rules.frameworks).toContain("react");
    });

    it("should track loaded files", async () => {
      fs.writeFileSync(
        path.join(tempDir, ".codebuddyrules"),
        "description: Test"
      );

      await manager.initialize(tempDir);
      const files = manager.getLoadedFiles();

      expect(files.length).toBe(1);
      expect(files[0]).toContain(".codebuddyrules");
    });
  });

  describe("Style Configuration", () => {
    it("should load style preferences", async () => {
      const rulesContent = `
style:
  indentation: tabs
  indentSize: 4
  quotes: double
  semicolons: false
`;
      fs.writeFileSync(path.join(tempDir, ".codebuddyrules"), rulesContent);

      await manager.initialize(tempDir);
      const rules = manager.getRules();

      expect(rules.style?.indentation).toBe("tabs");
      expect(rules.style?.indentSize).toBe(4);
      expect(rules.style?.quotes).toBe("double");
      expect(rules.style?.semicolons).toBe(false);
    });
  });

  describe("Naming Conventions", () => {
    it("should load naming conventions", async () => {
      const rulesContent = `
naming:
  variables: snake_case
  functions: camelCase
  classes: PascalCase
  files: kebab-case
`;
      fs.writeFileSync(path.join(tempDir, ".codebuddyrules"), rulesContent);

      await manager.initialize(tempDir);
      const rules = manager.getRules();

      expect(rules.naming?.variables).toBe("snake_case");
      expect(rules.naming?.functions).toBe("camelCase");
    });
  });

  describe("Security Configuration", () => {
    it("should check allowed commands", async () => {
      const rulesContent = `
security:
  allowedCommands:
    - ls
    - cat
    - npm
  blockedCommands:
    - rm -rf /
`;
      fs.writeFileSync(path.join(tempDir, ".codebuddyrules"), rulesContent);

      await manager.initialize(tempDir);

      expect(manager.isCommandAllowed("ls -la")).toBe(true);
      expect(manager.isCommandAllowed("rm -rf /")).toBe(false);
    });

    it("should check blocked paths", async () => {
      // Use platform-appropriate absolute paths since isPathAllowed uses path.resolve + startsWith
      const blockedDir = path.resolve(tempDir, "blocked");
      const allowedDir = path.resolve(tempDir, "allowed");
      const rulesContent = `
security:
  blockedPaths:
    - ${blockedDir}
`;
      fs.writeFileSync(path.join(tempDir, ".codebuddyrules"), rulesContent);

      await manager.initialize(tempDir);

      expect(manager.isPathAllowed(path.join(blockedDir, "secret.txt"))).toBe(false);
      expect(manager.isPathAllowed(path.join(allowedDir, "file.txt"))).toBe(true);
    });
  });

  describe("Ignore Patterns", () => {
    it("should return ignore patterns", async () => {
      const rulesContent = `
ignore:
  - node_modules/**
  - dist/**
  - "*.log"
exclude:
  - coverage/**
`;
      fs.writeFileSync(path.join(tempDir, ".codebuddyrules"), rulesContent);

      await manager.initialize(tempDir);
      const patterns = manager.getIgnorePatterns();

      expect(patterns).toContain("node_modules/**");
      expect(patterns).toContain("coverage/**");
    });

    it("should return include patterns", async () => {
      const rulesContent = `
include:
  - src/**/*.ts
  - README.md
`;
      fs.writeFileSync(path.join(tempDir, ".codebuddyrules"), rulesContent);

      await manager.initialize(tempDir);
      const patterns = manager.getIncludePatterns();

      expect(patterns).toContain("src/**/*.ts");
      expect(patterns).toContain("README.md");
    });
  });

  describe("System Prompt Generation", () => {
    it("should generate system prompt additions", async () => {
      const rulesContent = `
description: My Awesome Project
languages:
  - typescript
  - rust
frameworks:
  - express
instructions:
  - Always write tests
  - Use async/await
style:
  quotes: single
`;
      fs.writeFileSync(path.join(tempDir, ".codebuddyrules"), rulesContent);

      await manager.initialize(tempDir);
      const prompt = manager.getSystemPromptAdditions();

      expect(prompt).toContain("My Awesome Project");
      expect(prompt).toContain("typescript");
      expect(prompt).toContain("Always write tests");
      expect(prompt).toContain("single quotes");
    });

    it("should include persona if specified", async () => {
      const rulesContent = `
persona:
  name: Senior Developer
  tone: technical
  expertise:
    - backend
    - databases
`;
      fs.writeFileSync(path.join(tempDir, ".codebuddyrules"), rulesContent);

      await manager.initialize(tempDir);
      const prompt = manager.getSystemPromptAdditions();

      expect(prompt).toContain("Senior Developer");
      expect(prompt).toContain("technical");
    });
  });

  describe("Custom Prompts", () => {
    it("should return custom prompts", async () => {
      const rulesContent = `
prompts:
  review: "Review this code for best practices"
  debug: "Help me debug this issue"
`;
      fs.writeFileSync(path.join(tempDir, ".codebuddyrules"), rulesContent);

      await manager.initialize(tempDir);

      expect(manager.getCustomPrompt("review")).toBe(
        "Review this code for best practices"
      );
      expect(manager.getCustomPrompt("debug")).toBe(
        "Help me debug this issue"
      );
      expect(manager.getCustomPrompt("nonexistent")).toBeUndefined();
    });
  });

  describe("Default Rules Creation", () => {
    it("should create default rules file", async () => {
      const rulesPath = await manager.createDefaultRules(tempDir);

      expect(fs.existsSync(rulesPath)).toBe(true);

      const content = fs.readFileSync(rulesPath, "utf-8");
      expect(content).toContain("description");
      expect(content).toContain("languages");
      expect(content).toContain("style");
    });
  });

  describe("Rule Inheritance", () => {
    it("should inherit rules from parent directories", async () => {
      const inheritManager = new CodeBuddyRulesManager({
        enableGlobalRules: false,
        inheritFromParent: true,
      });

      const parentDir = tempDir;
      const childDir = path.join(tempDir, "child");
      fs.mkdirSync(childDir);

      // Parent rules
      fs.writeFileSync(
        path.join(parentDir, ".codebuddyrules"),
        "description: Parent\nlanguages:\n  - javascript"
      );

      // Child rules
      fs.writeFileSync(
        path.join(childDir, ".codebuddyrules"),
        "frameworks:\n  - react"
      );

      await inheritManager.initialize(childDir);
      const rules = inheritManager.getRules();

      expect(rules.languages).toContain("javascript");
      expect(rules.frameworks).toContain("react");
    });
  });

  describe("Summary Formatting", () => {
    it("should format summary with rules", async () => {
      const rulesContent = `
description: Test Project
languages:
  - typescript
instructions:
  - Test 1
  - Test 2
`;
      fs.writeFileSync(path.join(tempDir, ".codebuddyrules"), rulesContent);

      await manager.initialize(tempDir);
      const summary = manager.formatSummary();

      expect(summary).toContain("Grok Rules");
      expect(summary).toContain("Test Project");
      expect(summary).toContain("typescript");
    });

    it("should show message when no rules found", async () => {
      await manager.initialize(tempDir);
      const summary = manager.formatSummary();

      expect(summary).toContain("No .codebuddyrules file found");
    });
  });

  describe("Singleton Pattern", () => {
    it("should return same instance", () => {
      const instance1 = getCodeBuddyRulesManager();
      const instance2 = getCodeBuddyRulesManager();

      expect(instance1).toBe(instance2);
    });

    it("should initialize via helper function", async () => {
      fs.writeFileSync(
        path.join(tempDir, ".codebuddyrules"),
        "description: Init Test"
      );

      const initialized = await initializeCodeBuddyRules(tempDir);

      expect(initialized.isInitialized()).toBe(true);
    });
  });

  describe("Event Emission", () => {
    it("should emit initialized event", async () => {
      const handler = jest.fn();
      manager.on("initialized", handler);

      await manager.initialize(tempDir);

      expect(handler).toHaveBeenCalled();
    });

    it("should emit rules:loaded event", async () => {
      const handler = jest.fn();
      manager.on("rules:loaded", handler);

      fs.writeFileSync(
        path.join(tempDir, ".codebuddyrules"),
        "description: Event Test"
      );

      await manager.initialize(tempDir);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.stringContaining(".codebuddyrules"),
        })
      );
    });
  });
});
