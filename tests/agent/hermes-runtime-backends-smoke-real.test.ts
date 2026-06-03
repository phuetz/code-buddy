import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

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

interface CliFixtureOptions {
  command: string;
  output: string;
  version: string;
}

function writeCliFixture(dir: string, options: CliFixtureOptions): void {
  if (process.platform === 'win32') {
    fs.writeFileSync(
      path.join(dir, `${options.command}.cmd`),
      [
        '@echo off',
        'if "%1"=="--version" (',
        `  echo ${options.version}`,
        '  exit /b 0',
        ')',
        `echo ${options.output}`,
        'exit /b 0',
        '',
      ].join('\r\n'),
    );
    return;
  }

  const filePath = path.join(dir, options.command);
  fs.writeFileSync(
    filePath,
    [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      `  echo '${options.version}'`,
      '  exit 0',
      'fi',
      `echo '${options.output}'`,
      'exit 0',
      '',
    ].join('\n'),
  );
  fs.chmodSync(filePath, 0o755);
}

function withFixturePath(
  command: CliFixtureOptions,
  run: (env: NodeJS.ProcessEnv) => void,
): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hermes-runtime-cli-'));
  try {
    writeCliFixture(dir, command);
    const fixturePath = `${dir}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ''}`;
    run({
      ...process.env,
      PATH: fixturePath,
      Path: fixturePath,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

  it('keeps managed remote backend smokes blocked unless explicitly allowed', () => {
    withFixturePath(
      { command: 'modal', output: 'modal-profile secret-modal-profile', version: 'modal 1.0.0' },
      (env) => {
        const result = runHermesRuntimeBackendSmoke({
          backendId: 'modal',
          env: {
            ...env,
            MODAL_PROFILE: 'secret-modal-profile',
          },
          now: () => new Date('2026-05-31T10:18:00.000Z'),
        });

        expect(result).toMatchObject({
          backendId: 'modal',
          command: 'modal',
          exitCode: null,
          ok: false,
          status: 'blocked',
        });
        expect(result.output).toContain('CODEBUDDY_HERMES_ALLOW_MODAL_SMOKE=true');
      },
    );
  });

  it('redacts managed remote smoke command output', () => {
    const cases = [
      {
        allowKey: 'CODEBUDDY_HERMES_ALLOW_MODAL_SMOKE',
        backendId: 'modal',
        command: 'modal',
        config: { MODAL_PROFILE: 'secret-modal-profile' },
        expectedArgs: ['profile', 'current'],
        output: 'modal-profile secret-modal-profile',
        placeholder: '<modal-smoke-output-redacted>',
        secret: 'secret-modal-profile',
        version: 'modal 1.0.0',
      },
      {
        allowKey: 'CODEBUDDY_HERMES_ALLOW_DAYTONA_SMOKE',
        backendId: 'daytona',
        command: 'daytona',
        config: { DAYTONA_API_KEY: 'secret-daytona-key', DAYTONA_PROFILE: 'secret-daytona-profile' },
        expectedArgs: ['profile', 'list'],
        output: 'daytona-profile secret-daytona-key secret-daytona-profile',
        placeholder: '<daytona-smoke-output-redacted>',
        secret: 'secret-daytona-key',
        version: 'daytona 1.0.0',
      },
      {
        allowKey: 'CODEBUDDY_HERMES_ALLOW_VERCEL_SMOKE',
        backendId: 'vercel-sandbox',
        command: 'vercel',
        config: { VERCEL_TOKEN: 'secret-vercel-token' },
        expectedArgs: ['whoami'],
        output: 'vercel-user secret-vercel-token',
        placeholder: '<vercel-smoke-output-redacted>',
        secret: 'secret-vercel-token',
        version: 'Vercel CLI 1.0.0',
      },
    ] as const;

    for (const item of cases) {
      withFixturePath(
        { command: item.command, output: item.output, version: item.version },
        (env) => {
          const result = runHermesRuntimeBackendSmoke({
            backendId: item.backendId,
            env: {
              ...env,
              ...item.config,
              [item.allowKey]: 'true',
            },
            now: () => new Date('2026-05-31T10:19:00.000Z'),
          });
          const raw = JSON.stringify(result);

          expect(result).toMatchObject({
            backendId: item.backendId,
            command: item.command,
            exitCode: 0,
            ok: true,
            status: 'passed',
          });
          expect(result.args).toEqual(item.expectedArgs);
          expect(result.stdout).toBe(item.placeholder);
          expect(result.output).toBe(item.placeholder);
          expect(raw).not.toContain(item.secret);
        },
      );
    }
  });
});
