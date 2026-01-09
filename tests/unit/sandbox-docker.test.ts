/**
 * Comprehensive Unit Tests for Docker Sandbox
 *
 * Tests Docker sandbox configuration and execution including:
 * - Docker method configuration
 * - Container creation parameters
 * - Volume mount security
 * - Network isolation
 * - Resource limits
 * - Cleanup and error handling
 *
 * Note: These tests focus on the Docker sandbox configuration
 * as defined in the SandboxManager with method: 'docker'
 */

import * as childProcess from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';

// Mock child_process before importing the module
jest.mock('child_process', () => ({
  spawn: jest.fn(),
  SpawnOptions: {},
}));

import {
  SandboxManager,
  SandboxConfig,
  getSandboxManager,
  resetSandboxManager,
} from '../../src/security/sandbox';

// Helper to create a mock child process
function createMockChildProcess(): childProcess.ChildProcess {
  const proc = new EventEmitter();
  (proc as unknown as Record<string, unknown>).stdout = new EventEmitter();
  (proc as unknown as Record<string, unknown>).stderr = new EventEmitter();
  (proc as unknown as Record<string, unknown>).kill = jest.fn();
  return proc as unknown as childProcess.ChildProcess;
}

describe('Docker Sandbox', () => {
  let manager: SandboxManager;
  let mockSpawn: jest.MockedFunction<typeof childProcess.spawn>;

  beforeEach(() => {
    resetSandboxManager();
    mockSpawn = childProcess.spawn as jest.MockedFunction<typeof childProcess.spawn>;
    jest.clearAllMocks();
  });

  afterEach(() => {
    resetSandboxManager();
  });

  // ============================================================
  // Section 1: Docker Method Configuration
  // ============================================================
  describe('Docker Method Configuration', () => {
    it('should initialize with docker method', () => {
      manager = new SandboxManager({ method: 'docker' });
      const config = manager.getConfig();

      expect(config.method).toBe('docker');
    });

    it('should maintain default security settings with docker method', () => {
      manager = new SandboxManager({ method: 'docker' });
      const config = manager.getConfig();

      expect(config.blockedPaths).toContain(path.join(os.homedir(), '.ssh'));
      expect(config.blockedPaths).toContain(path.join(os.homedir(), '.aws'));
      expect(config.blockedPaths).toContain('/etc/passwd');
    });

    it('should support custom docker configuration', () => {
      manager = new SandboxManager({
        method: 'docker',
        timeoutMs: 60000,
        maxOutputSize: 2 * 1024 * 1024,
        networkEnabled: false,
      });

      const config = manager.getConfig();

      expect(config.method).toBe('docker');
      expect(config.timeoutMs).toBe(60000);
      expect(config.maxOutputSize).toBe(2 * 1024 * 1024);
      expect(config.networkEnabled).toBe(false);
    });

    it('should allow adding custom blocked paths for docker', () => {
      manager = new SandboxManager({ method: 'docker' });
      manager.blockPath('/custom/sensitive/path');

      const config = manager.getConfig();

      expect(config.blockedPaths).toContain(path.resolve('/custom/sensitive/path'));
    });

    it('should allow adding custom allowed paths for docker', () => {
      manager = new SandboxManager({ method: 'docker' });
      manager.allowPath('/custom/allowed/path');

      const config = manager.getConfig();

      expect(config.allowedPaths).toContain(path.resolve('/custom/allowed/path'));
    });
  });

  // ============================================================
  // Section 2: Docker Command Validation
  // ============================================================
  describe('Docker Command Validation', () => {
    beforeEach(() => {
      manager = new SandboxManager({ method: 'docker' });
    });

    it('should validate commands before docker execution', () => {
      const result = manager.validateCommand('rm -rf /');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('dangerous');
    });

    it('should allow safe commands for docker execution', () => {
      const result = manager.validateCommand('ls -la');

      expect(result.valid).toBe(true);
    });

    it('should block access to host sensitive paths in docker', () => {
      const sshPath = path.join(os.homedir(), '.ssh');
      const result = manager.validateCommand(`cat ${sshPath}/id_rsa`);

      expect(result.valid).toBe(false);
    });

    it('should block access to AWS credentials in docker', () => {
      const awsPath = path.join(os.homedir(), '.aws');
      const result = manager.validateCommand(`cat ${awsPath}/credentials`);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('blocked path');
    });

    it('should block fork bomb in docker', () => {
      const result = manager.validateCommand(':(){ :|:& };:');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('dangerous');
    });
  });

  // ============================================================
  // Section 3: Docker Execution Flow
  // ============================================================
  describe('Docker Execution Flow', () => {
    beforeEach(() => {
      manager = new SandboxManager({ method: 'docker' });
    });

    it('should reject invalid commands before docker execution', async () => {
      const result = await manager.execute('rm -rf /');

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('dangerous');
      expect(result.sandboxed).toBe(false);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should execute valid commands through docker', async () => {
      const mockProcess = createMockChildProcess();

      mockSpawn.mockReturnValue(mockProcess);

      const executePromise = manager.execute('echo hello');

      setTimeout(() => {
        (mockProcess.stdout as EventEmitter).emit('data', Buffer.from('hello'));
        (mockProcess as unknown as EventEmitter).emit('close', 0);
      }, 10);

      const result = await executePromise;

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello');
    });

    it('should handle docker execution errors', async () => {
      const mockProcess = createMockChildProcess();

      mockSpawn.mockReturnValue(mockProcess);

      const executePromise = manager.execute('echo test');

      setTimeout(() => {
        (mockProcess as unknown as EventEmitter).emit('error', new Error('Docker error'));
      }, 10);

      const result = await executePromise;

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('Docker error');
    });
  });

  // ============================================================
  // Section 4: Docker Network Isolation
  // ============================================================
  describe('Docker Network Isolation', () => {
    it('should configure network disabled for docker', () => {
      manager = new SandboxManager({
        method: 'docker',
        networkEnabled: false,
      });

      const config = manager.getConfig();

      expect(config.networkEnabled).toBe(false);
    });

    it('should configure network enabled for docker', () => {
      manager = new SandboxManager({
        method: 'docker',
        networkEnabled: true,
      });

      const config = manager.getConfig();

      expect(config.networkEnabled).toBe(true);
    });

    it('should allow specific domains when configured', () => {
      manager = new SandboxManager({
        method: 'docker',
        networkEnabled: true,
        allowedDomains: ['api.example.com', 'github.com'],
      });

      const config = manager.getConfig();

      expect(config.allowedDomains).toContain('api.example.com');
      expect(config.allowedDomains).toContain('github.com');
    });
  });

  // ============================================================
  // Section 5: Docker Volume Security
  // ============================================================
  describe('Docker Volume Security', () => {
    beforeEach(() => {
      manager = new SandboxManager({ method: 'docker' });
    });

    it('should include working directory in allowed paths', () => {
      const config = manager.getConfig();

      expect(config.allowedPaths).toContain(process.cwd());
    });

    it('should support read-only paths', () => {
      manager = new SandboxManager({
        method: 'docker',
        readOnlyPaths: ['/usr/share', '/etc/localtime'],
      });

      const config = manager.getConfig();

      expect(config.readOnlyPaths).toContain('/usr/share');
      expect(config.readOnlyPaths).toContain('/etc/localtime');
    });

    it('should have default empty read-only paths', () => {
      const config = manager.getConfig();

      expect(config.readOnlyPaths).toEqual([]);
    });

    it('should block mounting sensitive host directories', () => {
      const config = manager.getConfig();

      // These paths should be in blockedPaths and NOT mountable
      expect(config.blockedPaths).toContain(path.join(os.homedir(), '.ssh'));
      expect(config.blockedPaths).toContain(path.join(os.homedir(), '.gnupg'));
      expect(config.blockedPaths).toContain(path.join(os.homedir(), '.aws'));
      expect(config.blockedPaths).toContain(path.join(os.homedir(), '.docker'));
      expect(config.blockedPaths).toContain(path.join(os.homedir(), '.kube'));
    });
  });

  // ============================================================
  // Section 6: Docker Resource Limits
  // ============================================================
  describe('Docker Resource Limits', () => {
    it('should configure timeout for docker execution', () => {
      manager = new SandboxManager({
        method: 'docker',
        timeoutMs: 120000,
      });

      const config = manager.getConfig();

      expect(config.timeoutMs).toBe(120000);
    });

    it('should configure output size limit for docker', () => {
      manager = new SandboxManager({
        method: 'docker',
        maxOutputSize: 5 * 1024 * 1024,
      });

      const config = manager.getConfig();

      expect(config.maxOutputSize).toBe(5 * 1024 * 1024);
    });

    it('should have default 30 second timeout', () => {
      manager = new SandboxManager({ method: 'docker' });
      const config = manager.getConfig();

      expect(config.timeoutMs).toBe(30000);
    });

    it('should have default 1MB output limit', () => {
      manager = new SandboxManager({ method: 'docker' });
      const config = manager.getConfig();

      expect(config.maxOutputSize).toBe(1024 * 1024);
    });
  });

  // ============================================================
  // Section 7: Docker Timeout Handling
  // ============================================================
  describe('Docker Timeout Handling', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should timeout docker commands that exceed limit', async () => {
      manager = new SandboxManager({
        method: 'docker',
        timeoutMs: 1000,
      });

      const mockProcess = createMockChildProcess();
      (mockProcess as unknown as Record<string, unknown>).kill = jest.fn(() => {
        (mockProcess as unknown as EventEmitter).emit('close', 1);
      });

      mockSpawn.mockReturnValue(mockProcess);

      const executePromise = manager.execute('sleep 100');

      jest.advanceTimersByTime(1500);

      const result = await executePromise;

      expect(result.timedOut).toBe(true);
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
    });
  });

  // ============================================================
  // Section 8: Docker Output Handling
  // ============================================================
  describe('Docker Output Handling', () => {
    beforeEach(() => {
      manager = new SandboxManager({ method: 'docker' });
    });

    it('should capture stdout from docker container', async () => {
      const mockProcess = createMockChildProcess();

      mockSpawn.mockReturnValue(mockProcess);

      const executePromise = manager.execute('echo output');

      setTimeout(() => {
        (mockProcess.stdout as EventEmitter).emit('data', Buffer.from('output'));
        (mockProcess as unknown as EventEmitter).emit('close', 0);
      }, 10);

      const result = await executePromise;

      expect(result.stdout).toBe('output');
    });

    it('should capture stderr from docker container', async () => {
      const mockProcess = createMockChildProcess();

      mockSpawn.mockReturnValue(mockProcess);

      const executePromise = manager.execute('invalid-command');

      setTimeout(() => {
        (mockProcess.stderr as EventEmitter).emit('data', Buffer.from('command not found'));
        (mockProcess as unknown as EventEmitter).emit('close', 127);
      }, 10);

      const result = await executePromise;

      expect(result.stderr).toBe('command not found');
      expect(result.exitCode).toBe(127);
    });

    it('should limit output size from docker', async () => {
      manager = new SandboxManager({
        method: 'docker',
        maxOutputSize: 100,
      });

      const mockProcess = createMockChildProcess();

      mockSpawn.mockReturnValue(mockProcess);

      const executePromise = manager.execute('cat large-file');

      setTimeout(() => {
        (mockProcess.stdout as EventEmitter).emit('data', Buffer.from('x'.repeat(200)));
        (mockProcess as unknown as EventEmitter).emit('close', 0);
      }, 10);

      const result = await executePromise;

      expect(result.stdout.length).toBeLessThanOrEqual(100);
    });
  });

  // ============================================================
  // Section 9: Docker Security Policies
  // ============================================================
  describe('Docker Security Policies', () => {
    beforeEach(() => {
      manager = new SandboxManager({ method: 'docker' });
    });

    it('should block Docker socket access', () => {
      const config = manager.getConfig();

      expect(config.blockedPaths).toContain(path.join(os.homedir(), '.docker'));
    });

    it('should block Kubernetes config access', () => {
      const config = manager.getConfig();

      expect(config.blockedPaths).toContain(path.join(os.homedir(), '.kube'));
    });

    it('should block GitHub CLI config access', () => {
      const config = manager.getConfig();

      expect(config.blockedPaths).toContain(path.join(os.homedir(), '.config/gh'));
    });

    it('should block gcloud config access', () => {
      const config = manager.getConfig();

      expect(config.blockedPaths).toContain(path.join(os.homedir(), '.config/gcloud'));
    });

    it('should block npmrc access', () => {
      const config = manager.getConfig();

      expect(config.blockedPaths).toContain(path.join(os.homedir(), '.npmrc'));
    });

    it('should block gitconfig access', () => {
      const config = manager.getConfig();

      expect(config.blockedPaths).toContain(path.join(os.homedir(), '.gitconfig'));
    });

    it('should block netrc access', () => {
      const config = manager.getConfig();

      expect(config.blockedPaths).toContain(path.join(os.homedir(), '.netrc'));
    });

    it('should block system password file access', () => {
      const config = manager.getConfig();

      expect(config.blockedPaths).toContain('/etc/passwd');
    });

    it('should block system shadow file access', () => {
      const config = manager.getConfig();

      expect(config.blockedPaths).toContain('/etc/shadow');
    });

    it('should block sudoers file access', () => {
      const config = manager.getConfig();

      expect(config.blockedPaths).toContain('/etc/sudoers');
    });
  });

  // ============================================================
  // Section 10: Docker Status Display
  // ============================================================
  describe('Docker Status Display', () => {
    it('should display docker method in status', () => {
      manager = new SandboxManager({ method: 'docker' });
      const status = manager.formatStatus();

      expect(status).toContain('Method: docker');
    });

    it('should display network status for docker', () => {
      manager = new SandboxManager({
        method: 'docker',
        networkEnabled: false,
      });
      const status = manager.formatStatus();

      expect(status).toContain('Network: disabled');
    });

    it('should display timeout for docker', () => {
      manager = new SandboxManager({
        method: 'docker',
        timeoutMs: 60000,
      });
      const status = manager.formatStatus();

      expect(status).toContain('Timeout: 60000ms');
    });

    it('should display blocked paths count', () => {
      manager = new SandboxManager({ method: 'docker' });
      const status = manager.formatStatus();

      expect(status).toContain('Blocked paths:');
    });

    it('should display allowed paths count', () => {
      manager = new SandboxManager({ method: 'docker' });
      const status = manager.formatStatus();

      expect(status).toContain('Allowed paths:');
    });
  });

  // ============================================================
  // Section 11: Docker Configuration Updates
  // ============================================================
  describe('Docker Configuration Updates', () => {
    it('should update docker configuration', () => {
      manager = new SandboxManager({ method: 'docker' });

      manager.updateConfig({
        timeoutMs: 45000,
        networkEnabled: false,
      });

      const config = manager.getConfig();

      expect(config.timeoutMs).toBe(45000);
      expect(config.networkEnabled).toBe(false);
      expect(config.method).toBe('docker');
    });

    it('should switch from docker to native method', () => {
      manager = new SandboxManager({ method: 'docker' });

      manager.updateConfig({ method: 'native' });

      const config = manager.getConfig();

      expect(config.method).toBe('native');
    });

    it('should switch from native to docker method', () => {
      manager = new SandboxManager({ method: 'native' });

      manager.updateConfig({ method: 'docker' });

      const config = manager.getConfig();

      expect(config.method).toBe('docker');
    });
  });

  // ============================================================
  // Section 12: Docker Singleton Pattern
  // ============================================================
  describe('Docker Singleton Pattern', () => {
    it('should return same docker sandbox instance', () => {
      resetSandboxManager();
      const instance1 = getSandboxManager({ method: 'docker' });
      const instance2 = getSandboxManager();

      expect(instance1).toBe(instance2);
      expect(instance1.getConfig().method).toBe('docker');
    });

    it('should create new docker instance after reset', () => {
      const instance1 = getSandboxManager({ method: 'docker' });
      resetSandboxManager();
      const instance2 = getSandboxManager({ method: 'docker' });

      expect(instance1).not.toBe(instance2);
    });
  });

  // ============================================================
  // Section 13: Docker Edge Cases
  // ============================================================
  describe('Docker Edge Cases', () => {
    beforeEach(() => {
      manager = new SandboxManager({ method: 'docker' });
    });

    it('should handle empty command in docker', async () => {
      const mockProcess = createMockChildProcess();

      mockSpawn.mockReturnValue(mockProcess);

      const executePromise = manager.execute('');

      setTimeout(() => {
        (mockProcess as unknown as EventEmitter).emit('close', 0);
      }, 10);

      const result = await executePromise;

      expect(result).toBeDefined();
    });

    it('should handle special characters in docker commands', async () => {
      const mockProcess = createMockChildProcess();

      mockSpawn.mockReturnValue(mockProcess);

      const executePromise = manager.execute('echo "hello $USER"');

      setTimeout(() => {
        (mockProcess.stdout as EventEmitter).emit('data', Buffer.from('hello user'));
        (mockProcess as unknown as EventEmitter).emit('close', 0);
      }, 10);

      const result = await executePromise;

      expect(result.exitCode).toBe(0);
    });

    it('should handle null exit code from docker', async () => {
      const mockProcess = createMockChildProcess();

      mockSpawn.mockReturnValue(mockProcess);

      const executePromise = manager.execute('echo test');

      setTimeout(() => {
        (mockProcess as unknown as EventEmitter).emit('close', null);
      }, 10);

      const result = await executePromise;

      expect(result.exitCode).toBe(1);
    });

    it('should handle concurrent docker executions', async () => {
      const mockProcess1 = createMockChildProcess();
      const mockProcess2 = createMockChildProcess();

      mockSpawn.mockReturnValueOnce(mockProcess1).mockReturnValueOnce(mockProcess2);

      const promise1 = manager.execute('echo first');
      const promise2 = manager.execute('echo second');

      setTimeout(() => {
        (mockProcess1.stdout as EventEmitter).emit('data', Buffer.from('first'));
        (mockProcess1 as unknown as EventEmitter).emit('close', 0);
      }, 10);

      setTimeout(() => {
        (mockProcess2.stdout as EventEmitter).emit('data', Buffer.from('second'));
        (mockProcess2 as unknown as EventEmitter).emit('close', 0);
      }, 20);

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1.stdout).toBe('first');
      expect(result2.stdout).toBe('second');
    });
  });

  // ============================================================
  // Section 14: Docker Container Configuration
  // ============================================================
  describe('Docker Container Configuration', () => {
    it('should support all sandbox methods', () => {
      const methods: Array<'none' | 'firejail' | 'docker' | 'native'> = ['none', 'firejail', 'docker', 'native'];

      for (const method of methods) {
        const testManager = new SandboxManager({ method });
        expect(testManager.getConfig().method).toBe(method);
      }
    });

    it('should combine multiple configuration options', () => {
      manager = new SandboxManager({
        method: 'docker',
        allowedPaths: ['/app', '/data'],
        readOnlyPaths: ['/usr', '/lib'],
        blockedPaths: ['/root', '/home/other'],
        networkEnabled: false,
        allowedDomains: ['api.internal.com'],
        timeoutMs: 90000,
        maxOutputSize: 512 * 1024,
      });

      const config = manager.getConfig();

      expect(config.method).toBe('docker');
      expect(config.allowedPaths).toContain('/app');
      expect(config.allowedPaths).toContain('/data');
      expect(config.readOnlyPaths).toContain('/usr');
      expect(config.readOnlyPaths).toContain('/lib');
      expect(config.blockedPaths).toContain('/root');
      expect(config.blockedPaths).toContain('/home/other');
      expect(config.networkEnabled).toBe(false);
      expect(config.allowedDomains).toContain('api.internal.com');
      expect(config.timeoutMs).toBe(90000);
      expect(config.maxOutputSize).toBe(512 * 1024);
    });
  });

  // ============================================================
  // Section 15: Docker Path Manipulation Protection
  // ============================================================
  describe('Docker Path Manipulation Protection', () => {
    beforeEach(() => {
      manager = new SandboxManager({ method: 'docker' });
    });

    it('should resolve paths before blocking', () => {
      manager.blockPath('./relative/../sensitive');
      const config = manager.getConfig();

      expect(config.blockedPaths).toContain(path.resolve('./relative/../sensitive'));
    });

    it('should resolve paths before allowing', () => {
      manager.allowPath('./relative/../allowed');
      const config = manager.getConfig();

      expect(config.allowedPaths).toContain(path.resolve('./relative/../allowed'));
    });

    it('should prevent accessing parent directories', () => {
      const evilPath = path.join(os.homedir(), '.ssh', '..', '.ssh');
      const result = manager.validateCommand(`cat ${evilPath}/id_rsa`);

      expect(result.valid).toBe(false);
    });
  });
});
