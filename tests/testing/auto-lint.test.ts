/**
 * Tests for Auto-Lint Module
 *
 * Validates automatic linting integration.
 */

import {
  AutoLintManager,
  getAutoLintManager,
  initializeAutoLint,
  BUILTIN_LINTERS,
  DEFAULT_AUTOLINT_CONFIG,
  type LintError,
  type LintResult,
  type LinterConfig as _LinterConfig,
  type AutoLintConfig,
} from "../../src/testing/auto-lint.js";

let manager: AutoLintManager;

beforeEach(() => {
  manager = new AutoLintManager(process.cwd());
});

describe("Auto-Lint", () => {
  describe("DEFAULT_AUTOLINT_CONFIG", () => {
    it("should have sensible defaults", () => {
      expect(DEFAULT_AUTOLINT_CONFIG.enabled).toBe(true);
      expect(DEFAULT_AUTOLINT_CONFIG.autoFix).toBe(true);
      expect(DEFAULT_AUTOLINT_CONFIG.failOnError).toBe(false);
      expect(DEFAULT_AUTOLINT_CONFIG.maxErrors).toBeGreaterThan(0);
      expect(DEFAULT_AUTOLINT_CONFIG.timeout).toBeGreaterThan(0);
      expect(Array.isArray(DEFAULT_AUTOLINT_CONFIG.linters)).toBe(true);
    });
  });

  describe("BUILTIN_LINTERS", () => {
    it("should have ESLint configuration", () => {
      expect(BUILTIN_LINTERS.eslint).toBeDefined();
      expect(BUILTIN_LINTERS.eslint.name).toBe("ESLint");
      expect(BUILTIN_LINTERS.eslint.extensions).toContain(".ts");
      expect(BUILTIN_LINTERS.eslint.configFiles).toContain(".eslintrc.js");
    });

    it("should have Prettier configuration", () => {
      expect(BUILTIN_LINTERS.prettier).toBeDefined();
      expect(BUILTIN_LINTERS.prettier.name).toBe("Prettier");
      expect(BUILTIN_LINTERS.prettier.extensions).toContain(".js");
    });

    it("should have Ruff configuration for Python", () => {
      expect(BUILTIN_LINTERS.ruff).toBeDefined();
      expect(BUILTIN_LINTERS.ruff.name).toBe("Ruff");
      expect(BUILTIN_LINTERS.ruff.extensions).toContain(".py");
    });

    it("should have Clippy configuration for Rust", () => {
      expect(BUILTIN_LINTERS.clippy).toBeDefined();
      expect(BUILTIN_LINTERS.clippy.name).toBe("Clippy");
      expect(BUILTIN_LINTERS.clippy.extensions).toContain(".rs");
    });

    it("should have golangci-lint configuration for Go", () => {
      expect(BUILTIN_LINTERS.golangci).toBeDefined();
      expect(BUILTIN_LINTERS.golangci.name).toBe("golangci-lint");
      expect(BUILTIN_LINTERS.golangci.extensions).toContain(".go");
    });

    it("should have RuboCop configuration for Ruby", () => {
      expect(BUILTIN_LINTERS.rubocop).toBeDefined();
      expect(BUILTIN_LINTERS.rubocop.name).toBe("RuboCop");
      expect(BUILTIN_LINTERS.rubocop.extensions).toContain(".rb");
    });
  });

  describe("AutoLintManager", () => {
    describe("constructor", () => {
      it("should initialize with default config", () => {
        const mgr = new AutoLintManager(process.cwd());
        expect(mgr.getConfig()).toEqual(DEFAULT_AUTOLINT_CONFIG);
      });

      it("should accept custom config", () => {
        const config: Partial<AutoLintConfig> = { autoFix: false };
        const mgr = new AutoLintManager(process.cwd(), config);
        expect(mgr.getConfig().autoFix).toBe(false);
      });
    });

    describe("getDetectedLinters", () => {
      it("should return array of detected linters", () => {
        const linters = manager.getDetectedLinters();
        expect(Array.isArray(linters)).toBe(true);
      });
    });

    describe("updateConfig", () => {
      it("should update configuration", () => {
        manager.updateConfig({ failOnError: true });
        expect(manager.getConfig().failOnError).toBe(true);
      });

      it("should preserve other config values", () => {
        manager.updateConfig({ failOnError: true });
        expect(manager.getConfig().autoFix).toBe(true);
      });
    });

    describe("formatResultsForLLM", () => {
      it("should format clean results", () => {
        const results: LintResult[] = [
          {
            success: true,
            errors: [],
            warnings: [],
            fixedCount: 0,
            duration: 100,
            linter: "ESLint",
          },
        ];

        const formatted = manager.formatResultsForLLM(results);
        expect(formatted).toContain("passed");
      });

      it("should format results with errors", () => {
        const results: LintResult[] = [
          {
            success: false,
            errors: [
              {
                file: "test.ts",
                line: 10,
                column: 5,
                message: "Unexpected var",
                rule: "no-var",
                severity: "error",
                fixable: true,
              },
            ],
            warnings: [],
            fixedCount: 0,
            duration: 100,
            linter: "ESLint",
          },
        ];

        const formatted = manager.formatResultsForLLM(results);
        expect(formatted).toContain("test.ts");
        expect(formatted).toContain("no-var");
        expect(formatted).toContain("Unexpected var");
      });
    });

    describe("events", () => {
      it("should emit lint:start event", async () => {
        await new Promise<void>((resolve, reject) => {
          manager.once("lint:start", (data: { file: string; linter: string }) => {
            try {
              expect(data.file).toBe("test.ts");
              resolve();
            } catch (error) {
              reject(error);
            }
          });

          manager.emit("lint:start", { file: "test.ts", linter: "ESLint" });
        });
      });

      it("should emit lint:complete event", async () => {
        await new Promise<void>((resolve, reject) => {
          manager.once("lint:complete", (data: { file: string; result: LintResult }) => {
            try {
              expect(data.result.success).toBe(true);
              resolve();
            } catch (error) {
              reject(error);
            }
          });

          manager.emit("lint:complete", {
            file: "test.ts",
            result: {
              success: true,
              errors: [],
              warnings: [],
              fixedCount: 0,
              duration: 100,
              linter: "ESLint",
            },
          });
        });
      });
    });

    describe("refresh", () => {
      it("should re-detect linters", () => {
        manager.refresh();
        // Should not throw
        expect(manager.getDetectedLinters()).toBeDefined();
      });
    });
  });

  describe("Singleton", () => {
    describe("getAutoLintManager", () => {
      it("should return manager instance", () => {
        const mgr = getAutoLintManager(process.cwd());
        expect(mgr).toBeInstanceOf(AutoLintManager);
      });
    });

    describe("initializeAutoLint", () => {
      it("should create manager with config", () => {
        const mgr = initializeAutoLint(process.cwd(), { autoFix: false });
        expect(mgr.getConfig().autoFix).toBe(false);
      });
    });
  });

  describe("LintError type", () => {
    it("should have all required fields", () => {
      const error: LintError = {
        file: "test.ts",
        line: 10,
        column: 5,
        message: "Error message",
        rule: "some-rule",
        severity: "error",
        fixable: true,
      };

      expect(error.file).toBeDefined();
      expect(error.line).toBeDefined();
      expect(error.column).toBeDefined();
      expect(error.message).toBeDefined();
      expect(error.rule).toBeDefined();
      expect(error.severity).toBeDefined();
      expect(error.fixable).toBeDefined();
    });

    it("should support all severity levels", () => {
      const severities: LintError["severity"][] = ["error", "warning", "info"];
      severities.forEach((severity) => {
        const error: LintError = {
          file: "test.ts",
          line: 1,
          column: 1,
          message: "Test",
          rule: "test",
          severity,
          fixable: false,
        };
        expect(error.severity).toBe(severity);
      });
    });
  });

  describe("LintResult type", () => {
    it("should have correct structure", () => {
      const result: LintResult = {
        success: true,
        errors: [],
        warnings: [],
        fixedCount: 0,
        duration: 100,
        linter: "ESLint",
      };

      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.fixedCount).toBe(0);
      expect(result.duration).toBe(100);
      expect(result.linter).toBe("ESLint");
    });
  });
});
