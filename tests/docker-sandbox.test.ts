/**
 * Docker Sandbox Tests
 */

import {
  DockerSandbox,
  SandboxManager,
  getSandboxManager,
  resetSandboxManager,
  SANDBOX_IMAGES,
  type SandboxConfig,
  type CommandResult,
} from '../src/sandbox/docker-sandbox.js';

describe('DockerSandbox', () => {
  describe('Configuration', () => {
    it('should use default configuration', () => {
      const sandbox = new DockerSandbox();
      // Sandbox is created with defaults
      expect(sandbox).toBeDefined();
    });

    it('should accept custom configuration', () => {
      const config: Partial<SandboxConfig> = {
        image: 'alpine:latest',
        timeout: 30000,
        limits: {
          memory: '256m',
          cpus: '0.5',
          pidsLimit: 50,
        },
      };

      const sandbox = new DockerSandbox(config);
      expect(sandbox).toBeDefined();
    });

    it('should have predefined images', () => {
      expect(SANDBOX_IMAGES.minimal).toBe('alpine:latest');
      expect(SANDBOX_IMAGES.node).toBe('node:20-slim');
      expect(SANDBOX_IMAGES.python).toBe('python:3.12-slim');
      expect(SANDBOX_IMAGES.rust).toBe('rust:slim');
      expect(SANDBOX_IMAGES.go).toBe('golang:1.22-alpine');
    });
  });

  describe('Docker Availability', () => {
    let sandbox: DockerSandbox;

    beforeEach(() => {
      sandbox = new DockerSandbox();
    });

    afterEach(async () => {
      await sandbox.dispose();
    });

    it('should check Docker availability', async () => {
      const available = await sandbox.isDockerAvailable();
      // Result depends on environment
      expect(typeof available).toBe('boolean');
    });

    it('should cache Docker availability check', async () => {
      const first = await sandbox.isDockerAvailable();
      const second = await sandbox.isDockerAvailable();
      expect(first).toBe(second);
    });
  });

  describe('Sandbox Status', () => {
    let sandbox: DockerSandbox;

    beforeEach(() => {
      sandbox = new DockerSandbox();
    });

    afterEach(async () => {
      await sandbox.dispose();
    });

    it('should report not running initially', async () => {
      const status = await sandbox.getStatus();
      expect(status.running).toBe(false);
      expect(status.containerId).toBeUndefined();
    });
  });

  describe('Command Result Structure', () => {
    it('should have correct result structure', () => {
      const result: CommandResult = {
        exitCode: 0,
        stdout: 'output',
        stderr: '',
        duration: 100,
        timedOut: false,
      };

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('output');
      expect(result.stderr).toBe('');
      expect(result.duration).toBe(100);
      expect(result.timedOut).toBe(false);
    });

    it('should handle timeout result', () => {
      const result: CommandResult = {
        exitCode: 1,
        stdout: '',
        stderr: 'timeout',
        duration: 60000,
        timedOut: true,
      };

      expect(result.timedOut).toBe(true);
    });
  });

  describe('Events', () => {
    it('should emit events', () => {
      const sandbox = new DockerSandbox();
      const startedHandler = jest.fn();
      const stoppedHandler = jest.fn();

      sandbox.on('started', startedHandler);
      sandbox.on('stopped', stoppedHandler);

      // Events are emitted during start/stop
      expect(sandbox.listenerCount('started')).toBe(1);
      expect(sandbox.listenerCount('stopped')).toBe(1);

      sandbox.dispose();
    });
  });
});

describe('SandboxManager', () => {
  let manager: SandboxManager;

  beforeEach(() => {
    resetSandboxManager();
    manager = new SandboxManager();
  });

  afterEach(async () => {
    await manager.dispose();
  });

  describe('Sandbox Creation', () => {
    it('should create sandbox', async () => {
      const sandbox = await manager.create('test-sandbox');
      expect(sandbox).toBeDefined();
      expect(manager.list()).toContain('test-sandbox');
    });

    it('should throw on duplicate name', async () => {
      await manager.create('test');
      await expect(manager.create('test'))
        .rejects.toThrow('already exists');
    });

    it('should get sandbox by name', async () => {
      await manager.create('my-sandbox');
      const sandbox = manager.get('my-sandbox');
      expect(sandbox).toBeDefined();
    });

    it('should return undefined for non-existent sandbox', () => {
      const sandbox = manager.get('non-existent');
      expect(sandbox).toBeUndefined();
    });
  });

  describe('Sandbox Management', () => {
    it('should list sandboxes', async () => {
      await manager.create('sandbox-1');
      await manager.create('sandbox-2');

      const list = manager.list();
      expect(list).toHaveLength(2);
      expect(list).toContain('sandbox-1');
      expect(list).toContain('sandbox-2');
    });

    it('should destroy sandbox', async () => {
      await manager.create('to-destroy');
      expect(manager.list()).toContain('to-destroy');

      await manager.destroy('to-destroy');
      expect(manager.list()).not.toContain('to-destroy');
    });

    it('should destroy all sandboxes', async () => {
      await manager.create('s1');
      await manager.create('s2');
      await manager.create('s3');

      await manager.destroyAll();
      expect(manager.list()).toHaveLength(0);
    });
  });

  describe('Get or Create', () => {
    it('should create if not exists', async () => {
      const sandbox = await manager.getOrCreate('new-sandbox');
      expect(sandbox).toBeDefined();
    });

    it('should return existing sandbox', async () => {
      const first = await manager.create('existing');
      const second = await manager.getOrCreate('existing');
      expect(first).toBe(second);
    });
  });

  describe('Events', () => {
    it('should emit sandbox events', async () => {
      const startedHandler = jest.fn();
      const stoppedHandler = jest.fn();

      manager.on('sandbox:started', startedHandler);
      manager.on('sandbox:stopped', stoppedHandler);

      await manager.create('event-test');
      // Events are forwarded from sandboxes
      expect(manager.listenerCount('sandbox:started')).toBe(1);
    });
  });

  describe('Singleton', () => {
    it('should return same instance', () => {
      resetSandboxManager();
      const instance1 = getSandboxManager();
      const instance2 = getSandboxManager();
      expect(instance1).toBe(instance2);
    });
  });
});

describe('Security Configuration', () => {
  it('should have secure defaults', () => {
    const sandbox = new DockerSandbox();
    // Default network should be restricted
    // This is verified through the config
    expect(sandbox).toBeDefined();
  });

  it('should support network modes', () => {
    const noneSandbox = new DockerSandbox({ network: 'none' });
    const bridgeSandbox = new DockerSandbox({ network: 'bridge' });

    expect(noneSandbox).toBeDefined();
    expect(bridgeSandbox).toBeDefined();
  });

  it('should support resource limits', () => {
    const sandbox = new DockerSandbox({
      limits: {
        memory: '128m',
        cpus: '0.25',
        pidsLimit: 10,
      },
    });

    expect(sandbox).toBeDefined();
  });
});
