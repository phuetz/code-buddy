import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { resetExecPolicy } from '../../src/sandbox/execpolicy.js';
import { clearPermissionsCache } from '../../src/security/declarative-rules.js';
import {
  getPermissionModeManager,
  resetPermissionModeManager,
} from '../../src/security/permission-modes.js';
import { PolicyEngine } from '../../src/security/policy-engine.js';
import * as sshSandboxModule from '../../src/sandbox/ssh-sandbox.js';
import { SshSandbox } from '../../src/sandbox/ssh-sandbox.js';
import { BashTool } from '../../src/tools/bash/bash-tool.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import {
  evaluateShellExecution,
  executeInWorkspaceSandbox,
  executableIdentitiesStillMatch,
  isSandboxBoundaryFailure,
} from '../../src/tools/bash/execution-policy.js';
import { sandboxAvailable } from '../helpers/sandbox-availability.js';

describe('Bash runtime execution policy', () => {
  beforeEach(() => {
    delete process.env.CODEBUDDY_NATIVE_SANDBOX;
    delete process.env.CODEBUDDY_SANDBOX_BACKEND;
    delete process.env.CODEBUDDY_SSH_HOST;
    delete process.env.CODEBUDDY_SSH_HOSTS;
    delete process.env.CODEBUDDY_SSH_HOSTS_FILE;
    resetExecPolicy();
    resetPermissionModeManager();
    clearPermissionsCache();
    PolicyEngine.getInstance().releaseKillSwitch();
    getPermissionModeManager().setMode('default');
  });

  afterEach(() => {
    delete process.env.CODEBUDDY_NATIVE_SANDBOX;
    delete process.env.CODEBUDDY_SANDBOX_BACKEND;
    delete process.env.CODEBUDDY_SSH_HOST;
    delete process.env.CODEBUDDY_SSH_HOSTS;
    delete process.env.CODEBUDDY_SSH_HOSTS_FILE;
    vi.restoreAllMocks();
    PolicyEngine.getInstance().releaseKillSwitch();
    resetExecPolicy();
    resetPermissionModeManager();
    clearPermissionsCache();
  });

  it('does not demand approval for a cwd under the macOS canonical /private prefix', async () => {
    // After `cd $TMPDIR` the bash tool stores the realpath (/private/var/folders/…);
    // that prefix must not turn a sandboxed `pwd` into an approval prompt.
    await expect(
      evaluateShellExecution('pwd', '/private/var/folders/df/x/T/code-buddy-work')
    ).resolves.toMatchObject({ action: 'sandbox' });
  });

  it('keeps read-only commands inside the workspace sandbox', async () => {
    await expect(evaluateShellExecution('cat README.md', process.cwd())).resolves.toMatchObject({
      action: 'sandbox',
    });
    await expect(
      evaluateShellExecution('git status --short', process.cwd())
    ).resolves.toMatchObject({
      action: 'sandbox',
    });
  });

  it.each([
    '.',
    process.cwd(),
    '~/DEV/cb-headless2-2026-09-03',
  ])('keeps a read-only git -C %s chain sandboxed in dontAsk mode', async (gitRoot) => {
    getPermissionModeManager().setMode('dontAsk');

    await expect(
      evaluateShellExecution(`pwd && git -C ${gitRoot} status -sb | head -3`, process.cwd()),
    ).resolves.toMatchObject({ action: 'sandbox' });
  });

  it.skipIf(!sandboxAvailable())(
    'keeps the caller HOME spelling available to the Docker workspace sandbox',
    async () => {
      const sandboxed = await executeInWorkspaceSandbox('printf %s "$HOME"', process.cwd(), 30000);

      if (!sandboxed.available || sandboxed.result?.backend !== 'docker') return;

      expect(sandboxed.result.stdout.trim()).toBe(os.homedir());
    },
  );

  it('asks for exact authority when an operation crosses the sandbox boundary', async () => {
    await expect(evaluateShellExecution('npm install', process.cwd())).resolves.toMatchObject({
      action: 'ask',
    });
  });

  it('retains deterministic denials', async () => {
    await expect(evaluateShellExecution('rm -rf /', process.cwd())).resolves.toMatchObject({
      action: 'deny',
    });
  });

  it.each([2, 126, 127])('does not turn application exit %i into a host escalation', (exitCode) => {
    expect(isSandboxBoundaryFailure({
      exitCode,
      stdout: '',
      stderr: exitCode === 127 ? 'command not found' : 'permission denied',
      duration: 1,
      timedOut: false,
      backend: 'docker',
      sandboxed: true,
    })).toBe(false);
  });

  it('recognizes an explicit filesystem boundary denial', () => {
    expect(isSandboxBoundaryFailure({
      exitCode: 1,
      stdout: '',
      stderr: 'read-only file system',
      duration: 1,
      timedOut: false,
      backend: 'docker',
      sandboxed: true,
    })).toBe(true);
  });

  // The probe executable is a POSIX shell script resolved through PATH without an
  // extension — not how Windows resolves executables (PATHEXT).
  it.skipIf(process.platform === 'win32')('binds exact approvals to the resolved executable and detects replacement before spawn', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-executable-id-'));
    const executable = path.join(dir, 'policy-probe');
    const previousPath = process.env.PATH;
    fs.writeFileSync(executable, '#!/bin/sh\necho first\n');
    fs.chmodSync(executable, 0o755);
    process.env.PATH = `${dir}${path.delimiter}${previousPath ?? ''}`;

    try {
      const first = await evaluateShellExecution('policy-probe --version', process.cwd());
      expect(first.executableIdentities).toEqual(expect.arrayContaining([
        expect.objectContaining({
          token: 'policy-probe',
          kind: 'file',
          resolvedPath: fs.realpathSync(executable),
        }),
      ]));
      expect(executableIdentitiesStillMatch(first, process.cwd())).toBe(true);

      fs.writeFileSync(executable, '#!/bin/sh\necho replacement-with-different-size\n');
      fs.chmodSync(executable, 0o755);
      expect(executableIdentitiesStillMatch(first, process.cwd())).toBe(false);

      const second = await evaluateShellExecution('policy-probe --version', process.cwd());
      expect(second.approvalKey).not.toBe(first.approvalKey);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it.each([
    'SSH connection failed: Permission denied (publickey).',
    'SSH connection failed: ssh: Could not resolve hostname hoteExemple.example: Name or service not known',
    'SSH connection failed: connect to host hoteExemple.example port 22: Connection refused',
  ])('never treats an SSH transport failure as a sandbox boundary escalation (%s)', (stderr) => {
    expect(isSandboxBoundaryFailure({
      exitCode: 255,
      stdout: '',
      stderr,
      duration: 12,
      timedOut: false,
      backend: 'ssh',
      sandboxed: true,
    })).toBe(false);
  });

  describe('executeInWorkspaceSandbox with explicit SSH backend', () => {
    function createMockProcess(): sshSandboxModule.SshChildProcessLike & EventEmitter {
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      const stdin = { write: vi.fn(), end: vi.fn() };
      const proc = new EventEmitter() as EventEmitter & sshSandboxModule.SshChildProcessLike;
      proc.stdout = stdout;
      proc.stderr = stderr;
      proc.stdin = stdin;
      proc.pid = 4242;
      proc.kill = vi.fn(() => true);
      return proc;
    }

    it('executes command via SshSandbox when CODEBUDDY_SANDBOX_BACKEND=ssh', async () => {
      process.env.CODEBUDDY_SANDBOX_BACKEND = 'ssh';
      process.env.CODEBUDDY_SSH_HOST = 'hoteExemple';
      process.env.CODEBUDDY_SSH_HOSTS = JSON.stringify({
        hosts: {
          hoteExemple: {
            host: 'hoteExemple.example',
            user: 'buddy',
          },
        },
      });

      const mockSpawn = vi.fn((_cmd: string, _args: string[]) => {
        const proc = createMockProcess();
        setImmediate(() => {
          proc.stdout.emit('data', Buffer.from('remote output\n'));
          proc.emit('close', 0);
        });
        return proc;
      });

      vi.spyOn(sshSandboxModule, 'createSshSandbox').mockImplementation((config) => {
        return new SshSandbox({
          ...config,
          hasSshClient: () => true,
          spawn: mockSpawn,
        });
      });

      const sandboxed = await executeInWorkspaceSandbox('echo "remote test"', process.cwd(), 5000);
      expect(sandboxed.available).toBe(true);
      expect(sandboxed.result).toMatchObject({
        backend: 'ssh',
        sandboxed: true,
        exitCode: 0,
        stdout: 'remote output\n',
      });
    });

    it('returns SSH failure and never proposes nor executes direct local fallback on transport refusal', async () => {
      process.env.CODEBUDDY_SANDBOX_BACKEND = 'ssh';
      process.env.CODEBUDDY_SSH_HOST = 'hoteExemple';
      process.env.CODEBUDDY_SSH_HOSTS = JSON.stringify({
        hosts: {
          hoteExemple: {
            host: 'hoteExemple.example',
            user: 'buddy',
          },
        },
      });

      const mockSpawn = vi.fn((_cmd: string, _args: string[]) => {
        const proc = createMockProcess();
        setImmediate(() => {
          proc.stderr.emit('data', Buffer.from('Permission denied (publickey).\n'));
          proc.emit('close', 255);
        });
        return proc;
      });

      vi.spyOn(sshSandboxModule, 'createSshSandbox').mockImplementation((config) => {
        return new SshSandbox({
          ...config,
          hasSshClient: () => true,
          spawn: mockSpawn,
        });
      });

      // 1. Verify executeInWorkspaceSandbox directly
      const sandboxed = await executeInWorkspaceSandbox('git status', process.cwd(), 5000);
      expect(sandboxed.available).toBe(true);
      expect(sandboxed.result).toBeDefined();
      expect(sandboxed.result?.backend).toBe('ssh');
      expect(sandboxed.result?.exitCode).toBe(255);
      expect(sandboxed.result?.stderr).toContain('Permission denied (publickey)');

      // Critical check: isSandboxBoundaryFailure must return false
      expect(isSandboxBoundaryFailure(sandboxed.result!)).toBe(false);

      // 2. Verify full execution through BashTool: no direct approval asked, no host spawn executed
      const confirmationSpy = vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation');

      const tool = new BashTool();
      const executeWithSpawnSpy = vi.spyOn(tool as any, 'executeWithSpawn');
      const execResult = await tool.execute('git status');
      tool.dispose();

      // Verify no local escalation was proposed
      expect(confirmationSpy).not.toHaveBeenCalled();
      // Verify no local command was spawned on the host machine
      expect(executeWithSpawnSpy).not.toHaveBeenCalled();
      // Verify the SSH error is returned to caller with sandbox:ssh
      expect(execResult.error).toContain('Permission denied (publickey)');
      expect(execResult.error).toContain('[sandbox:ssh; exit code 255]');
    });
  });
});
