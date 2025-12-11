/**
 * Tests for GitHub Actions Integration
 */

import {
  GitHubActionsManager,
  getGitHubActionsManager,
  resetGitHubActionsManager,
} from "../../src/integrations/github-actions";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("GitHubActionsManager", () => {
  let manager: GitHubActionsManager;
  let tempDir: string;

  beforeEach(() => {
    resetGitHubActionsManager();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gha-test-"));
    const workflowsDir = path.join(tempDir, ".github", "workflows");
    fs.mkdirSync(workflowsDir, { recursive: true });

    manager = new GitHubActionsManager({
      workflowsDir,
    });
  });

  afterEach(() => {
    resetGitHubActionsManager();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Templates", () => {
    it("should list available templates", () => {
      const templates = manager.getTemplates();

      expect(templates.length).toBeGreaterThan(0);
      expect(templates).toContain("node-ci");
      expect(templates).toContain("python-ci");
      expect(templates).toContain("security-scan");
    });

    it("should get template by name", () => {
      const template = manager.getTemplate("node-ci");

      expect(template).toBeDefined();
      expect(template?.name).toBe("Node.js CI");
      expect(template?.on).toBeDefined();
      expect(template?.jobs).toBeDefined();
    });

    it("should return null for unknown template", () => {
      const template = manager.getTemplate("nonexistent");
      expect(template).toBeNull();
    });
  });

  describe("Workflow Creation", () => {
    it("should create workflow from template", async () => {
      const workflowPath = await manager.createFromTemplate("node-ci");

      expect(fs.existsSync(workflowPath)).toBe(true);
      expect(workflowPath).toContain("node-ci.yml");
    });

    it("should create workflow with custom filename", async () => {
      const workflowPath = await manager.createFromTemplate("node-ci", "custom-ci.yml");

      expect(workflowPath).toContain("custom-ci.yml");
      expect(fs.existsSync(workflowPath)).toBe(true);
    });

    it("should reject duplicate workflow", async () => {
      await manager.createFromTemplate("node-ci");

      await expect(manager.createFromTemplate("node-ci"))
        .rejects.toThrow("already exists");
    });

    it("should create custom workflow", async () => {
      const config = {
        name: "Custom Workflow",
        on: {
          push: { branches: ["main"] },
        },
        jobs: {
          test: {
            "runs-on": "ubuntu-latest",
            steps: [
              { uses: "actions/checkout@v4" },
              { run: "echo Hello" },
            ],
          },
        },
      };

      const workflowPath = await manager.createWorkflow(config, "custom.yml");
      expect(fs.existsSync(workflowPath)).toBe(true);

      const content = fs.readFileSync(workflowPath, "utf-8");
      expect(content).toContain("Custom Workflow");
    });
  });

  describe("Workflow Listing", () => {
    it("should list workflows", async () => {
      await manager.createFromTemplate("node-ci");
      await manager.createFromTemplate("python-ci");

      const workflows = manager.listWorkflows();

      expect(workflows.length).toBe(2);
      expect(workflows.some(w => w.name === "Node.js CI")).toBe(true);
    });

    it("should return empty array when no workflows", () => {
      const workflows = manager.listWorkflows();
      expect(workflows).toEqual([]);
    });
  });

  describe("Workflow Reading", () => {
    it("should read workflow file", async () => {
      await manager.createFromTemplate("node-ci");

      const config = manager.readWorkflow("node-ci.yml");

      expect(config).toBeDefined();
      expect(config?.name).toBe("Node.js CI");
    });

    it("should return null for missing workflow", () => {
      const config = manager.readWorkflow("missing.yml");
      expect(config).toBeNull();
    });
  });

  describe("Workflow Deletion", () => {
    it("should delete workflow", async () => {
      await manager.createFromTemplate("node-ci");

      const deleted = manager.deleteWorkflow("node-ci.yml");

      expect(deleted).toBe(true);
      expect(manager.listWorkflows().length).toBe(0);
    });

    it("should return false for missing workflow", () => {
      const deleted = manager.deleteWorkflow("missing.yml");
      expect(deleted).toBe(false);
    });
  });

  describe("Workflow Validation", () => {
    it("should validate correct workflow", () => {
      const config = {
        name: "Valid Workflow",
        on: { push: { branches: ["main"] } },
        jobs: {
          build: {
            "runs-on": "ubuntu-latest",
            steps: [{ run: "echo test" }],
          },
        },
      };

      const result = manager.validateWorkflow(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect missing name", () => {
      const config = {
        on: { push: {} },
        jobs: {
          build: {
            "runs-on": "ubuntu-latest",
            steps: [{ run: "test" }],
          },
        },
      } as any;

      const result = manager.validateWorkflow(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("name"))).toBe(true);
    });

    it("should detect missing triggers", () => {
      const config = {
        name: "No Triggers",
        on: {},
        jobs: {
          build: {
            "runs-on": "ubuntu-latest",
            steps: [{ run: "test" }],
          },
        },
      } as any;

      const result = manager.validateWorkflow(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("trigger"))).toBe(true);
    });

    it("should detect missing runs-on", () => {
      const config = {
        name: "Missing Runner",
        on: { push: {} },
        jobs: {
          build: {
            steps: [{ run: "test" }],
          },
        },
      } as any;

      const result = manager.validateWorkflow(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("runs-on"))).toBe(true);
    });
  });

  describe("Workflow Analysis", () => {
    it("should analyze workflow for improvements", () => {
      const config = {
        name: "Unoptimized",
        on: { push: { branches: ["main"] } },
        jobs: {
          build: {
            "runs-on": "ubuntu-latest",
            steps: [
              { uses: "actions/checkout@v4" },
              { uses: "actions/setup-node" }, // Unpinned version
              { run: "npm ci" },
            ],
          },
        },
      };

      const suggestions = manager.analyzeWorkflow(config);

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some(s => s.type === "security")).toBe(true);
    });

    it("should suggest caching", () => {
      const config = {
        name: "No Cache",
        on: { push: { branches: ["main"] } },
        jobs: {
          build: {
            "runs-on": "ubuntu-latest",
            steps: [
              { uses: "actions/checkout@v4" },
              { uses: "actions/setup-node@v4" }, // No cache option
              { run: "npm ci" },
            ],
          },
        },
      };

      const suggestions = manager.analyzeWorkflow(config);

      expect(suggestions.some(s => s.type === "caching")).toBe(true);
    });
  });

  describe("Summary Formatting", () => {
    it("should format summary", async () => {
      await manager.createFromTemplate("node-ci");

      const summary = manager.formatSummary();

      expect(summary).toContain("GitHub Actions Workflows");
      expect(summary).toContain("Node.js CI");
    });

    it("should show templates when no workflows", () => {
      const summary = manager.formatSummary();

      expect(summary).toContain("No workflows found");
      expect(summary).toContain("templates");
    });
  });

  describe("Singleton Pattern", () => {
    it("should return same instance", () => {
      const instance1 = getGitHubActionsManager();
      const instance2 = getGitHubActionsManager();

      expect(instance1).toBe(instance2);
    });

    it("should reset singleton", () => {
      const instance1 = getGitHubActionsManager();
      resetGitHubActionsManager();
      const instance2 = getGitHubActionsManager();

      expect(instance1).not.toBe(instance2);
    });
  });
});
