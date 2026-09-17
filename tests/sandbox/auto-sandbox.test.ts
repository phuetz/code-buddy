import { AutoSandboxRouter } from '../../src/sandbox/auto-sandbox.js';
import { ensureSshSandboxRegistered } from '../../src/sandbox/ssh-sandbox.js';
import { getActiveSandboxBackend, resetSandboxRegistry } from '../../src/sandbox/sandbox-registry.js';

describe('AutoSandboxRouter', () => {
  let router: AutoSandboxRouter;

  beforeEach(() => {
    resetSandboxRegistry();
    router = new AutoSandboxRouter({ enabled: true });
  });

  afterEach(() => {
    resetSandboxRegistry();
  });

  describe('shouldSandbox', () => {
    it('should sandbox npm commands', () => {
      const result = router.shouldSandbox('npm install express');
      expect(result.sandbox).toBe(true);
      expect(result.reason).toContain('npm');
    });

    it('should sandbox pip commands', () => {
      const result = router.shouldSandbox('pip install flask');
      expect(result.sandbox).toBe(true);
    });

    it('should not sandbox ls', () => {
      const result = router.shouldSandbox('ls -la');
      expect(result.sandbox).toBe(false);
    });

    it('should not sandbox git', () => {
      const result = router.shouldSandbox('git status');
      expect(result.sandbox).toBe(false);
    });

    it('should not sandbox when disabled', () => {
      router.setEnabled(false);
      const result = router.shouldSandbox('npm install');
      expect(result.sandbox).toBe(false);
    });

    it('should sandbox dangerous commands from registry', () => {
      const result = router.shouldSandbox('chmod 777 /etc/passwd');
      expect(result.sandbox).toBe(true);
    });
  });

  describe('route', () => {
    it('should route safe commands to direct', async () => {
      const result = await router.route('ls -la');
      expect(result.mode).toBe('direct');
    });

    it('should attempt sandbox for npm (may fall back to direct if no docker)', async () => {
      const result = await router.route('npm install');
      // Either sandbox or direct depending on Docker availability
      expect(['sandbox', 'direct']).toContain(result.mode);
    });

    it('should block sandbox-required commands when fail-closed is enabled and Docker is unavailable', async () => {
      router = new AutoSandboxRouter({ enabled: true, failClosedOnUnavailable: true });
      Object.defineProperty(router, 'dockerAvailable', { value: false, writable: true });

      const result = await router.route('npm install');

      expect(result.mode).toBe('blocked');
      expect(result.reason).toContain('fail-closed');
    });

    it('should keep historical direct fallback when fail-closed is disabled and Docker is unavailable', async () => {
      router = new AutoSandboxRouter({ enabled: true, failClosedOnUnavailable: false });
      Object.defineProperty(router, 'dockerAvailable', { value: false, writable: true });

      const result = await router.route('npm install');

      expect(result.mode).toBe('direct');
      expect(result.reason).toContain('Docker not available');
    });

    it('routes to sandbox for an explicit SSH backend without requiring Docker', async () => {
      router = new AutoSandboxRouter({
        enabled: false,
        explicitBackend: 'ssh',
        explicitHost: 'darkstar',
        failClosedOnUnavailable: true,
      });
      Object.defineProperty(router, 'dockerAvailable', { value: false, writable: true });

      const result = await router.route('echo hello');

      expect(result.mode).toBe('sandbox');
      expect(result.reason).toMatch(/Explicit SSH backend/);
      expect(result.reason).toContain('darkstar');
    });

    it('does not pick SSH when no backend is requested even for dangerous commands requiring sandbox', async () => {
      ensureSshSandboxRegistered();
      router = new AutoSandboxRouter({ enabled: true });
      const dangerousCommand = 'chmod 777 /etc/passwd';
      const check = router.shouldSandbox(dangerousCommand);
      expect(check.sandbox).toBe(true);
      expect(check.reason).toContain('dangerous');
      expect(check.reason ?? '').not.toMatch(/SSH/i);

      const routed = await router.route(dangerousCommand);
      expect(routed.reason).not.toMatch(/SSH/i);
      expect(getActiveSandboxBackend()?.name).not.toBe('ssh');
    });
  });

  describe('configuration', () => {
    it('should report enabled state', () => {
      expect(router.isEnabled()).toBe(true);
      router.setEnabled(false);
      expect(router.isEnabled()).toBe(false);
    });

    it('should return config', () => {
      const config = router.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.alwaysSandbox).toBeDefined();
    });
  });
});
