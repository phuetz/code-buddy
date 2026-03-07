/**
 * E2B Cloud Sandbox Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { E2BSandbox, resetE2BSandbox, getE2BSandbox } from '../../src/sandbox/e2b-sandbox.js';

describe('E2BSandbox', () => {
  beforeEach(() => {
    resetE2BSandbox();
    vi.unstubAllEnvs();
  });

  describe('isAvailable', () => {
    it('returns false when E2B_API_KEY is not set', () => {
      vi.stubEnv('E2B_API_KEY', '');
      expect(E2BSandbox.isAvailable()).toBe(false);
    });

    it('returns true when E2B_API_KEY is set', () => {
      vi.stubEnv('E2B_API_KEY', 'test-key-123');
      expect(E2BSandbox.isAvailable()).toBe(true);
    });
  });

  describe('constructor', () => {
    it('creates with default config', () => {
      const sandbox = new E2BSandbox();
      expect(sandbox.isActive()).toBe(false);
      expect(sandbox.getSandboxId()).toBeNull();
    });

    it('creates with custom config', () => {
      const sandbox = new E2BSandbox({
        template: 'custom-template',
        memoryMb: 1024,
        cpus: 2,
      });
      expect(sandbox.isActive()).toBe(false);
    });
  });

  describe('singleton', () => {
    it('getE2BSandbox returns same instance', () => {
      const a = getE2BSandbox();
      const b = getE2BSandbox();
      expect(a).toBe(b);
    });

    it('resetE2BSandbox clears instance', () => {
      const a = getE2BSandbox();
      resetE2BSandbox();
      const b = getE2BSandbox();
      expect(a).not.toBe(b);
    });
  });

  describe('execute', () => {
    it('fails when API key is not set', async () => {
      vi.stubEnv('E2B_API_KEY', '');
      const sandbox = new E2BSandbox();
      const result = await sandbox.execute('echo hello');
      expect(result.success).toBe(false);
      expect(result.error).toContain('E2B_API_KEY');
    });
  });

  describe('destroy', () => {
    it('can be called when no sandbox is active', async () => {
      const sandbox = new E2BSandbox();
      // Should not throw
      await sandbox.destroy();
      expect(sandbox.isActive()).toBe(false);
    });
  });
});
