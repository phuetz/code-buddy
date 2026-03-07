/**
 * Tests for TDD Mode Module
 *
 * Validates Test-Driven Development workflow implementation.
 * Research: TDD improves Pass@1 by 45.97% (ICSE 2024)
 */

import {
  TDDModeManager,
  getTDDManager,
  initializeTDD,
  TEST_TEMPLATES,
  DEFAULT_TDD_CONFIG,
  type TDDState as _TDDState,
  type TDDConfig,
  type TDDCycleResult as _TDDCycleResult,
} from "../../src/testing/tdd-mode.js";

describe("TDD Mode", () => {
  describe("DEFAULT_TDD_CONFIG", () => {
    it("should have sensible defaults", () => {
      expect(DEFAULT_TDD_CONFIG.maxIterations).toBe(5);
      expect(DEFAULT_TDD_CONFIG.autoApproveTests).toBe(false);
      expect(DEFAULT_TDD_CONFIG.generateEdgeCases).toBe(true);
      expect(DEFAULT_TDD_CONFIG.generateMocks).toBe(true);
      expect(DEFAULT_TDD_CONFIG.testCoverage).toBe("standard");
      expect(DEFAULT_TDD_CONFIG.language).toBe("typescript");
    });
  });

  describe("TEST_TEMPLATES", () => {
    it("should have typescript template", () => {
      expect(TEST_TEMPLATES.typescript).toBeDefined();
      expect(TEST_TEMPLATES.typescript.framework).toBe("jest");
      expect(TEST_TEMPLATES.typescript.template).toContain("describe");
    });

    it("should have python template", () => {
      expect(TEST_TEMPLATES.python).toBeDefined();
      expect(TEST_TEMPLATES.python.framework).toBe("pytest");
      expect(TEST_TEMPLATES.python.template).toContain("def test_");
    });

    it("should have go template", () => {
      expect(TEST_TEMPLATES.go).toBeDefined();
      expect(TEST_TEMPLATES.go.framework).toBe("testing");
      expect(TEST_TEMPLATES.go.template).toContain("func Test");
    });

    it("should have rust template", () => {
      expect(TEST_TEMPLATES.rust).toBeDefined();
      expect(TEST_TEMPLATES.rust.framework).toBe("cargo test");
      expect(TEST_TEMPLATES.rust.template).toContain("#[test]");
    });

    it("should have edge cases templates", () => {
      expect(TEST_TEMPLATES.typescript.edgeCasesTemplate).toContain("empty");
      expect(TEST_TEMPLATES.python.edgeCasesTemplate).toContain("None");
    });

    it("should have mocks templates", () => {
      expect(TEST_TEMPLATES.typescript.mocksTemplate).toMatch(/(?:vi|jest)\.mock/);
      expect(TEST_TEMPLATES.python.mocksTemplate).toContain("Mock");
    });
  });

  describe("TDDModeManager", () => {
    let manager: TDDModeManager;

    beforeEach(() => {
      manager = new TDDModeManager(process.cwd());
    });

    describe("constructor", () => {
      it("should initialize with default config", () => {
        const mgr = new TDDModeManager(process.cwd());
        expect(mgr.getState()).toBe("idle");
        expect(mgr.getConfig()).toEqual(DEFAULT_TDD_CONFIG);
      });

      it("should accept custom config", () => {
        const config: Partial<TDDConfig> = { maxIterations: 10 };
        const mgr = new TDDModeManager(process.cwd(), config);
        expect(mgr.getConfig().maxIterations).toBe(10);
      });
    });

    describe("getState", () => {
      it("should return current state", () => {
        expect(manager.getState()).toBe("idle");
      });
    });

    describe("isActive", () => {
      it("should return false when idle", () => {
        expect(manager.isActive()).toBe(false);
      });

      it("should return true when in active state", () => {
        manager.startCycle("Test requirements");
        expect(manager.isActive()).toBe(true);
      });
    });

    describe("updateConfig", () => {
      it("should update configuration", () => {
        manager.updateConfig({ maxIterations: 3 });
        expect(manager.getConfig().maxIterations).toBe(3);
      });

      it("should preserve other config values", () => {
        manager.updateConfig({ maxIterations: 3 });
        expect(manager.getConfig().generateEdgeCases).toBe(true);
      });
    });

    describe("startCycle", () => {
      it("should transition to requirements state", () => {
        manager.startCycle("Create a user service");
        expect(manager.getState()).toBe("requirements");
      });

      it("should emit cycle:started event", async () => {
        await new Promise<void>((resolve, reject) => {
          manager.once("cycle:started", (data: { requirements: string }) => {
            try {
              expect(data.requirements).toBe("Test requirement");
              resolve();
            } catch (error) {
              reject(error);
            }
          });

          manager.startCycle("Test requirement");
        });
      });

      it("should throw if not idle", () => {
        manager.startCycle("First");
        expect(() => manager.startCycle("Second")).toThrow();
      });
    });

    describe("reset", () => {
      it("should reset to idle state", () => {
        manager.startCycle("Some requirements");
        manager.reset();
        expect(manager.getState()).toBe("idle");
      });
    });

    describe("cancelCycle", () => {
      it("should cancel active cycle", () => {
        manager.startCycle("Test");
        manager.cancelCycle();
        expect(manager.getState()).toBe("idle");
      });

      it("should emit cycle:cancelled event", async () => {
        await new Promise<void>((resolve, reject) => {
          manager.once("cycle:cancelled", () => {
            try {
              resolve();
            } catch (error) {
              reject(error);
            }
          });

          manager.startCycle("Test");
          manager.cancelCycle();
        });
      });
    });

    describe("generateTestPrompt", () => {
      it("should generate test prompt for active cycle", () => {
        manager.startCycle("Create a function to validate emails");
        const prompt = manager.generateTestPrompt();
        expect(prompt).toContain("TDD mode");
        expect(prompt).toContain("validate emails");
        expect(prompt).toContain("jest");
      });

      it("should throw if no active cycle", () => {
        expect(() => manager.generateTestPrompt()).toThrow();
      });
    });

    describe("recordGeneratedTests", () => {
      it("should record tests and transition state", () => {
        manager.startCycle("Test");
        manager.recordGeneratedTests(["test code"], ["test.ts"]);
        expect(manager.getState()).toBe("reviewing-tests");
      });

      it("should emit tests:generated event", async () => {
        await new Promise<void>((resolve, reject) => {
          manager.once("tests:generated", (data) => {
            try {
              expect(data.tests).toHaveLength(1);
              expect(data.files).toHaveLength(1);
              resolve();
            } catch (error) {
              reject(error);
            }
          });

          manager.startCycle("Test");
          manager.recordGeneratedTests(["test code"], ["test.ts"]);
        });
      });
    });

    describe("approveTests", () => {
      it("should transition to implementing", () => {
        manager.startCycle("Test");
        manager.recordGeneratedTests(["test"], ["test.ts"]);
        manager.approveTests();
        expect(manager.getState()).toBe("implementing");
      });

      it("should throw if not in reviewing state", () => {
        manager.startCycle("Test");
        expect(() => manager.approveTests()).toThrow();
      });
    });

    describe("formatStatus", () => {
      it("should format idle status", () => {
        const status = manager.formatStatus();
        expect(status).toContain("TDD Mode");
        expect(status).toContain("Idle");
      });

      it("should format active status", () => {
        manager.startCycle("Test");
        const status = manager.formatStatus();
        expect(status).toContain("requirements");
      });
    });

    describe("getCycleResult", () => {
      it("should return null when no cycle", () => {
        expect(manager.getCycleResult()).toBeNull();
      });
    });
  });

  describe("Singleton", () => {
    describe("getTDDManager", () => {
      it("should return manager instance", () => {
        const mgr = getTDDManager(process.cwd());
        expect(mgr).toBeInstanceOf(TDDModeManager);
      });
    });

    describe("initializeTDD", () => {
      it("should create manager with config", () => {
        const mgr = initializeTDD(process.cwd(), { maxIterations: 7 });
        expect(mgr.getConfig().maxIterations).toBe(7);
      });
    });
  });

  describe("TDD State Machine", () => {
    let manager: TDDModeManager;

    beforeEach(() => {
      manager = new TDDModeManager(process.cwd());
    });

    it("should follow valid state transitions", () => {
      // idle -> requirements
      expect(manager.getState()).toBe("idle");
      manager.startCycle("Test");
      expect(manager.getState()).toBe("requirements");

      // requirements -> reviewing-tests (after generating tests)
      manager.recordGeneratedTests(["test"], ["test.ts"]);
      expect(manager.getState()).toBe("reviewing-tests");

      // reviewing-tests -> implementing
      manager.approveTests();
      expect(manager.getState()).toBe("implementing");
    });
  });
});
