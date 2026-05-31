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
  const version = spawnSync('docker', ['--version'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
    windowsHide: true,
  });
  if (version.error || version.status !== 0) return false;

  const info = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
    windowsHide: true,
  });
  return !info.error && info.status === 0;
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

  it.skipIf(!hasRunnableDocker())('blocks Docker smoke unless the operator opts in', () => {
    const envWithoutDockerOptIn = { ...process.env };
    delete envWithoutDockerOptIn.CODEBUDDY_HERMES_ALLOW_DOCKER_SMOKE;
    const result = runHermesRuntimeBackendSmoke({
      backendId: 'docker',
      env: envWithoutDockerOptIn,
      now: () => new Date('2026-05-31T22:45:00.000Z'),
    });

    expect(result).toMatchObject({
      backendId: 'docker',
      command: 'docker',
      exitCode: null,
      ok: false,
      status: 'blocked',
    });
    expect(result.output).toContain('CODEBUDDY_HERMES_ALLOW_DOCKER_SMOKE=true');
    expect(result.args).toEqual([]);
  });

  it.skipIf(process.env.CODEBUDDY_HERMES_ALLOW_DOCKER_SMOKE !== 'true' || !hasRunnableDocker())(
    'runs the Docker backend smoke through a real no-network container when explicitly enabled',
    () => {
      const result = runHermesRuntimeBackendSmoke({
        backendId: 'docker',
        env: process.env,
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
});
