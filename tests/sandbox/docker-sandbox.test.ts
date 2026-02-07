/**
 * Docker Sandbox Tests
 *
 * Tests WITHOUT actually running Docker - all child_process calls are mocked.
 */

import { EventEmitter } from 'events';

// Mock child_process before importing the module
const mockExecSync = jest.fn();
const mockSpawn = jest.fn();

jest.mock('child_process', () => ({
  execSync: mockExecSync,
  spawn: mockSpawn,
}));

import { DockerSandbox, type SandboxConfig, type SandboxResult } from '../../src/sandbox/docker-sandbox.js';

/**
 * Create a mock ChildProcess with stdout/stderr event emitters.
 */
function createMockProcess() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const stdin = { write: jest.fn(), end: jest.fn() };
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: jest.Mock; end: jest.Mock };
    kill: jest.Mock;
  };
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.stdin = stdin;
  proc.kill = jest.fn();
  return proc;
}

describe('DockerSandbox', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should apply default config when no config provided', () => {
      const sandbox = new DockerSandbox();
      expect(sandbox).toBeDefined();
      expect(sandbox.getActive()).toEqual([]);
    });

    it('should merge partial config with defaults', () => {
      const sandbox = new DockerSandbox({ image: 'alpine:latest', timeout: 5000 });
      expect(sandbox).toBeDefined();
    });
  });

  describe('isAvailable', () => {
    it('should return true when docker is available', () => {
      mockExecSync.mockReturnValue(Buffer.from(''));
      expect(DockerSandbox.isAvailable()).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith('docker info', expect.objectContaining({ stdio: 'pipe' }));
    });

    it('should return false when docker is not found', () => {
      mockExecSync.mockImplementation(() => { throw new Error('command not found'); });
      expect(DockerSandbox.isAvailable()).toBe(false);
    });
  });

  describe('execute', () => {
    it('should build correct docker command args', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const sandbox = new DockerSandbox({
        image: 'node:22-slim',
        memoryLimit: '512m',
        cpuLimit: '1.0',
        networkEnabled: false,
        readOnly: false,
      });

      const promise = sandbox.execute('echo hello');

      // Simulate successful execution
      proc.stdout.emit('data', Buffer.from('hello\n'));
      proc.emit('close', 0);

      const result = await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        'docker',
        expect.arrayContaining([
          'run', '--rm',
          '--label', 'codebuddy-sandbox=true',
          '-m', '512m',
          '--cpus', '1.0',
          '--network', 'none',
          'node:22-slim', 'sh', '-c', 'echo hello',
        ]),
        expect.anything(),
      );

      expect(result.success).toBe(true);
      expect(result.output).toBe('hello\n');
      expect(result.exitCode).toBe(0);
      expect(result.containerId).toMatch(/^codebuddy-sandbox-/);
    });

    it('should add --read-only when readOnly is true', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const sandbox = new DockerSandbox({ readOnly: true });
      const promise = sandbox.execute('ls');

      proc.emit('close', 0);
      await promise;

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--read-only');
    });

    it('should not add --network none when networkEnabled is true', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const sandbox = new DockerSandbox({ networkEnabled: true });
      const promise = sandbox.execute('curl example.com');

      proc.emit('close', 0);
      await promise;

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).not.toContain('--network');
    });

    it('should add workspace mount when specified', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const sandbox = new DockerSandbox({ workspaceMount: '/home/user/project' });
      const promise = sandbox.execute('npm test');

      proc.emit('close', 0);
      await promise;

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('-v');
      expect(args).toContain('/home/user/project:/workspace');
      expect(args).toContain('-w');
      expect(args).toContain('/workspace');
    });

    it('should handle timeout by killing container', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      mockExecSync.mockReturnValue(Buffer.from(''));

      const sandbox = new DockerSandbox({ timeout: 100 });
      const promise = sandbox.execute('sleep 999');

      // Wait for timeout to trigger
      await new Promise((r) => setTimeout(r, 150));

      proc.emit('close', 137);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/timed out/i);
    });

    it('should handle spawn errors', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const sandbox = new DockerSandbox();
      const promise = sandbox.execute('echo test');

      proc.emit('error', new Error('spawn ENOENT'));

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('spawn ENOENT');
      expect(result.exitCode).toBe(1);
    });

    it('should capture stderr as error', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const sandbox = new DockerSandbox();
      const promise = sandbox.execute('bad-command');

      proc.stderr.emit('data', Buffer.from('command not found'));
      proc.emit('close', 127);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('command not found');
      expect(result.exitCode).toBe(127);
    });

    it('should allow per-call config overrides', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const sandbox = new DockerSandbox({ image: 'node:22-slim' });
      const promise = sandbox.execute('python3 --version', { image: 'python:3.12-slim' });

      proc.emit('close', 0);
      await promise;

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('python:3.12-slim');
      expect(args).not.toContain('node:22-slim');
    });
  });

  describe('getActive', () => {
    it('should track active containers during execution', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const sandbox = new DockerSandbox();
      const promise = sandbox.execute('sleep 10');

      // Container should be active while running
      expect(sandbox.getActive().length).toBe(1);
      expect(sandbox.getActive()[0]).toMatch(/^codebuddy-sandbox-/);

      proc.emit('close', 0);
      await promise;

      // Container should be removed after completion
      expect(sandbox.getActive()).toEqual([]);
    });
  });

  describe('kill', () => {
    it('should kill a container and return true on success', async () => {
      mockExecSync.mockReturnValue(Buffer.from(''));

      const sandbox = new DockerSandbox();
      const result = await sandbox.kill('codebuddy-sandbox-abc12345');

      expect(result).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'docker kill codebuddy-sandbox-abc12345',
        expect.objectContaining({ stdio: 'pipe' }),
      );
    });

    it('should return false when kill fails', async () => {
      mockExecSync.mockImplementation(() => { throw new Error('no such container'); });

      const sandbox = new DockerSandbox();
      const result = await sandbox.kill('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('prune', () => {
    it('should run correct docker prune command', async () => {
      mockExecSync.mockReturnValue(Buffer.from('Total reclaimed space: 0B\n'));

      const sandbox = new DockerSandbox();
      await sandbox.prune();

      expect(mockExecSync).toHaveBeenCalledWith(
        'docker container prune -f --filter label=codebuddy-sandbox=true',
        expect.objectContaining({ stdio: 'pipe' }),
      );
    });

    it('should parse pruned container count', async () => {
      mockExecSync.mockReturnValue(Buffer.from(
        'Deleted Containers:\nabc123\ndef456\n\nTotal reclaimed space: 10MB\n'
      ));

      const sandbox = new DockerSandbox();
      const count = await sandbox.prune();

      expect(count).toBe(2);
    });

    it('should return 0 when prune fails', async () => {
      mockExecSync.mockImplementation(() => { throw new Error('docker not available'); });

      const sandbox = new DockerSandbox();
      const count = await sandbox.prune();

      expect(count).toBe(0);
    });
  });

  describe('dispose', () => {
    it('should kill all active containers and clear listeners', async () => {
      const proc1 = createMockProcess();
      const proc2 = createMockProcess();
      mockSpawn.mockReturnValueOnce(proc1).mockReturnValueOnce(proc2);

      const sandbox = new DockerSandbox();
      const p1 = sandbox.execute('sleep 100');
      const p2 = sandbox.execute('sleep 200');

      expect(sandbox.getActive().length).toBe(2);

      // Mock kill to succeed
      mockExecSync.mockReturnValue(Buffer.from(''));

      await sandbox.dispose();

      expect(sandbox.getActive()).toEqual([]);

      // Clean up the pending promises
      proc1.emit('close', 137);
      proc2.emit('close', 137);
      await Promise.allSettled([p1, p2]);
    });
  });
});
