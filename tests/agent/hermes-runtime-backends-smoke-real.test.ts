import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  buildHermesRuntimeBackendsReadiness,
  renderHermesRuntimeBackendsReadiness,
  runHermesRuntimeBackendSmoke,
  type HermesRuntimeBackendsReadiness,
} from '../../src/agent/hermes-runtime-backends.js';

const nodeDisplayCommand = path.basename(process.execPath);

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

function prependPath(env: NodeJS.ProcessEnv, directory: string): NodeJS.ProcessEnv {
  return {
    ...env,
    PATH: `${directory}${path.delimiter}${env.PATH ?? ''}`,
    Path: `${directory}${path.delimiter}${env.Path ?? env.PATH ?? ''}`,
  };
}

function writeFakeCli(directory: string, name: string, script: string): string {
  const filePath = process.platform === 'win32'
    ? path.join(directory, `${name}.cmd`)
    : path.join(directory, name);
  fs.writeFileSync(filePath, script);
  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o755);
  }
  return filePath;
}

describe('Hermes runtime backend live smoke runner', () => {
  it('renders non-runnable backend probes without calling them smoke commands', () => {
    const readiness: HermesRuntimeBackendsReadiness = {
      ok: true,
      generatedAt: '2026-06-01T02:55:00.000Z',
      platform: process.platform,
      arch: process.arch,
      availableCount: 2,
      configuredRemoteCount: 0,
      runnableCount: 1,
      routePlan: {
        mode: 'hybrid',
        primaryBackendId: 'local',
        fallbackBackendIds: [],
        reason: 'local backend is safe by default',
        smokeCommand: 'buddy hermes runtime-smoke auto --json',
      },
      backends: [
        {
          id: 'local',
          label: 'Local process',
          officialSurface: 'Local',
          status: 'available',
          installed: true,
          configured: true,
          runnable: true,
          command: process.execPath,
          version: 'v-test',
          credentialSources: [],
          smokeCommand: 'node -e "console.log(1)"',
          notes: [],
          remediation: [],
        },
        {
          id: 'ssh',
          label: 'SSH remote shell',
          officialSurface: 'SSH',
          status: 'available',
          installed: true,
          configured: false,
          runnable: false,
          command: 'ssh',
          version: 'OpenSSH_test',
          credentialSources: [],
          smokeCommand: 'ssh -V',
          notes: [],
          remediation: [],
        },
        {
          id: 'modal',
          label: 'Modal Sandbox',
          officialSurface: 'Modal',
          status: 'missing',
          installed: false,
          configured: false,
          runnable: false,
          command: 'modal',
          version: null,
          credentialSources: [],
          smokeCommand: 'modal --version',
          notes: [],
          remediation: [],
        },
      ],
      issues: [],
      recommendations: [],
    };

    const output = renderHermesRuntimeBackendsReadiness(readiness);

    expect(output).toContain(
      '- local: available (v-test) | configured=yes, runnable=yes | smoke: node -e "console.log(1)"',
    );
    expect(output).toContain('- ssh: available (OpenSSH_test) | configured=no, runnable=no | probe: ssh -V');
    expect(output).not.toContain('- ssh: available (OpenSSH_test) | smoke: ssh -V');
    expect(output).toContain('- modal: missing | configured=no, runnable=no');
    expect(output).not.toContain('probe: modal --version');
  });

  it('reports a safe local-first auto route without selecting gated runtimes', () => {
    const readiness = buildHermesRuntimeBackendsReadiness({
      env: process.env,
      now: () => new Date('2026-06-01T01:55:00.000Z'),
    });

    expect(readiness.routePlan).toMatchObject({
      mode: 'hybrid',
      primaryBackendId: 'local',
      smokeCommand: 'buddy hermes runtime-smoke auto --json',
    });
    expect(readiness.routePlan.fallbackBackendIds).not.toContain('docker');
    expect(readiness.routePlan.fallbackBackendIds).not.toContain('ssh');
    expect(readiness.routePlan.fallbackBackendIds).not.toContain('modal');
    expect(readiness.routePlan.fallbackBackendIds).not.toContain('daytona');
    expect(readiness.routePlan.fallbackBackendIds).not.toContain('vercel-sandbox');
    expect(readiness.backends.find((backend) => backend.id === 'local')?.command).toBe(nodeDisplayCommand);
    expect(JSON.stringify(readiness)).not.toContain(process.execPath);
  });

  it('explains runnable Docker is gated out of auto routing until explicit opt-in', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-docker-route-gated-'));
    try {
      writeFakeCli(
        tempDir,
        'docker',
        process.platform === 'win32'
          ? '@echo off\r\nif "%1"=="--version" echo Docker version 99.0.0\r\nif "%1"=="info" echo 99.0.0\r\n'
          : '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "Docker version 99.0.0"; fi\nif [ "$1" = "info" ]; then echo "99.0.0"; fi\n',
      );
      const env = prependPath({ ...process.env }, tempDir);
      const readiness = buildHermesRuntimeBackendsReadiness({
        env,
        now: () => new Date('2026-06-01T02:05:00.000Z'),
      });

      expect(readiness.backends.find((backend) => backend.id === 'docker')).toMatchObject({
        runnable: true,
        status: 'available',
      });
      expect(readiness.routePlan.autoEligibleBackendIds).toContain('local');
      expect(readiness.routePlan.fallbackBackendIds).not.toContain('docker');
      expect(readiness.routePlan.gatedBackendIds).toContain('docker');
      expect(readiness.routePlan.gatedBackends).toEqual(expect.arrayContaining([
        expect.objectContaining({
          backendId: 'docker',
          reason: expect.stringContaining('--allow-docker'),
          smokeCommand: expect.stringContaining('OK-HERMES-DOCKER'),
        }),
      ]));

      const rendered = renderHermesRuntimeBackendsReadiness(readiness);
      expect(rendered).toContain('Gated auto-route backends:');
      expect(rendered).toContain('- docker: Docker is runnable but excluded from auto routing');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

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

  it('runs auto runtime smoke through a real safe subprocess', () => {
    const result = runHermesRuntimeBackendSmoke({
      backendId: 'auto',
      env: process.env,
      now: () => new Date('2026-06-01T01:56:00.000Z'),
    });

    expect(result).toMatchObject({
      backendId: 'local',
      command: process.execPath,
      exitCode: 0,
      ok: true,
      status: 'passed',
    });
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

  it('blocks configured remote backend smoke unless the operator opts in', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-vercel-smoke-blocked-'));
    try {
      writeFakeCli(
        tempDir,
        'vercel',
        process.platform === 'win32'
          ? '@echo off\r\nif "%1"=="--version" echo Vercel CLI 99.0.0\r\nif "%1"=="whoami" echo smoke-user\r\n'
          : '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "Vercel CLI 99.0.0"; fi\nif [ "$1" = "whoami" ]; then echo "smoke-user"; fi\n',
      );
      const env = prependPath({ ...process.env, VERCEL_TOKEN: 'redacted-token' }, tempDir);
      delete env.CODEBUDDY_HERMES_ALLOW_REMOTE_SMOKE;

      const result = runHermesRuntimeBackendSmoke({
        backendId: 'vercel-sandbox',
        env,
        now: () => new Date('2026-05-31T23:20:00.000Z'),
      });

      expect(result).toMatchObject({
        backendId: 'vercel-sandbox',
        command: 'vercel',
        exitCode: null,
        ok: false,
        status: 'blocked',
      });
      expect(result.output).toContain('--allow-remote');
      expect(result.args).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('runs configured remote backend smoke through a real CLI process when explicitly enabled', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-vercel-smoke-run-'));
    try {
      writeFakeCli(
        tempDir,
        'vercel',
        process.platform === 'win32'
          ? '@echo off\r\nif "%1"=="--version" echo Vercel CLI 99.0.0\r\nif "%1"=="whoami" echo smoke-user\r\n'
          : '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "Vercel CLI 99.0.0"; fi\nif [ "$1" = "whoami" ]; then echo "smoke-user"; fi\n',
      );
      const env = prependPath({ ...process.env, VERCEL_TOKEN: 'redacted-token' }, tempDir);

      const result = runHermesRuntimeBackendSmoke({
        allowRemoteSmoke: true,
        backendId: 'vercel-sandbox',
        env,
      });

      expect(result).toMatchObject({
        args: ['whoami'],
        backendId: 'vercel-sandbox',
        command: 'vercel',
        exitCode: 0,
        ok: true,
        status: 'passed',
      });
      expect(result.stdout).toContain('smoke-user');
      expect(result.output).toContain('smoke-user');
      expect(result.output).not.toContain('redacted-token');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
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
