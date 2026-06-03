import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  buildHermesRuntimeBackendsReadiness,
  buildHermesRuntimeLifecyclePlan,
  runHermesRuntimeBackendSmoke,
  runHermesRuntimeLifecycleAction,
} from '../../src/agent/hermes-runtime-backends.js';

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

function writeDaytonaLifecycleFixture(dir: string): void {
  if (process.platform === 'win32') {
    fs.writeFileSync(
      path.join(dir, 'daytona.cmd'),
      [
        '@echo off',
        'if "%1"=="--version" (',
        '  echo daytona 1.0.0',
        '  exit /b 0',
        ')',
        'if "%1"=="list" (',
        '  echo [{"id":"sandbox-demo","state":"started","token":"secret-daytona-key"}]',
        '  exit /b 0',
        ')',
        'echo daytona lifecycle %* secret-daytona-key',
        'exit /b 0',
        '',
      ].join('\r\n'),
    );
    return;
  }

  const filePath = path.join(dir, 'daytona');
  fs.writeFileSync(
    filePath,
    [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      "  echo 'daytona 1.0.0'",
      '  exit 0',
      'fi',
      'if [ "$1" = "list" ]; then',
      "  echo '[{\"id\":\"sandbox-demo\",\"state\":\"started\",\"token\":\"secret-daytona-key\"}]'",
      '  exit 0',
      'fi',
      "echo \"daytona lifecycle $* secret-daytona-key\"",
      'exit 0',
      '',
    ].join('\n'),
  );
  fs.chmodSync(filePath, 0o755);
}

function withDaytonaLifecycleFixture(run: (env: NodeJS.ProcessEnv) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hermes-runtime-lifecycle-'));
  try {
    writeDaytonaLifecycleFixture(dir);
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

function writeVercelLifecycleFixture(dir: string): void {
  if (process.platform === 'win32') {
    fs.writeFileSync(
      path.join(dir, 'vercel.cmd'),
      [
        '@echo off',
        'if "%1"=="--version" (',
        '  echo Vercel CLI 1.0.0',
        '  exit /b 0',
        ')',
        'echo vercel fixture',
        'exit /b 0',
        '',
      ].join('\r\n'),
    );
    fs.writeFileSync(
      path.join(dir, 'sandbox.cmd'),
      [
        '@echo off',
        'if "%1"=="list" (',
        '  echo [{"id":"sb_abc123xyz","state":"running","token":"secret-vercel-token"}]',
        '  exit /b 0',
        ')',
        'echo sandbox lifecycle %* secret-vercel-token',
        'exit /b 0',
        '',
      ].join('\r\n'),
    );
    return;
  }

  const vercelPath = path.join(dir, 'vercel');
  fs.writeFileSync(
    vercelPath,
    [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      "  echo 'Vercel CLI 1.0.0'",
      '  exit 0',
      'fi',
      "echo 'vercel fixture'",
      'exit 0',
      '',
    ].join('\n'),
  );
  fs.chmodSync(vercelPath, 0o755);

  const sandboxPath = path.join(dir, 'sandbox');
  fs.writeFileSync(
    sandboxPath,
    [
      '#!/bin/sh',
      'if [ "$1" = "list" ]; then',
      "  echo '[{\"id\":\"sb_abc123xyz\",\"state\":\"running\",\"token\":\"secret-vercel-token\"}]'",
      '  exit 0',
      'fi',
      "echo \"sandbox lifecycle $* secret-vercel-token\"",
      'exit 0',
      '',
    ].join('\n'),
  );
  fs.chmodSync(sandboxPath, 0o755);
}

function withVercelLifecycleFixture(run: (env: NodeJS.ProcessEnv) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hermes-vercel-lifecycle-'));
  try {
    writeVercelLifecycleFixture(dir);
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
  it('keeps setup remediation only on unconfigured managed runtime backends', () => {
    withFixturePath(
      { command: 'modal', output: 'modal-profile secret-modal-profile', version: 'modal 1.0.0' },
      (env) => {
        const unconfigured = buildHermesRuntimeBackendsReadiness({ env });
        const unconfiguredModal = unconfigured.backends.find((backend) => backend.id === 'modal');
        expect(unconfiguredModal).toMatchObject({
          configured: false,
          remediation: ['Configure Modal credentials before selecting Modal jobs.'],
          status: 'available',
        });

        const configured = buildHermesRuntimeBackendsReadiness({
          env: {
            ...env,
            MODAL_PROFILE: 'secret-modal-profile',
          },
        });
        const configuredModal = configured.backends.find((backend) => backend.id === 'modal');
        expect(configuredModal).toMatchObject({
          configured: true,
          remediation: [],
          status: 'configured',
        });
        expect(JSON.stringify(configured)).not.toContain('secret-modal-profile');
      },
    );

    const managedCases = [
      {
        command: 'daytona',
        config: { DAYTONA_API_KEY: 'secret-daytona-key' },
        id: 'daytona',
        version: 'daytona 1.0.0',
      },
      {
        command: 'vercel',
        config: { VERCEL_TOKEN: 'secret-vercel-token' },
        id: 'vercel-sandbox',
        version: 'Vercel CLI 1.0.0',
      },
    ] as const;

    for (const item of managedCases) {
      withFixturePath(
        { command: item.command, output: `${item.command} fixture`, version: item.version },
        (env) => {
          const readiness = buildHermesRuntimeBackendsReadiness({
            env: {
              ...env,
              ...item.config,
            },
          });
          const backend = readiness.backends.find((candidate) => candidate.id === item.id);
          const raw = JSON.stringify(readiness);

          expect(backend).toMatchObject({
            configured: true,
            remediation: [],
            status: 'configured',
          });
          expect(raw).not.toContain('secret-');
        },
      );
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

  it('plans Daytona managed lifecycle commands without leaking credentials', () => {
    withFixturePath(
      { command: 'daytona', output: 'daytona 1.0.0', version: 'daytona 1.0.0' },
      (env) => {
        const result = buildHermesRuntimeLifecyclePlan({
          action: 'attach',
          backendId: 'daytona',
          env: {
            ...env,
            DAYTONA_API_KEY: 'secret-daytona-key',
          },
          now: () => new Date('2026-06-03T13:20:00.000Z'),
          target: 'sandbox-demo',
        });
        const raw = JSON.stringify(result);

        expect(result).toMatchObject({
          action: 'attach',
          args: ['ssh', 'sandbox-demo'],
          backendId: 'daytona',
          command: 'daytona',
          displayCommand: 'daytona ssh sandbox-demo',
          ok: true,
          requiresApproval: true,
          status: 'planned',
          target: 'sandbox-demo',
        });
        expect(result.docs).toContain('https://www.daytona.io/docs/tools/cli/');
        expect(result.notes.join(' ')).toContain('installed/configured');
        expect(raw).not.toContain('secret-daytona-key');
      },
    );
  });

  it('blocks target-specific lifecycle commands until a target is provided', () => {
    const result = buildHermesRuntimeLifecyclePlan({
      action: 'teardown',
      backendId: 'daytona',
      env: process.env,
      now: () => new Date('2026-06-03T13:21:00.000Z'),
    });

    expect(result).toMatchObject({
      action: 'teardown',
      backendId: 'daytona',
      command: null,
      ok: false,
      status: 'blocked',
    });
    expect(result.notes.join(' ')).toContain('requires --target');
  });

  it('plans Vercel Sandbox attach through the documented interactive exec path', () => {
    const result = buildHermesRuntimeLifecyclePlan({
      action: 'attach',
      backendId: 'vercel-sandbox',
      env: process.env,
      now: () => new Date('2026-06-03T13:21:30.000Z'),
      target: 'sb_abc123xyz',
    });

    expect(result).toMatchObject({
      action: 'attach',
      args: ['exec', '--interactive', '--tty', 'sb_abc123xyz', 'bash'],
      backendId: 'vercel-sandbox',
      command: 'sandbox',
      displayCommand: 'sandbox exec --interactive --tty sb_abc123xyz bash',
      ok: true,
      status: 'planned',
      target: 'sb_abc123xyz',
    });
    expect(result.docs).toContain('https://vercel.com/docs/vercel-sandbox/cli-reference');
  });

  it('keeps lifecycle execution blocked unless global and provider allow flags are present', () => {
    withDaytonaLifecycleFixture((env) => {
      const result = runHermesRuntimeLifecycleAction({
        action: 'hibernate',
        backendId: 'daytona',
        env: {
          ...env,
          DAYTONA_API_KEY: 'secret-daytona-key',
        },
        now: () => new Date('2026-06-03T13:22:00.000Z'),
        target: 'sandbox-demo',
      });

      expect(result).toMatchObject({
        command: null,
        exitCode: null,
        ok: false,
        status: 'blocked',
      });
      expect(result.output).toContain('CODEBUDDY_HERMES_ALLOW_LIFECYCLE_EXEC=true');
    });
  });

  it('executes a guarded Daytona lifecycle command and captures redacted state snapshots', () => {
    withDaytonaLifecycleFixture((env) => {
      const result = runHermesRuntimeLifecycleAction({
        action: 'hibernate',
        backendId: 'daytona',
        env: {
          ...env,
          CODEBUDDY_HERMES_ALLOW_DAYTONA_LIFECYCLE: 'true',
          CODEBUDDY_HERMES_ALLOW_LIFECYCLE_EXEC: 'true',
          DAYTONA_API_KEY: 'secret-daytona-key',
        },
        now: () => new Date('2026-06-03T13:23:00.000Z'),
        target: 'sandbox-demo',
      });
      const raw = JSON.stringify(result);

      expect(result).toMatchObject({
        args: ['stop', 'sandbox-demo'],
        command: 'daytona',
        exitCode: 0,
        ok: true,
        status: 'passed',
      });
      expect(result.output).toContain('daytona lifecycle stop sandbox-demo');
      expect(result.stateBefore).toMatchObject({
        args: ['list', '--format', 'json'],
        command: 'daytona',
        ok: true,
        targetSeen: true,
      });
      expect(result.stateAfter).toMatchObject({
        args: ['list', '--format', 'json'],
        command: 'daytona',
        ok: true,
        targetSeen: true,
      });
      expect(raw).not.toContain('secret-daytona-key');
      expect(raw).toContain('<configured-secret>');
    });
  });

  it('keeps interactive lifecycle actions blocked behind a separate opt-in flag', () => {
    withDaytonaLifecycleFixture((env) => {
      const result = runHermesRuntimeLifecycleAction({
        action: 'attach',
        backendId: 'daytona',
        env: {
          ...env,
          CODEBUDDY_HERMES_ALLOW_DAYTONA_LIFECYCLE: 'true',
          CODEBUDDY_HERMES_ALLOW_LIFECYCLE_EXEC: 'true',
          DAYTONA_API_KEY: 'secret-daytona-key',
        },
        now: () => new Date('2026-06-03T13:24:00.000Z'),
        target: 'sandbox-demo',
      });

      expect(result).toMatchObject({
        command: null,
        exitCode: null,
        ok: false,
        status: 'blocked',
      });
      expect(result.output).toContain('CODEBUDDY_HERMES_ALLOW_INTERACTIVE_LIFECYCLE=true');
    });
  });

  it('executes a guarded Vercel Sandbox lifecycle command and captures redacted state snapshots', () => {
    withVercelLifecycleFixture((env) => {
      const result = runHermesRuntimeLifecycleAction({
        action: 'hibernate',
        backendId: 'vercel-sandbox',
        env: {
          ...env,
          CODEBUDDY_HERMES_ALLOW_LIFECYCLE_EXEC: 'true',
          CODEBUDDY_HERMES_ALLOW_VERCEL_LIFECYCLE: 'true',
          VERCEL_TOKEN: 'secret-vercel-token',
        },
        now: () => new Date('2026-06-03T13:25:00.000Z'),
        target: 'sb_abc123xyz',
      });
      const raw = JSON.stringify(result);

      expect(result).toMatchObject({
        args: ['stop', 'sb_abc123xyz'],
        command: 'sandbox',
        exitCode: 0,
        ok: true,
        status: 'passed',
      });
      expect(result.output).toContain('sandbox lifecycle stop sb_abc123xyz');
      expect(result.stateBefore).toMatchObject({
        args: ['list', '--all'],
        command: 'sandbox',
        ok: true,
        targetSeen: true,
      });
      expect(result.stateAfter).toMatchObject({
        args: ['list', '--all'],
        command: 'sandbox',
        ok: true,
        targetSeen: true,
      });
      expect(raw).not.toContain('secret-vercel-token');
      expect(raw).toContain('<configured-secret>');
    });
  });
});
