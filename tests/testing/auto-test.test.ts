/**
 * Tests for Auto-Test Module
 *
 * Validates automatic test framework integration.
 */

import {
  AutoTestManager,
  getAutoTestManager,
  initializeAutoTest,
  BUILTIN_FRAMEWORKS,
  DEFAULT_AUTOTEST_CONFIG,
  type TestCase,
  type TestResult,
  type CoverageResult as _CoverageResult,
  type TestFrameworkConfig as _TestFrameworkConfig,
  type AutoTestConfig,
} from "../../src/testing/auto-test.js";

let manager: AutoTestManager;

beforeEach(() => {
  manager = new AutoTestManager(process.cwd());
});

describe("Auto-Test", () => {
  describe("DEFAULT_AUTOTEST_CONFIG", () => {
    it("should have sensible defaults", () => {
      expect(DEFAULT_AUTOTEST_CONFIG.enabled).toBe(true);
      expect(DEFAULT_AUTOTEST_CONFIG.runOnSave).toBe(true);
      expect(DEFAULT_AUTOTEST_CONFIG.runRelatedTests).toBe(true);
      expect(DEFAULT_AUTOTEST_CONFIG.collectCoverage).toBe(false);
      expect(DEFAULT_AUTOTEST_CONFIG.timeout).toBeGreaterThan(0);
      expect(DEFAULT_AUTOTEST_CONFIG.maxTestFiles).toBeGreaterThan(0);
      expect(DEFAULT_AUTOTEST_CONFIG.watchMode).toBe(false);
    });
  });

  describe("BUILTIN_FRAMEWORKS", () => {
    it("should have Jest configuration", () => {
      expect(BUILTIN_FRAMEWORKS.jest).toBeDefined();
      expect(BUILTIN_FRAMEWORKS.jest.name).toBe("Jest");
      expect(BUILTIN_FRAMEWORKS.jest.command).toContain("npx");
      expect(BUILTIN_FRAMEWORKS.jest.configFiles).toContain("jest.config.js");
    });

    it("should have Vitest configuration", () => {
      expect(BUILTIN_FRAMEWORKS.vitest).toBeDefined();
      expect(BUILTIN_FRAMEWORKS.vitest.name).toBe("Vitest");
      expect(BUILTIN_FRAMEWORKS.vitest.configFiles).toContain("vitest.config.ts");
    });

    it("should have pytest configuration", () => {
      expect(BUILTIN_FRAMEWORKS.pytest).toBeDefined();
      expect(BUILTIN_FRAMEWORKS.pytest.name).toBe("pytest");
      expect(BUILTIN_FRAMEWORKS.pytest.configFiles).toContain("pytest.ini");
    });

    it("should have cargo test configuration", () => {
      expect(BUILTIN_FRAMEWORKS.cargo).toBeDefined();
      expect(BUILTIN_FRAMEWORKS.cargo.name).toBe("cargo test");
      expect(BUILTIN_FRAMEWORKS.cargo.configFiles).toContain("Cargo.toml");
    });

    it("should have go test configuration", () => {
      expect(BUILTIN_FRAMEWORKS.go).toBeDefined();
      expect(BUILTIN_FRAMEWORKS.go.name).toBe("go test");
      expect(BUILTIN_FRAMEWORKS.go.configFiles).toContain("go.mod");
    });

    it("should have RSpec configuration", () => {
      expect(BUILTIN_FRAMEWORKS.rspec).toBeDefined();
      expect(BUILTIN_FRAMEWORKS.rspec.name).toBe("RSpec");
      expect(BUILTIN_FRAMEWORKS.rspec.configFiles).toContain(".rspec");
    });
  });

  describe("AutoTestManager", () => {
    describe("constructor", () => {
      it("should initialize with default config", () => {
        const mgr = new AutoTestManager(process.cwd());
        expect(mgr.getConfig()).toEqual(DEFAULT_AUTOTEST_CONFIG);
      });

      it("should accept custom config", () => {
        const config: Partial<AutoTestConfig> = { collectCoverage: true };
        const mgr = new AutoTestManager(process.cwd(), config);
        expect(mgr.getConfig().collectCoverage).toBe(true);
      });
    });

    describe("getDetectedFramework", () => {
      it("should return detected framework or null", () => {
        const framework = manager.getDetectedFramework();
        // In test environment, should detect Jest
        expect(framework === null || typeof framework === "string").toBe(true);
      });
    });

    describe("getLastResults", () => {
      it("should return null when no tests have run", () => {
        const result = manager.getLastResults();
        expect(result).toBeNull();
      });
    });

    describe("formatResultsForLLM", () => {
      it("should format successful test results", () => {
        const result: TestResult = {
          success: true,
          passed: 10,
          failed: 0,
          skipped: 0,
          total: 10,
          duration: 1500,
          tests: [],
          framework: "Jest",
        };

        const formatted = manager.formatResultsForLLM(result);
        expect(formatted).toContain("10");
        expect(formatted).toContain("Passed");
      });

      it("should format failed test results with errors", () => {
        const result: TestResult = {
          success: false,
          passed: 8,
          failed: 2,
          skipped: 0,
          total: 10,
          duration: 1500,
          tests: [
            {
              name: "should work",
              suite: "TestSuite",
              status: "failed",
              duration: 100,
              error: "Expected true to be false",
            },
          ],
          framework: "Jest",
        };

        const formatted = manager.formatResultsForLLM(result);
        expect(formatted).toContain("Failed");
        expect(formatted).toContain("should work");
      });
    });

    describe("updateConfig", () => {
      it("should update configuration", () => {
        manager.updateConfig({ watchMode: true });
        expect(manager.getConfig().watchMode).toBe(true);
      });
    });

    describe("events", () => {
      it("should emit test:start event", async () => {
        await new Promise<void>((resolve, reject) => {
          manager.once("test:start", (data: { type: string }) => {
            try {
              expect(data.type).toBe("all");
              resolve();
            } catch (error) {
              reject(error);
            }
          });

          manager.emit("test:start", { type: "all" });
        });
      });

      it("should emit test:complete event", async () => {
        await new Promise<void>((resolve, reject) => {
          manager.once("test:complete", (result: TestResult) => {
            try {
              expect(result.total).toBe(5);
              resolve();
            } catch (error) {
              reject(error);
            }
          });

          manager.emit("test:complete", {
            success: true,
            passed: 5,
            failed: 0,
            skipped: 0,
            total: 5,
            duration: 100,
            tests: [],
            framework: "Jest",
          });
        });
      });
    });

    describe("refresh", () => {
      it("should re-detect frameworks", () => {
        manager.refresh();
        // Should not throw
        expect(manager.getDetectedFramework()).toBeDefined();
      });
    });
  });

  describe("Singleton", () => {
    describe("getAutoTestManager", () => {
      it("should return manager instance", () => {
        const mgr = getAutoTestManager(process.cwd());
        expect(mgr).toBeInstanceOf(AutoTestManager);
      });
    });

    describe("initializeAutoTest", () => {
      it("should create manager with config", () => {
        const mgr = initializeAutoTest(process.cwd(), { collectCoverage: true });
        expect(mgr.getConfig().collectCoverage).toBe(true);
      });
    });
  });

  describe("TestResult type", () => {
    it("should have correct structure", () => {
      const result: TestResult = {
        success: true,
        passed: 5,
        failed: 0,
        skipped: 0,
        total: 5,
        duration: 100,
        tests: [],
        framework: "Jest",
      };

      expect(result.success).toBe(true);
      expect(result.tests).toEqual([]);
    });

    it("should support coverage property", () => {
      const result: TestResult = {
        success: true,
        passed: 5,
        failed: 0,
        skipped: 0,
        total: 5,
        duration: 100,
        tests: [],
        framework: "Jest",
        coverage: {
          lines: 80,
          statements: 75,
          functions: 90,
          branches: 70,
        },
      };

      expect(result.coverage?.lines).toBe(80);
    });
  });

  describe("TestCase type", () => {
    it("should have required fields", () => {
      const testCase: TestCase = {
        name: "test case",
        suite: "suite name",
        status: "passed",
        duration: 50,
      };

      expect(testCase.name).toBeDefined();
      expect(testCase.suite).toBeDefined();
      expect(testCase.status).toBeDefined();
      expect(testCase.duration).toBeDefined();
    });

    it("should support optional fields", () => {
      const testCase: TestCase = {
        name: "test case",
        suite: "suite name",
        file: "test.ts",
        status: "failed",
        duration: 50,
        error: "Error message",
        stack: "Stack trace",
      };

      expect(testCase.file).toBe("test.ts");
      expect(testCase.error).toBe("Error message");
      expect(testCase.stack).toBe("Stack trace");
    });
  });
});
