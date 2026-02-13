import { AutoSandboxRouter } from '../../src/sandbox/auto-sandbox.js';

describe('AutoSandboxRouter', () => {
  let router: AutoSandboxRouter;

  beforeEach(() => {
    router = new AutoSandboxRouter({ enabled: true });
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
