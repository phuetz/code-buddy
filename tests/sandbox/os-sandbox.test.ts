/**
 * Tests for OS-Level Sandbox
 */

import {
  OSSandbox,
  detectCapabilities,
  clearCapabilitiesCache,
  getOSSandbox,
  resetOSSandbox,
} from "../../src/sandbox/os-sandbox";
import * as os from "os";

describe("OSSandbox", () => {
  let sandbox: OSSandbox;

  beforeEach(() => {
    clearCapabilitiesCache();
    resetOSSandbox();
    sandbox = new OSSandbox({
      workDir: process.cwd(),
      timeout: 5000,
    });
  });

  afterEach(() => {
    resetOSSandbox();
  });

  describe("Capability Detection", () => {
    it("should detect available sandbox backends", async () => {
      const capabilities = await detectCapabilities();

      expect(capabilities).toHaveProperty("bubblewrap");
      expect(capabilities).toHaveProperty("seatbelt");
      expect(capabilities).toHaveProperty("docker");
      expect(capabilities).toHaveProperty("recommended");
    });

    it("should cache capabilities", async () => {
      const caps1 = await detectCapabilities();
      const caps2 = await detectCapabilities();

      expect(caps1).toEqual(caps2);
    });

    it("should clear cache when requested", async () => {
      await detectCapabilities();
      clearCapabilitiesCache();

      // Should work without error
      const caps = await detectCapabilities();
      expect(caps).toBeDefined();
    });

    it("should recommend appropriate backend for platform", async () => {
      const capabilities = await detectCapabilities();
      const platform = os.platform();

      if (platform === "linux" && capabilities.bubblewrap) {
        expect(capabilities.recommended).toBe("bubblewrap");
      } else if (platform === "darwin" && capabilities.seatbelt) {
        expect(capabilities.recommended).toBe("seatbelt");
      } else if (capabilities.docker) {
        expect(capabilities.recommended).toBe("docker");
      }
    });
  });

  describe("Sandbox Initialization", () => {
    it("should initialize sandbox", async () => {
      await sandbox.initialize();
      expect(sandbox.getBackend()).toBeDefined();
    });

    it("should return backend type", async () => {
      await sandbox.initialize();
      const backend = sandbox.getBackend();

      expect(["bubblewrap", "seatbelt", "docker", "none"]).toContain(backend);
    });

    it("should report availability status", async () => {
      await sandbox.initialize();
      const available = sandbox.isAvailable();

      expect(typeof available).toBe("boolean");
    });
  });

  describe("Configuration", () => {
    it("should accept custom configuration", () => {
      const customSandbox = new OSSandbox({
        workDir: "/tmp",
        allowNetwork: true,
        timeout: 10000,
        readOnlyPaths: ["/usr", "/lib"],
        readWritePaths: ["/tmp"],
      });

      const config = customSandbox.getConfig();

      expect(config.workDir).toBe("/tmp");
      expect(config.allowNetwork).toBe(true);
      expect(config.timeout).toBe(10000);
    });

    it("should update configuration", async () => {
      sandbox.updateConfig({ allowNetwork: true });
      const config = sandbox.getConfig();

      expect(config.allowNetwork).toBe(true);
    });
  });

  describe("Singleton Pattern", () => {
    it("should return same instance", () => {
      const instance1 = getOSSandbox();
      const instance2 = getOSSandbox();

      expect(instance1).toBe(instance2);
    });

    it("should reset singleton", () => {
      const instance1 = getOSSandbox();
      resetOSSandbox();
      const instance2 = getOSSandbox();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe("Event Emission", () => {
    it("should emit initialized event", async () => {
      const handler = jest.fn();
      sandbox.on("initialized", handler);

      await sandbox.initialize();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          backend: expect.any(String),
        })
      );
    });
  });
});
