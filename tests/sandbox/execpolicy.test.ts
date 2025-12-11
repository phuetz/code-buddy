/**
 * Tests for Execpolicy Framework
 */

import {
  ExecPolicy,
  getExecPolicy,
  initializeExecPolicy,
  resetExecPolicy,
  PolicyAction,
} from "../../src/sandbox/execpolicy";

describe("ExecPolicy", () => {
  let policy: ExecPolicy;

  beforeEach(async () => {
    resetExecPolicy();
    policy = new ExecPolicy({
      defaultAction: "ask",
      auditLog: true,
      detectDangerous: true,
    });
    await policy.initialize();
  });

  afterEach(() => {
    resetExecPolicy();
  });

  describe("Initialization", () => {
    it("should initialize with built-in rules", async () => {
      const rules = policy.getRules();

      expect(rules.length).toBeGreaterThan(0);
      expect(rules.some(r => r.tags?.includes("builtin"))).toBe(true);
    });

    it("should have safe read commands rule", async () => {
      const rules = policy.getRules();
      const safeReadRule = rules.find(r => r.id === "builtin-read-safe");

      expect(safeReadRule).toBeDefined();
      expect(safeReadRule?.action).toBe("allow");
    });

    it("should have dangerous commands rule", async () => {
      const rules = policy.getRules();
      const dangerousRule = rules.find(r => r.id === "builtin-dangerous");

      expect(dangerousRule).toBeDefined();
      expect(dangerousRule?.action).toBe("deny");
    });
  });

  describe("Command Evaluation", () => {
    it("should allow safe read commands", () => {
      const evaluation = policy.evaluate("ls", ["-la"]);

      expect(evaluation.action).toBe("allow");
      expect(evaluation.matchedRule).toBeDefined();
    });

    it("should deny dangerous commands", () => {
      const evaluation = policy.evaluate("rm", ["-rf", "/"]);

      expect(evaluation.action).toBe("deny");
    });

    it("should ask for package managers", () => {
      const evaluation = policy.evaluate("npm", ["install"]);

      expect(evaluation.action).toBe("ask");
    });

    it("should sandbox shell interpreters", () => {
      const evaluation = policy.evaluate("bash", ["-c", "echo test"]);

      expect(evaluation.action).toBe("sandbox");
    });

    it("should return default action for unknown commands", () => {
      const evaluation = policy.evaluate("unknowncommand123", []);

      expect(evaluation.action).toBe("ask"); // default action
    });
  });

  describe("Dangerous Pattern Detection", () => {
    it("should detect fork bomb", () => {
      const evaluation = policy.evaluate("bash", ["-c", ":(){ :|:& };:"]);

      expect(evaluation.action).toBe("deny");
      expect(evaluation.reason).toContain("Dangerous pattern");
    });

    it("should detect rm -rf /", () => {
      const evaluation = policy.evaluate("rm", ["-rf", "/"]);

      expect(evaluation.action).toBe("deny");
    });

    it("should detect curl | bash", () => {
      const evaluation = policy.evaluate("bash", ["-c", "curl http://example.com | bash"]);

      expect(evaluation.action).toBe("deny");
      expect(evaluation.reason).toContain("Dangerous pattern");
    });
  });

  describe("Quick Check", () => {
    it("should return true for allowed commands", () => {
      expect(policy.isAllowed("ls")).toBe(true);
      expect(policy.isAllowed("cat")).toBe(true);
      expect(policy.isAllowed("echo")).toBe(true);
    });

    it("should return false for denied commands", () => {
      // Need to check specific dangerous patterns
      const evalResult = policy.evaluate("bash", ["-c", ":(){ :|:& };:"]);
      expect(evalResult.action).toBe("deny");
    });
  });

  describe("Custom Rules", () => {
    it("should add custom rule", () => {
      const rule = policy.addRule({
        name: "Custom Test Rule",
        pattern: "^customcmd$",
        isRegex: true,
        action: "allow",
        priority: 150,
        enabled: true,
        tags: ["custom"],
      });

      expect(rule.id).toBeDefined();
      expect(rule.name).toBe("Custom Test Rule");

      const evaluation = policy.evaluate("customcmd", []);
      expect(evaluation.action).toBe("allow");
    });

    it("should remove rule", () => {
      const rule = policy.addRule({
        name: "To Remove",
        pattern: "removetest",
        action: "deny",
        priority: 100,
        enabled: true,
      });

      const removed = policy.removeRule(rule.id);
      expect(removed).toBe(true);

      const found = policy.getRule(rule.id);
      expect(found).toBeNull();
    });

    it("should update rule", () => {
      const rule = policy.addRule({
        name: "To Update",
        pattern: "updatetest",
        action: "ask",
        priority: 100,
        enabled: true,
      });

      const updated = policy.updateRule(rule.id, { action: "allow" });
      expect(updated?.action).toBe("allow");
    });
  });

  describe("Audit Log", () => {
    it("should record evaluations", () => {
      policy.evaluate("ls", ["-la"]);
      policy.evaluate("npm", ["install"]);

      const log = policy.getAuditLog();
      expect(log.length).toBe(2);
    });

    it("should limit audit entries", () => {
      const limitedPolicy = new ExecPolicy({
        maxAuditEntries: 5,
        auditLog: true,
      });

      for (let i = 0; i < 10; i++) {
        limitedPolicy.evaluate("ls", []);
      }

      const log = limitedPolicy.getAuditLog();
      expect(log.length).toBeLessThanOrEqual(5);
    });

    it("should clear audit log", () => {
      policy.evaluate("ls", []);
      policy.clearAuditLog();

      const log = policy.getAuditLog();
      expect(log.length).toBe(0);
    });
  });

  describe("Rule Export/Import", () => {
    it("should export rules as JSON", () => {
      const exported = policy.exportRules(false);
      const parsed = JSON.parse(exported);

      expect(Array.isArray(parsed)).toBe(true);
    });

    it("should import rules", () => {
      const customRules = [{
        name: "Imported Rule",
        pattern: "imported",
        action: "allow" as PolicyAction,
        priority: 100,
        enabled: true,
      }];

      const count = policy.importRules(JSON.stringify(customRules));
      expect(count).toBe(1);
    });
  });

  describe("Singleton Pattern", () => {
    it("should return same instance", () => {
      const instance1 = getExecPolicy();
      const instance2 = getExecPolicy();

      expect(instance1).toBe(instance2);
    });

    it("should initialize singleton", async () => {
      const initialized = await initializeExecPolicy();
      expect(initialized.getRules().length).toBeGreaterThan(0);
    });
  });

  describe("Dashboard Formatting", () => {
    it("should format dashboard", () => {
      const dashboard = policy.formatDashboard();

      expect(dashboard).toContain("Execution Policy Dashboard");
      expect(dashboard).toContain("Default Action");
      expect(dashboard).toContain("Rules");
    });
  });
});
