/**
 * SSH sandbox backend tests.
 *
 * Uses an injected command launcher — no real SSH server and no Darkstar.
 */

import { EventEmitter } from 'events';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExecPolicy, resetExecPolicy } from '../../src/sandbox/execpolicy.js';
import { parseSshHostCatalog, parseSshHostDefinition } from '../../src/sandbox/ssh-hosts.js';
import {
  SshSandbox,
  buildRemoteKillScript,
  buildRemoteRunScript,
  buildSshClientArgs,
  classifySshConnectionFailure,
  ensureSshSandboxRegistered,
  resolveExplicitSshSandboxRequest,
  type SshChildProcessLike,
  type SshCommandLauncher,
} from '../../src/sandbox/ssh-sandbox.js';
import {
  getActiveSandboxBackend,
  registerSandboxBackend,
  resetSandboxRegistry,
} from '../../src/sandbox/sandbox-registry.js';

function createMockProcess(): SshChildProcessLike & EventEmitter {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const stdin = { write: vi.fn(), end: vi.fn() };
  const proc = new EventEmitter() as EventEmitter & SshChildProcessLike;
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.stdin = stdin;
  proc.pid = 4242;
  proc.kill = vi.fn(() => true);
  return proc;
}

function createLauncher(): {
  spawn: SshCommandLauncher;
  calls: Array<{ command: string; args: string[]; proc: ReturnType<typeof createMockProcess> }>;
} {
  const calls: Array<{ command: string; args: string[]; proc: ReturnType<typeof createMockProcess> }> = [];
  const spawn: SshCommandLauncher = (command, args) => {
    const proc = createMockProcess();
    calls.push({ command, args, proc });
    return proc;
  };
  return { spawn, calls };
}

const darkstar = {
  host: 'darkstar.example',
  user: 'buddy',
  port: 22,
  workDir: '/tmp/cb-ssh',
};

function createSandbox(spawn: SshCommandLauncher, extra: Record<string, unknown> = {}): SshSandbox {
  return new SshSandbox({
    hosts: { darkstar },
    defaultHost: 'darkstar',
    hasSshClient: () => true,
    evaluatePolicy: () => ({ action: 'allow', reason: 'test allow' }),
    spawn,
    maxOutputBytes: 64,
    timeoutMs: 5_000,
    ...extra,
  });
}

function finish(proc: ReturnType<typeof createMockProcess>, code: number, stdout = '', stderr = ''): void {
  if (stdout) proc.stdout?.emit('data', Buffer.from(stdout));
  if (stderr) proc.stderr?.emit('data', Buffer.from(stderr));
  proc.emit('close', code);
}

async function waitForSpawn(
  calls: Array<{ proc: ReturnType<typeof createMockProcess> }>,
): Promise<ReturnType<typeof createMockProcess>> {
  await vi.waitFor(() => {
    expect(calls.length).toBeGreaterThan(0);
  });
  return calls[0]!.proc;
}

describe('SSH host catalog', () => {
  it('rejects passwords and key bodies in host configuration', () => {
    expect(() => parseSshHostDefinition('darkstar', {
      host: 'darkstar.example',
      password: 'hunter2',
    })).toThrow(/secret field/i);

    expect(() => parseSshHostDefinition('darkstar', {
      host: 'darkstar.example',
      identityFile: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n',
    })).toThrow(/identityFile/i);
  });

  it('rejects StrictHostKeyChecking=no', () => {
    expect(() => parseSshHostDefinition('darkstar', {
      host: 'darkstar.example',
      strictHostKeyChecking: 'no',
    })).toThrow(/StrictHostKeyChecking/i);
  });

  it('drops a host that carries a secret and keeps the rest of the catalog', () => {
    const catalog = parseSshHostCatalog({
      hosts: {
        bad: { host: 'evil.example', password: 'x' },
        darkstar: { host: 'darkstar.example', user: 'buddy' },
      },
    });
    expect(catalog.hosts.bad).toBeUndefined();
    expect(catalog.hosts.darkstar?.host).toBe('darkstar.example');
  });
});

describe('SSH argv and remote scripts', () => {
  it('forces BatchMode and never disables host-key checking', () => {
    const args = buildSshClientArgs(darkstar);
    expect(args).toContain('BatchMode=yes');
    expect(args).toContain('PasswordAuthentication=no');
    expect(args).toContain('StrictHostKeyChecking=yes');
    expect(args.join(' ')).not.toMatch(/StrictHostKeyChecking=no/);
    expect(args.join(' ')).not.toMatch(/PasswordAuthentication=yes/);
    expect(args.join(' ')).not.toMatch(/(?:^|\s)-o\s+Password=/);
    expect(args[args.indexOf('--') + 1]).toBe(darkstar.host);
  });

  it('builds the exact OpenSSH argument list with -- before host and remote command after host', () => {
    const args = buildSshClientArgs(darkstar);
    expect(args).toEqual([
      '-T',
      '-o', 'BatchMode=yes',
      '-o', 'PasswordAuthentication=no',
      '-o', 'KbdInteractiveAuthentication=no',
      '-o', 'PreferredAuthentications=publickey',
      '-o', 'NumberOfPasswordPrompts=0',
      '-o', 'StrictHostKeyChecking=yes',
      '-o', 'ConnectTimeout=10',
      '-o', 'RequestTTY=no',
      '-p', '22',
      '-l', 'buddy',
      '--',
      'darkstar.example',
      'bash',
      '-s',
    ]);
    const hostIndex = args.indexOf(darkstar.host);
    expect(hostIndex).toBeGreaterThan(0);
    expect(args[hostIndex - 1]).toBe('--');
    expect(args.slice(hostIndex + 1)).toEqual(['bash', '-s']);
  });

  it('wraps the remote command with timeout and a pid file', () => {
    const script = buildRemoteRunScript({
      jobId: 'abc123',
      command: "echo hi",
      workDir: '/tmp/cb-ssh',
      timeoutSec: 5,
    });
    expect(script).toContain('/tmp/cbssh-abc123.pid');
    expect(script).toContain('timeout --foreground --signal=TERM --kill-after=2');
    expect(script).toContain("cd '/tmp/cb-ssh'");
    expect(buildRemoteKillScript('abc123')).toContain('kill -TERM');
  });
});

describe('SshSandbox', () => {
  afterEach(() => {
    resetExecPolicy();
    resetSandboxRegistry();
  });

  it('refuses an undeclared host without spawning ssh', async () => {
    const { spawn, calls } = createLauncher();
    const sandbox = createSandbox(spawn);
    const result = await sandbox.execute('echo hi', { host: 'missing' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not declared/);
    expect(calls).toHaveLength(0);
  });

  it('classifies a connection failure instead of a generic command error', async () => {
    const { spawn, calls } = createLauncher();
    const sandbox = createSandbox(spawn);
    const promise = sandbox.execute('echo hi');
    finish(await waitForSpawn(calls), 255, '', 'Permission denied (publickey).');
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/SSH connection failed/i);
    expect(result.error).toMatch(/Permission denied/i);
    expect(result.exitCode).toBe(255);
  });

  it('times out, kills the local ssh process, and issues a remote kill', async () => {
    const { spawn, calls } = createLauncher();
    const sandbox = createSandbox(spawn, { timeoutMs: 80 });
    const promise = sandbox.execute('sleep 30');
    const session = await waitForSpawn(calls);
    session.kill = vi.fn(() => {
      setImmediate(() => session.emit('close', 124));
      return true;
    });

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out after 80ms/);
    expect(session.kill).toHaveBeenCalled();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const killStdin = calls[1]!.proc.stdin as { write: ReturnType<typeof vi.fn> };
    expect(String(killStdin.write.mock.calls[0]?.[0] ?? '')).toMatch(/kill -TERM/);
  });

  it('aborts and kills the remote process group', async () => {
    const { spawn, calls } = createLauncher();
    const sandbox = createSandbox(spawn);
    const controller = new AbortController();
    const promise = sandbox.execute('sleep 30', { signal: controller.signal });
    const session = await waitForSpawn(calls);
    session.kill = vi.fn(() => {
      setImmediate(() => session.emit('close', 130));
      return true;
    });
    controller.abort();
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/aborted/i);
    expect(result.exitCode).toBe(130);
    expect(session.kill).toHaveBeenCalled();
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('truncates oversized stdout with an explicit marker', async () => {
    const { spawn, calls } = createLauncher();
    const sandbox = createSandbox(spawn, { maxOutputBytes: 32 });
    const promise = sandbox.execute('yes');
    const session = await waitForSpawn(calls);
    session.stdout?.emit('data', Buffer.from('A'.repeat(200)));
    session.emit('close', 0);
    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.output).toMatch(/truncated: stdout exceeded 32 bytes/);
    expect(Buffer.byteLength(result.output, 'utf8')).toBeGreaterThan(32);
  });

  it('returns a faithful non-zero exit code and keeps stderr separate', async () => {
    const { spawn, calls } = createLauncher();
    const sandbox = createSandbox(spawn);
    const promise = sandbox.execute('false');
    finish(await waitForSpawn(calls), 7, 'out\n', 'boom\n');
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(7);
    expect(result.output).toBe('out\n');
    expect(result.error).toBe('boom\n');
  });

  it('refuses a command denied by execpolicy before spawning', async () => {
    const { spawn, calls } = createLauncher();
    const policy = new ExecPolicy({ defaultAction: 'sandbox', detectDangerous: true });
    await policy.initialize();
    const sandbox = new SshSandbox({
      hosts: { darkstar },
      defaultHost: 'darkstar',
      hasSshClient: () => true,
      spawn,
      evaluatePolicy: (command, workDir) => {
        const evaluation = policy.evaluateShellCommand(command, workDir);
        return { action: evaluation.action, reason: evaluation.reason };
      },
    });
    const result = await sandbox.execute('rm -rf /');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/execution policy/i);
    expect(calls).toHaveLength(0);
  });

  it('refuses execpolicy ask actions on a remote host', async () => {
    const { spawn, calls } = createLauncher();
    const policy = new ExecPolicy({ defaultAction: 'sandbox', detectDangerous: true });
    await policy.initialize();
    const sandbox = new SshSandbox({
      hosts: { darkstar },
      defaultHost: 'darkstar',
      hasSshClient: () => true,
      spawn,
      evaluatePolicy: (command, workDir) => {
        const evaluation = policy.evaluateShellCommand(command, workDir);
        return { action: evaluation.action, reason: evaluation.reason };
      },
    });
    const result = await sandbox.execute('npm install left-pad');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/execution policy/i);
    expect(calls).toHaveLength(0);
  });

  it('is never chosen as the default active backend', async () => {
    resetSandboxRegistry();
    ensureSshSandboxRegistered({
      hosts: { darkstar },
      hasSshClient: () => true,
    });
    registerSandboxBackend(
      {
        name: 'docker',
        isAvailable: async () => true,
        execute: async () => ({ success: true, output: 'd', exitCode: 0, durationMs: 1 }),
        kill: async () => true,
        cleanup: async () => {},
      },
      10,
    );
    const active = await getActiveSandboxBackend();
    expect(active?.name).toBe('docker');
  });

  it('resolveExplicitSshSandboxRequest is opt-in via CODEBUDDY_SANDBOX_BACKEND', () => {
    expect(resolveExplicitSshSandboxRequest({})).toBeNull();
    expect(resolveExplicitSshSandboxRequest({
      CODEBUDDY_SANDBOX_BACKEND: 'ssh',
      CODEBUDDY_SSH_HOST: 'darkstar',
      CODEBUDDY_SSH_HOSTS: JSON.stringify({ darkstar: { host: 'darkstar.example' } }),
    })?.host).toBe('darkstar');
  });

  it('passes a declared identity file as -i and never a passphrase flag', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cb-ssh-id-'));
    const keyPath = join(dir, 'id_test');
    writeFileSync(keyPath, 'not-a-real-key\n');
    const { spawn, calls } = createLauncher();
    const sandbox = new SshSandbox({
      hosts: { darkstar: { ...darkstar, identityFile: keyPath } },
      defaultHost: 'darkstar',
      hasSshClient: () => true,
      evaluatePolicy: () => ({ action: 'allow', reason: 'test' }),
      spawn,
    });
    const promise = sandbox.execute('echo hi');
    finish(await waitForSpawn(calls), 0, 'hi\n');
    await promise;
    const args = calls[0]!.args.join(' ');
    expect(args).toContain(`-i ${keyPath}`);
    expect(args).not.toMatch(/IdentitiesOnly=no/);
    expect(args.toLowerCase()).not.toContain('passphrase');
  });
});

describe('classifySshConnectionFailure', () => {
  it('detects typical ssh 255 banners', () => {
    expect(classifySshConnectionFailure(255, 'Host key verification failed.')).toMatch(/connection failed/i);
    expect(classifySshConnectionFailure(2, 'command not found')).toBeNull();
  });
});
