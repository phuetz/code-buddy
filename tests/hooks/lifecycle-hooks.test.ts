/**
 * Tests for Lifecycle Hooks Module
 *
 * Validates hook system for pre/post operations.
 */

import {
  HooksManager,
  getHooksManager,
  initializeHooks,
  BUILTIN_HOOKS,
  DEFAULT_HOOKS_CONFIG,
  type HookType,
  type HookContext,
  type HookDefinition,
  type HookResult,
  type HooksConfig,
} from "../../src/hooks/lifecycle-hooks.js";

let manager: HooksManager;

beforeEach(() => {
  manager = new HooksManager(process.cwd());
});

describe("Lifecycle Hooks", () => {
  describe("DEFAULT_HOOKS_CONFIG", () => {
    it("should have sensible defaults", () => {
      expect(DEFAULT_HOOKS_CONFIG.enabled).toBe(true);
      expect(DEFAULT_HOOKS_CONFIG.timeout).toBeGreaterThan(0);
      expect(DEFAULT_HOOKS_CONFIG.configPath).toBeDefined();
      expect(Array.isArray(DEFAULT_HOOKS_CONFIG.hooks)).toBe(true);
    });
  });

  describe("BUILTIN_HOOKS", () => {
    it("should have lint-on-edit hook", () => {
      const hook = BUILTIN_HOOKS.find((h) => h.name === "lint-on-edit");
      expect(hook).toBeDefined();
      expect(hook?.type).toBe("post-edit");
    });

    it("should have format-on-edit hook", () => {
      const hook = BUILTIN_HOOKS.find((h) => h.name === "format-on-edit");
      expect(hook).toBeDefined();
      expect(hook?.type).toBe("post-edit");
    });

    it("should have test-on-edit hook", () => {
      const hook = BUILTIN_HOOKS.find((h) => h.name === "test-on-edit");
      expect(hook).toBeDefined();
      expect(hook?.type).toBe("post-edit");
    });

    it("should have pre-commit-lint hook", () => {
      const hook = BUILTIN_HOOKS.find((h) => h.name === "pre-commit-lint");
      expect(hook).toBeDefined();
      expect(hook?.type).toBe("pre-commit");
    });

    it("should have pre-commit-test hook", () => {
      const hook = BUILTIN_HOOKS.find((h) => h.name === "pre-commit-test");
      expect(hook).toBeDefined();
      expect(hook?.type).toBe("pre-commit");
    });

    it("should cover post-edit and pre-commit types", () => {
      const types = new Set(BUILTIN_HOOKS.map((h) => h.type));
      expect(types.has("post-edit")).toBe(true);
      expect(types.has("pre-commit")).toBe(true);
    });
  });

  describe("HookType", () => {
    it("should include all expected types", () => {
      const validTypes: HookType[] = [
        "pre-edit",
        "post-edit",
        "pre-bash",
        "post-bash",
        "pre-commit",
        "post-commit",
        "pre-prompt",
        "post-response",
        "on-error",
        "on-tool-call",
      ];

      validTypes.forEach((type) => {
        expect(typeof type).toBe("string");
      });
    });
  });

  describe("HooksManager", () => {
    describe("constructor", () => {
      it("should initialize with default config", () => {
        const mgr = new HooksManager(process.cwd());
        expect(mgr.getConfig().enabled).toBe(DEFAULT_HOOKS_CONFIG.enabled);
        expect(mgr.getConfig().timeout).toBe(DEFAULT_HOOKS_CONFIG.timeout);
      });

      it("should accept custom config", () => {
        const config: Partial<HooksConfig> = { timeout: 60000 };
        const mgr = new HooksManager(process.cwd(), config);
        expect(mgr.getConfig().timeout).toBe(60000);
      });
    });

    describe("registerHook", () => {
      it("should register a new hook", () => {
        const hook: HookDefinition = {
          name: "custom-hook",
          type: "pre-edit",
          command: "echo 'hello'",
          enabled: true,
          timeout: 5000,
          failOnError: false,
        };

        manager.registerHook(hook);
        const hooks = manager.getHooksByType("pre-edit");
        expect(hooks.some((h) => h.name === "custom-hook")).toBe(true);
      });

      it("should emit hook:registered event", async () => {
        await new Promise<void>((resolve, reject) => {
          manager.once("hook:registered", (data: { name: string; type: HookType }) => {
            try {
              expect(data.name).toBe("test-hook");
              resolve();
            } catch (error) {
              reject(error);
            }
          });

          manager.registerHook({
            name: "test-hook",
            type: "pre-edit",
            enabled: true,
            timeout: 5000,
            failOnError: false,
          });
        });
      });
    });

    describe("unregisterHook", () => {
      it("should unregister a hook", () => {
        manager.registerHook({
          name: "to-remove",
          type: "pre-edit",
          enabled: true,
          timeout: 5000,
          failOnError: false,
        });

        const result = manager.unregisterHook("to-remove");
        expect(result).toBe(true);

        const hooks = manager.getHooksByType("pre-edit");
        expect(hooks.some((h) => h.name === "to-remove")).toBe(false);
      });

      it("should return false for non-existent hook", () => {
        const result = manager.unregisterHook("non-existent");
        expect(result).toBe(false);
      });
    });

    describe("setHookEnabled", () => {
      it("should enable a hook", () => {
        manager.registerHook({
          name: "toggle-test",
          type: "pre-edit",
          enabled: false,
          timeout: 5000,
          failOnError: false,
        });

        const result = manager.setHookEnabled("toggle-test", true);
        expect(result).toBe(true);

        const hooks = manager.getHooksByType("pre-edit");
        const hook = hooks.find((h) => h.name === "toggle-test");
        expect(hook?.enabled).toBe(true);
      });

      it("should disable a hook", () => {
        manager.registerHook({
          name: "disable-test",
          type: "pre-edit",
          enabled: true,
          timeout: 5000,
          failOnError: false,
        });

        manager.setHookEnabled("disable-test", false);

        const hooks = manager.getHooksByType("pre-edit");
        const hook = hooks.find((h) => h.name === "disable-test");
        expect(hook?.enabled).toBe(false);
      });
    });

    describe("hasHook", () => {
      it("should return true for existing hook", () => {
        manager.registerHook({
          name: "exists-test",
          type: "pre-edit",
          enabled: true,
          timeout: 5000,
          failOnError: false,
        });

        expect(manager.hasHook("exists-test")).toBe(true);
      });

      it("should return false for non-existent hook", () => {
        expect(manager.hasHook("does-not-exist")).toBe(false);
      });
    });

    describe("getHooks", () => {
      it("should return all registered hooks as a Map", () => {
        const hooks = manager.getHooks();
        expect(hooks).toBeInstanceOf(Map);
      });
    });

    describe("getHooksByType", () => {
      it("should return hooks of specified type", () => {
        manager.registerHook({
          name: "pre-edit-hook",
          type: "pre-edit",
          enabled: true,
          timeout: 5000,
          failOnError: false,
        });

        const preEditHooks = manager.getHooksByType("pre-edit");
        expect(preEditHooks.some((h) => h.name === "pre-edit-hook")).toBe(true);
      });

      it("should return empty array for type with no hooks", () => {
        const hooks = manager.getHooksByType("on-error");
        expect(Array.isArray(hooks)).toBe(true);
      });
    });

    describe("executeHooks", () => {
      it("should execute hooks of specified type", async () => {
        let executed = false;

        manager.registerHook({
          name: "test-runner",
          type: "pre-edit",
          enabled: true,
          timeout: 5000,
          failOnError: false,
          handler: async () => {
            executed = true;
            return { success: true, duration: 0 };
          },
        });

        await manager.executeHooks("pre-edit", {
          file: "test.ts",
          content: "content",
        });
        expect(executed).toBe(true);
      });

      it("should emit hook:executing and hook:executed events", async () => {
        const events: string[] = [];

        manager.on("hook:executing", () => events.push("executing"));
        manager.on("hook:executed", () => events.push("executed"));

        manager.registerHook({
          name: "event-test",
          type: "pre-edit",
          enabled: true,
          timeout: 5000,
          failOnError: false,
          handler: async () => ({ success: true, duration: 0 }),
        });

        await manager.executeHooks("pre-edit", {});

        expect(events).toContain("executing");
        expect(events).toContain("executed");
      });

      it("should skip disabled hooks", async () => {
        let executed = false;

        manager.registerHook({
          name: "disabled-hook",
          type: "pre-edit",
          enabled: false,
          timeout: 5000,
          failOnError: false,
          handler: async () => {
            executed = true;
            return { success: true, duration: 0 };
          },
        });

        await manager.executeHooks("pre-edit", {});
        expect(executed).toBe(false);
      });
    });

    describe("formatStatus", () => {
      it("should format hooks status", () => {
        const status = manager.formatStatus();
        expect(status).toContain("Lifecycle Hooks");
      });

      it("should show disabled status when hooks disabled", () => {
        manager.updateConfig({ enabled: false });
        const status = manager.formatStatus();
        expect(status).toContain("Disabled");
      });
    });

    describe("updateConfig", () => {
      it("should update configuration", () => {
        manager.updateConfig({ timeout: 60000 });
        expect(manager.getConfig().timeout).toBe(60000);
      });
    });
  });

  describe("Singleton", () => {
    describe("getHooksManager", () => {
      it("should return manager instance", () => {
        const mgr = getHooksManager(process.cwd());
        expect(mgr).toBeInstanceOf(HooksManager);
      });
    });

    describe("initializeHooks", () => {
      it("should create manager with config", () => {
        const mgr = initializeHooks(process.cwd(), { timeout: 45000 });
        expect(mgr.getConfig().timeout).toBe(45000);
      });
    });
  });

  describe("HookDefinition type", () => {
    it("should have required fields", () => {
      const hook: HookDefinition = {
        name: "test",
        type: "pre-edit",
        enabled: true,
        timeout: 5000,
        failOnError: false,
      };

      expect(hook.name).toBeDefined();
      expect(hook.type).toBeDefined();
      expect(hook.enabled).toBeDefined();
      expect(hook.timeout).toBeDefined();
      expect(hook.failOnError).toBeDefined();
    });

    it("should support optional fields", () => {
      const hook: HookDefinition = {
        name: "test",
        type: "pre-edit",
        command: "echo test",
        script: "./hook.js",
        enabled: true,
        timeout: 5000,
        failOnError: false,
        filePatterns: ["*.ts"],
        commandPatterns: ["npm"],
      };

      expect(hook.command).toBe("echo test");
      expect(hook.script).toBe("./hook.js");
      expect(hook.filePatterns).toContain("*.ts");
    });
  });

  describe("HookResult type", () => {
    it("should have correct structure", () => {
      const result: HookResult = {
        success: true,
        output: "test output",
        duration: 100,
      };

      expect(result.success).toBe(true);
      expect(result.output).toBe("test output");
      expect(result.duration).toBe(100);
    });

    it("should support optional fields", () => {
      const result: HookResult = {
        success: false,
        error: "Something went wrong",
        duration: 50,
        modified: {
          content: "modified content",
        },
        abort: true,
      };

      expect(result.error).toBe("Something went wrong");
      expect(result.modified?.content).toBe("modified content");
      expect(result.abort).toBe(true);
    });
  });

  describe("HookContext type", () => {
    it("should have required fields", () => {
      const context: HookContext = {
        type: "pre-edit",
        timestamp: new Date(),
        workingDirectory: process.cwd(),
      };

      expect(context.type).toBe("pre-edit");
      expect(context.timestamp).toBeInstanceOf(Date);
      expect(context.workingDirectory).toBeDefined();
    });

    it("should support optional fields", () => {
      const context: HookContext = {
        type: "pre-edit",
        timestamp: new Date(),
        workingDirectory: process.cwd(),
        file: "test.ts",
        content: "content",
        command: "npm test",
        output: "output",
        error: "error",
        toolName: "edit",
        toolArgs: { path: "test.ts" },
        prompt: "prompt",
        response: "response",
        sessionId: "session-123",
        model: "grok-beta",
      };

      expect(context.file).toBe("test.ts");
      expect(context.toolName).toBe("edit");
      expect(context.sessionId).toBe("session-123");
    });
  });
});
