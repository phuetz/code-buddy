/**
 * Tests for Landlock + Seccomp Sandbox Support
 */

import * as os from 'os';
import * as fs from 'fs';
import * as child_process from 'child_process';

jest.mock('os', () => {
  const actual = jest.requireActual('os');
  return {
    ...actual,
    platform: jest.fn(actual.platform),
    release: jest.fn(actual.release),
    tmpdir: jest.fn(actual.tmpdir),
  };
});

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn(actual.existsSync),
    writeFileSync: jest.fn(actual.writeFileSync),
    unlinkSync: jest.fn(actual.unlinkSync),
    readFileSync: jest.fn(actual.readFileSync),
    accessSync: jest.fn(actual.accessSync),
    constants: actual.constants,
  };
});

jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return {
    ...actual,
    spawn: jest.fn(actual.spawn),
  };
});

// Import after mocks are set up
import {
  OSSandbox,
  detectCapabilities,
  clearCapabilitiesCache,
  resetOSSandbox,
  checkLandlockSupport,
  generateSeccompFilter,
} from '../../src/sandbox/os-sandbox';

jest.setTimeout(30000);

const mockPlatform = os.platform as jest.Mock;
const mockRelease = os.release as jest.Mock;
const mockExistsSync = fs.existsSync as jest.Mock;
const mockWriteFileSync = fs.writeFileSync as jest.Mock;
const mockUnlinkSync = fs.unlinkSync as jest.Mock;
const mockAccessSync = fs.accessSync as jest.Mock;
const mockSpawn = child_process.spawn as jest.Mock;

function createMockProcess(exitCode = 0, stdoutData = '', stderrData = '') {
  const EventEmitter = require('events');
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();

  setTimeout(() => {
    if (stdoutData) proc.stdout.emit('data', Buffer.from(stdoutData));
    if (stderrData) proc.stderr.emit('data', Buffer.from(stderrData));
    proc.emit('close', exitCode);
  }, 10);

  return proc;
}

describe('Landlock + Seccomp Sandbox', () => {
  beforeEach(() => {
    clearCapabilitiesCache();
    resetOSSandbox();
    jest.clearAllMocks();
    // Reset to actual implementations by default
    mockPlatform.mockReturnValue(jest.requireActual('os').platform());
    mockRelease.mockReturnValue(jest.requireActual('os').release());
    mockExistsSync.mockImplementation(jest.requireActual('fs').existsSync);
    mockSpawn.mockImplementation(jest.requireActual('child_process').spawn);
  });

  afterEach(() => {
    resetOSSandbox();
  });

  // ==========================================================================
  // Capability Detection
  // ==========================================================================

  describe('checkLandlockSupport()', () => {
    it('should return true when /proc/sys/kernel/unprivileged_landlock_restrict exists', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/proc/sys/kernel/unprivileged_landlock_restrict') return true;
        return false;
      });

      expect(checkLandlockSupport()).toBe(true);
    });

    it('should return true when kernel version >= 5.13', () => {
      mockExistsSync.mockReturnValue(false);
      mockRelease.mockReturnValue('5.15.0-generic');

      expect(checkLandlockSupport()).toBe(true);
    });

    it('should return true for kernel major version > 5', () => {
      mockExistsSync.mockReturnValue(false);
      mockRelease.mockReturnValue('6.1.0-arch1');

      expect(checkLandlockSupport()).toBe(true);
    });

    it('should return false when kernel version < 5.13', () => {
      mockExistsSync.mockReturnValue(false);
      mockRelease.mockReturnValue('5.10.0-generic');

      expect(checkLandlockSupport()).toBe(false);
    });

    it('should return false when kernel version is 4.x', () => {
      mockExistsSync.mockReturnValue(false);
      mockRelease.mockReturnValue('4.19.0-generic');

      expect(checkLandlockSupport()).toBe(false);
    });

    it('should return false when proc check throws and kernel is old', () => {
      mockExistsSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      mockRelease.mockReturnValue('4.15.0');

      expect(checkLandlockSupport()).toBe(false);
    });

    it('should return true when proc check throws but kernel >= 5.13', () => {
      mockExistsSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      mockRelease.mockReturnValue('5.13.0');

      expect(checkLandlockSupport()).toBe(true);
    });

    it('should handle unparseable kernel version gracefully', () => {
      mockExistsSync.mockReturnValue(false);
      mockRelease.mockReturnValue('not-a-version');

      expect(checkLandlockSupport()).toBe(false);
    });

    it('should return true for exactly kernel 5.13', () => {
      mockExistsSync.mockReturnValue(false);
      mockRelease.mockReturnValue('5.13.0-custom');

      expect(checkLandlockSupport()).toBe(true);
    });
  });

  describe('detectCapabilities() with Landlock', () => {
    it('should include landlock property in capabilities', async () => {
      const capabilities = await detectCapabilities();

      expect(capabilities).toHaveProperty('landlock');
      expect(typeof capabilities.landlock).toBe('boolean');
    });

    it('should recommend landlock when landlock and bubblewrap are both available on Linux', async () => {
      mockPlatform.mockReturnValue('linux');
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/proc/sys/kernel/unprivileged_landlock_restrict') return true;
        return false;
      });

      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'which' && args[0] === 'bwrap') {
          return createMockProcess(0, '/usr/bin/bwrap\n');
        }
        return createMockProcess(1);
      });

      const caps = await detectCapabilities();
      expect(caps.landlock).toBe(true);
      expect(caps.bubblewrap).toBe(true);
      expect(caps.recommended).toBe('landlock');
    });

    it('should recommend bubblewrap when landlock is not available', async () => {
      mockPlatform.mockReturnValue('linux');
      mockExistsSync.mockReturnValue(false);
      mockRelease.mockReturnValue('4.19.0-generic');

      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'which' && args[0] === 'bwrap') {
          return createMockProcess(0, '/usr/bin/bwrap\n');
        }
        return createMockProcess(1);
      });

      const caps = await detectCapabilities();
      expect(caps.landlock).toBe(false);
      expect(caps.bubblewrap).toBe(true);
      expect(caps.recommended).toBe('bubblewrap');
    });

    it('should not detect landlock on macOS', async () => {
      mockPlatform.mockReturnValue('darwin');

      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'which' && args[0] === 'sandbox-exec') {
          return createMockProcess(0, '/usr/bin/sandbox-exec\n');
        }
        return createMockProcess(1);
      });

      const caps = await detectCapabilities();
      expect(caps.landlock).toBe(false);
      expect(caps.recommended).toBe('seatbelt');
    });
  });

  // ==========================================================================
  // Seccomp Filter Generation
  // ==========================================================================

  describe('generateSeccompFilter()', () => {
    it('should return a Buffer', () => {
      const filter = generateSeccompFilter();
      expect(Buffer.isBuffer(filter)).toBe(true);
    });

    it('should have correct size for BPF instructions', () => {
      const filter = generateSeccompFilter();
      // 1 (load) + 6 (blocked syscalls) + 1 (allow) + 1 (kill) = 9 instructions
      // Each instruction is 8 bytes
      const expectedSize = 9 * 8;
      expect(filter.length).toBe(expectedSize);
    });

    it('should start with BPF_LD instruction to load syscall number', () => {
      const filter = generateSeccompFilter();
      // BPF_LD | BPF_W | BPF_ABS = 0x00 | 0x00 | 0x20 = 0x20
      const code = filter.readUInt16LE(0);
      expect(code).toBe(0x20);
      // k value should be 0 (offset of nr in seccomp_data)
      const k = filter.readUInt32LE(4);
      expect(k).toBe(0);
    });

    it('should contain JEQ instructions for blocked syscalls', () => {
      const filter = generateSeccompFilter();
      // Instructions 1-6 should be BPF_JMP | BPF_JEQ | BPF_K = 0x05 | 0x10 | 0x00 = 0x15
      const blockedSyscalls = [165, 166, 169, 246, 101, 155];

      for (let i = 0; i < blockedSyscalls.length; i++) {
        const offset = (i + 1) * 8;
        const code = filter.readUInt16LE(offset);
        expect(code).toBe(0x15);

        const syscallNum = filter.readUInt32LE(offset + 4);
        expect(syscallNum).toBe(blockedSyscalls[i]);
      }
    });

    it('should end with ALLOW then KILL return instructions', () => {
      const filter = generateSeccompFilter();
      const numInstructions = filter.length / 8;

      // Second to last: ALLOW
      const allowOffset = (numInstructions - 2) * 8;
      const allowCode = filter.readUInt16LE(allowOffset);
      expect(allowCode).toBe(0x06); // BPF_RET | BPF_K
      const allowValue = filter.readUInt32LE(allowOffset + 4);
      expect(allowValue).toBe(0x7fff0000); // SECCOMP_RET_ALLOW

      // Last: KILL
      const killOffset = (numInstructions - 1) * 8;
      const killCode = filter.readUInt16LE(killOffset);
      expect(killCode).toBe(0x06); // BPF_RET | BPF_K
      const killValue = filter.readUInt32LE(killOffset + 4);
      expect(killValue).toBe(0x00000000); // SECCOMP_RET_KILL
    });

    it('should have correct jump targets for each comparison', () => {
      const filter = generateSeccompFilter();
      const numBlocked = 6;

      for (let i = 0; i < numBlocked; i++) {
        const offset = (i + 1) * 8;
        const jt = filter.readUInt8(offset + 2);
        const jf = filter.readUInt8(offset + 3);

        // jt should jump to KILL: skip remaining compares + allow
        const remainingCompares = numBlocked - 1 - i;
        const expectedJt = remainingCompares + 1;
        expect(jt).toBe(expectedJt);

        // jf should always be 0 (fall through)
        expect(jf).toBe(0);
      }
    });
  });

  // ==========================================================================
  // Sandbox Execution with Landlock Backend
  // ==========================================================================

  describe('OSSandbox with landlock backend', () => {
    it('should select landlock backend when explicitly configured and available', async () => {
      mockPlatform.mockReturnValue('linux');
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/proc/sys/kernel/unprivileged_landlock_restrict') return true;
        return true;
      });

      mockSpawn.mockImplementation((cmd: string) => {
        return createMockProcess(0, '/usr/bin/bwrap\n');
      });

      const sandbox = new OSSandbox({
        backend: 'landlock',
        workDir: '/tmp',
        timeout: 5000,
      });

      await sandbox.initialize();
      expect(sandbox.getBackend()).toBe('landlock');
      expect(sandbox.isAvailable()).toBe(true);
    });

    it('should fall back to none when landlock requested but bwrap unavailable', async () => {
      mockPlatform.mockReturnValue('linux');
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/proc/sys/kernel/unprivileged_landlock_restrict') return true;
        return false;
      });

      mockSpawn.mockImplementation(() => {
        return createMockProcess(1);
      });

      const sandbox = new OSSandbox({
        backend: 'landlock',
        workDir: '/tmp',
        timeout: 5000,
      });

      await sandbox.initialize();
      expect(sandbox.getBackend()).toBe('none');
    });

    it('should execute command via landlock backend', async () => {
      mockPlatform.mockReturnValue('linux');
      mockExistsSync.mockReturnValue(true);
      mockWriteFileSync.mockImplementation(() => {});
      mockUnlinkSync.mockImplementation(() => {});
      mockAccessSync.mockImplementation(() => {});

      let executedViaShell = false;
      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'sh' && args[0] === '-c') {
          executedViaShell = true;
          return createMockProcess(0, 'hello world\n');
        }
        // Capability detection calls
        return createMockProcess(0, '/usr/bin/bwrap\n');
      });

      const sandbox = new OSSandbox({
        backend: 'landlock',
        workDir: '/tmp',
        timeout: 5000,
      });

      const result = await sandbox.exec('echo', ['hello']);
      expect(result.backend).toBe('landlock');
      expect(result.sandboxed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(executedViaShell).toBe(true);
    });

    it('should include --seccomp flag in bwrap arguments', async () => {
      mockPlatform.mockReturnValue('linux');
      mockExistsSync.mockReturnValue(true);
      mockWriteFileSync.mockImplementation(() => {});
      mockUnlinkSync.mockImplementation(() => {});
      mockAccessSync.mockImplementation(() => {});

      let shellCommand = '';
      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'sh' && args[0] === '-c') {
          shellCommand = args[1];
        }
        return createMockProcess(0, 'ok\n');
      });

      const sandbox = new OSSandbox({
        backend: 'landlock',
        workDir: '/tmp',
        timeout: 5000,
      });

      await sandbox.exec('ls', ['-la']);

      expect(shellCommand).toContain('--seccomp');
      expect(shellCommand).toContain("'9'");
      expect(shellCommand).toContain('9<');
    });

    it('should clean up seccomp filter file after execution', async () => {
      mockPlatform.mockReturnValue('linux');
      mockExistsSync.mockReturnValue(true);
      mockWriteFileSync.mockImplementation(() => {});
      mockUnlinkSync.mockImplementation(() => {});
      mockAccessSync.mockImplementation(() => {});

      mockSpawn.mockImplementation(() => {
        return createMockProcess(0);
      });

      const sandbox = new OSSandbox({
        backend: 'landlock',
        workDir: '/tmp',
        timeout: 5000,
      });

      await sandbox.exec('echo', ['test']);

      // writeFileSync should have been called for the seccomp filter
      const seccompWrites = mockWriteFileSync.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('grok-seccomp')
      );
      expect(seccompWrites.length).toBeGreaterThanOrEqual(1);

      // unlinkSync should have been called to clean up
      const seccompUnlinks = mockUnlinkSync.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('grok-seccomp')
      );
      expect(seccompUnlinks.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================================
  // Fallback Behavior
  // ==========================================================================

  describe('Fallback behavior', () => {
    it('should fall back to bubblewrap when seccomp filter generation fails', async () => {
      mockPlatform.mockReturnValue('linux');
      mockExistsSync.mockReturnValue(true);
      mockWriteFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes('grok-seccomp')) {
          throw new Error('Disk full');
        }
      });

      let usedBwrapDirectly = false;
      mockSpawn.mockImplementation((cmd: string) => {
        if (cmd === 'bwrap') {
          usedBwrapDirectly = true;
        }
        return createMockProcess(0, 'fallback output\n');
      });

      const sandbox = new OSSandbox({
        backend: 'landlock',
        workDir: '/tmp',
        timeout: 5000,
      });

      const result = await sandbox.exec('echo', ['test']);

      expect(usedBwrapDirectly).toBe(true);
      expect(result.backend).toBe('bubblewrap');
      expect(result.sandboxed).toBe(true);
    });

    it('should handle seccomp file read failure in execWithSeccomp', async () => {
      mockPlatform.mockReturnValue('linux');
      mockExistsSync.mockReturnValue(true);
      mockWriteFileSync.mockImplementation(() => {});
      mockUnlinkSync.mockImplementation(() => {});
      mockAccessSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      mockSpawn.mockImplementation(() => {
        return createMockProcess(0);
      });

      const sandbox = new OSSandbox({
        backend: 'landlock',
        workDir: '/tmp',
        timeout: 5000,
      });

      const result = await sandbox.exec('echo', ['test']);
      expect(result.backend).toBe('landlock');
      expect(result.sandboxed).toBe(false);
      expect(result.stderr).toContain('Failed to read seccomp filter');
    });

    it('should not include --unshare-net when allowNetwork is true', async () => {
      mockPlatform.mockReturnValue('linux');
      mockExistsSync.mockReturnValue(true);
      mockWriteFileSync.mockImplementation(() => {});
      mockUnlinkSync.mockImplementation(() => {});
      mockAccessSync.mockImplementation(() => {});

      let shellCommand = '';
      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'sh' && args[0] === '-c') {
          shellCommand = args[1];
        }
        return createMockProcess(0);
      });

      const sandbox = new OSSandbox({
        backend: 'landlock',
        workDir: '/tmp',
        timeout: 5000,
        allowNetwork: true,
      });

      await sandbox.exec('curl', ['https://example.com']);

      expect(shellCommand).not.toContain('--unshare-net');
    });

    it('should include --unshare-net when allowNetwork is false', async () => {
      mockPlatform.mockReturnValue('linux');
      mockExistsSync.mockReturnValue(true);
      mockWriteFileSync.mockImplementation(() => {});
      mockUnlinkSync.mockImplementation(() => {});
      mockAccessSync.mockImplementation(() => {});

      let shellCommand = '';
      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'sh' && args[0] === '-c') {
          shellCommand = args[1];
        }
        return createMockProcess(0);
      });

      const sandbox = new OSSandbox({
        backend: 'landlock',
        workDir: '/tmp',
        timeout: 5000,
        allowNetwork: false,
      });

      await sandbox.exec('curl', ['https://example.com']);

      expect(shellCommand).toContain('--unshare-net');
    });
  });
});
