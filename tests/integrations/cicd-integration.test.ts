/**
 * Tests for CI/CD Integration Module
 *
 * Validates CI/CD workflow management.
 */

import {
  CICDManager,
  getCICDManager,
  initializeCICD,
  WORKFLOW_TEMPLATES,
  DEFAULT_CICD_CONFIG,
  type CICDProvider,
  type WorkflowStatus,
  type WorkflowRun,
  type WorkflowDefinition,
  type CICDConfig,
} from "../../src/integrations/cicd-integration.js";

let manager: CICDManager;

beforeEach(() => {
  manager = new CICDManager(process.cwd());
});

describe("CI/CD Integration", () => {
  describe("DEFAULT_CICD_CONFIG", () => {
    it("should have sensible defaults", () => {
      expect(DEFAULT_CICD_CONFIG.provider).toBe("github-actions");
      expect(DEFAULT_CICD_CONFIG.autoDetect).toBe(true);
      expect(DEFAULT_CICD_CONFIG.workflowsPath).toBe(".github/workflows");
      expect(DEFAULT_CICD_CONFIG.monitorRuns).toBe(true);
    });
  });

  describe("CICDProvider", () => {
    it("should include all supported providers", () => {
      const providers: CICDProvider[] = ["github-actions", "gitlab-ci", "jenkins", "circleci", "azure-pipelines"];
      providers.forEach((provider) => {
        expect(typeof provider).toBe("string");
      });
    });
  });

  describe("WORKFLOW_TEMPLATES", () => {
    it("should have node-ci template", () => {
      expect(WORKFLOW_TEMPLATES["node-ci"]).toBeDefined();
      expect(WORKFLOW_TEMPLATES["node-ci"]).toContain("Node.js CI");
      expect(WORKFLOW_TEMPLATES["node-ci"]).toContain("npm");
    });

    it("should have python-ci template", () => {
      expect(WORKFLOW_TEMPLATES["python-ci"]).toBeDefined();
      expect(WORKFLOW_TEMPLATES["python-ci"]).toContain("Python CI");
      expect(WORKFLOW_TEMPLATES["python-ci"]).toContain("pytest");
    });

    it("should have rust-ci template", () => {
      expect(WORKFLOW_TEMPLATES["rust-ci"]).toBeDefined();
      expect(WORKFLOW_TEMPLATES["rust-ci"]).toContain("Rust CI");
      expect(WORKFLOW_TEMPLATES["rust-ci"]).toContain("cargo");
    });

    it("should have docker-build template", () => {
      expect(WORKFLOW_TEMPLATES["docker-build"]).toBeDefined();
      expect(WORKFLOW_TEMPLATES["docker-build"]).toContain("Docker Build");
    });

    it("should have release template", () => {
      expect(WORKFLOW_TEMPLATES.release).toBeDefined();
      expect(WORKFLOW_TEMPLATES.release).toContain("Release");
    });

    it("should have valid YAML in templates", () => {
      Object.values(WORKFLOW_TEMPLATES).forEach((template) => {
        expect(template.length).toBeGreaterThan(0);
        // Basic YAML validation - should contain colons for key-value pairs
        expect(template).toContain(":");
      });
    });
  });

  describe("CICDManager", () => {
    describe("constructor", () => {
      it("should initialize with default config", () => {
        const mgr = new CICDManager(process.cwd());
        expect(mgr.getConfig()).toEqual(DEFAULT_CICD_CONFIG);
      });

      it("should accept custom config", () => {
        // Disable autoDetect to prevent provider override
        const config: Partial<CICDConfig> = { provider: "gitlab-ci", autoDetect: false };
        const mgr = new CICDManager(process.cwd(), config);
        expect(mgr.getConfig().provider).toBe("gitlab-ci");
      });
    });

    describe("getWorkflows", () => {
      it("should return array of workflows", () => {
        const workflows = manager.getWorkflows();
        expect(Array.isArray(workflows)).toBe(true);
      });
    });

    describe("getTemplates", () => {
      it("should return available template names", () => {
        const templates = manager.getTemplates();
        expect(Array.isArray(templates)).toBe(true);
        expect(templates).toContain("node-ci");
        expect(templates).toContain("python-ci");
      });
    });

    describe("validateWorkflow", () => {
      it("should validate correct workflow", () => {
        const workflow = `name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`;
        const result = manager.validateWorkflow(workflow);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should detect missing name", () => {
        const workflow = `on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`;
        const result = manager.validateWorkflow(workflow);
        expect(result.errors.some((e) => e.includes("name"))).toBe(true);
      });

      it("should detect invalid YAML", () => {
        const workflow = "this is not valid yaml: : :";
        const result = manager.validateWorkflow(workflow);
        expect(result.valid).toBe(false);
      });
    });

    describe("suggestWorkflow", () => {
      it("should suggest workflow based on project", () => {
        const suggestion = manager.suggestWorkflow();
        // In a Node.js project, should suggest node-ci
        expect(suggestion === "node-ci" || suggestion === null).toBe(true);
      });
    });

    describe("formatStatus", () => {
      it("should format status for display", () => {
        const status = manager.formatStatus();
        expect(status).toContain("CI/CD");
        expect(status).toContain("Provider");
      });
    });

    describe("updateConfig", () => {
      it("should update configuration", () => {
        manager.updateConfig({ autoDetect: false });
        expect(manager.getConfig().autoDetect).toBe(false);
      });
    });

    describe("getWorkflowRuns", () => {
      it("should return workflow runs array (empty without gh CLI)", async () => {
        const runs = await manager.getWorkflowRuns();
        expect(Array.isArray(runs)).toBe(true);
      }, 45000);
    });

    describe("events", () => {
      it("should emit workflows:detected event", (done) => {
        const mgr = new CICDManager(process.cwd(), { autoDetect: false });
        mgr.on("workflows:detected", (workflows: WorkflowDefinition[]) => {
          expect(Array.isArray(workflows)).toBe(true);
          done();
        });
        mgr.detectWorkflows();
      });
    });
  });

  describe("Singleton", () => {
    describe("getCICDManager", () => {
      it("should return manager instance", () => {
        const mgr = getCICDManager(process.cwd());
        expect(mgr).toBeInstanceOf(CICDManager);
      });
    });

    describe("initializeCICD", () => {
      it("should create manager with config", () => {
        // Disable autoDetect to prevent provider override
        const mgr = initializeCICD(process.cwd(), { provider: "circleci", autoDetect: false });
        expect(mgr.getConfig().provider).toBe("circleci");
      });
    });
  });

  describe("WorkflowStatus type", () => {
    it("should support all status values", () => {
      const statuses: WorkflowStatus[] = ["success", "failure", "pending", "running", "cancelled", "skipped"];
      statuses.forEach((status) => {
        expect(typeof status).toBe("string");
      });
    });
  });

  describe("WorkflowRun type", () => {
    it("should have correct structure", () => {
      const run: WorkflowRun = {
        id: "123",
        name: "CI",
        status: "success",
        branch: "main",
        commit: "abc1234",
      };

      expect(run.id).toBeDefined();
      expect(run.name).toBeDefined();
      expect(run.status).toBeDefined();
      expect(run.branch).toBeDefined();
      expect(run.commit).toBeDefined();
    });

    it("should support optional fields", () => {
      const run: WorkflowRun = {
        id: "123",
        name: "CI",
        status: "success",
        conclusion: "success",
        branch: "main",
        commit: "abc1234",
        url: "https://github.com/...",
        startedAt: new Date(),
        completedAt: new Date(),
        duration: 1000,
      };

      expect(run.conclusion).toBe("success");
      expect(run.url).toBeDefined();
      expect(run.startedAt).toBeInstanceOf(Date);
    });
  });

  describe("WorkflowDefinition type", () => {
    it("should have correct structure", () => {
      const def: WorkflowDefinition = {
        name: "CI",
        path: ".github/workflows/ci.yml",
        triggers: ["push", "pull_request"],
        jobs: ["build", "test"],
        provider: "github-actions",
      };

      expect(def.name).toBe("CI");
      expect(def.triggers).toContain("push");
      expect(def.jobs).toContain("build");
    });
  });
});
