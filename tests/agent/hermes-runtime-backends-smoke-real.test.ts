import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';

import { runHermesRuntimeBackendSmoke } from '../../src/agent/hermes-runtime-backends.js';

function hasRunnableWsl(): boolean {
  if (process.platform !== 'win32') return false;
  const result = spawnSync('wsl', ['--status'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

function hasRunnableDocker(): boolean {
  const result = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

function hasSshClient(): boolean {
  const result = spawnSync('ssh', ['-V'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

describe('Hermes runtime backend live smoke runner', () => {
  it('runs the local backend smoke through a real Node subprocess', () => {
    const result = runHermesRuntimeBackendSmoke({
      backendId: 'local',
      env: process.env,
      now: () => new Date('2026-05-31T10:15:00.000Z'),
    });

    expect(result).toMatchObject({
      backendId: 'local',
      command: process.execPath,
      exitCode: 0,
      ok: true,
      status: 'passed',
    });
    expect(result.args).toContain('-e');
    expect(result.stdout).toContain('OK-HERMES-LOCAL');
    expect(result.output).toContain('OK-HERMES-LOCAL');
  });

  it.skipIf(!hasRunnableWsl())('runs the WSL backend smoke through a real WSL shell', () => {
    const result = runHermesRuntimeBackendSmoke({
      backendId: 'wsl',
      env: process.env,
    });

    expect(result).toMatchObject({
      backendId: 'wsl',
      command: 'wsl',
      exitCode: 0,
      ok: true,
      status: 'passed',
    });
    expect(result.args).toEqual(['--exec', 'sh', '-lc', 'echo OK-HERMES-WSL']);
    expect(result.stdout).toContain('OK-HERMES-WSL');
    expect(result.output).toContain('OK-HERMES-WSL');
  });

  it.skipIf(!hasRunnableDocker())('keeps the Docker backend smoke blocked unless explicitly allowed', () => {
    const env = { ...process.env };
    delete env.CODEBUDDY_HERMES_ALLOW_DOCKER_SMOKE;

    const result = runHermesRuntimeBackendSmoke({
      backendId: 'docker',
      env,
      now: () => new Date('2026-05-31T10:16:00.000Z'),
    });

    expect(result).toMatchObject({
      backendId: 'docker',
      command: 'docker',
      exitCode: null,
      ok: false,
      status: 'blocked',
    });
    expect(result.output).toContain('CODEBUDDY_HERMES_ALLOW_DOCKER_SMOKE=true');
  });

  it.skipIf(!hasRunnableDocker() || process.env.CODEBUDDY_REAL_DOCKER_SMOKE !== '1')(
    'runs the Docker backend smoke through a real network-disabled container',
    () => {
      const result = runHermesRuntimeBackendSmoke({
        backendId: 'docker',
        env: {
          ...process.env,
          CODEBUDDY_HERMES_ALLOW_DOCKER_SMOKE: 'true',
        },
        timeoutMs: 60_000,
      });

      expect(result).toMatchObject({
        backendId: 'docker',
        command: 'docker',
        exitCode: 0,
        ok: true,
        status: 'passed',
      });
      expect(result.args).toEqual([
        'run',
        '--rm',
        '--network',
        'none',
        'node:22-slim',
        'node',
        '-e',
        "console.log('OK-HERMES-DOCKER')",
      ]);
      expect(result.stdout).toContain('OK-HERMES-DOCKER');
      expect(result.output).toContain('OK-HERMES-DOCKER');
    },
  );

  it.skipIf(!hasSshClient())('keeps the SSH backend smoke blocked unless explicitly allowed', () => {
    const env = {
      ...process.env,
      CODEBUDDY_SSH_HOST: 'hermes-private.example.invalid',
    };
    delete env.CODEBUDDY_HERMES_ALLOW_SSH_SMOKE;

    const result = runHermesRuntimeBackendSmoke({
      backendId: 'ssh',
      env,
      now: () => new Date('2026-05-31T10:17:00.000Z'),
    });

    expect(result).toMatchObject({
      backendId: 'ssh',
      command: 'ssh',
      exitCode: null,
      ok: false,
      status: 'blocked',
    });
    expect(result.output).toContain('CODEBUDDY_HERMES_ALLOW_SSH_SMOKE=true');
  });

  it.skipIf(!hasSshClient())('redacts the configured SSH host from opt-in smoke results', () => {
    const host = 'hermes-private.example.invalid';
    const result = runHermesRuntimeBackendSmoke({
      backendId: 'ssh',
      env: {
        ...process.env,
        CODEBUDDY_HERMES_ALLOW_SSH_SMOKE: 'true',
        CODEBUDDY_SSH_HOST: host,
      },
      timeoutMs: 3000,
    });
    const raw = JSON.stringify(result);

    expect(result).toMatchObject({
      backendId: 'ssh',
      command: 'ssh',
      ok: false,
      status: 'failed',
    });
    expect(result.args).toEqual([
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '-T',
      '<configured-host>',
      'true',
    ]);
    expect(raw).not.toContain(host);
    expect(result.output).toContain('<configured-host>');
  });
});
