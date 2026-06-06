import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import type { SandboxResult } from '../../src/sandbox/docker-sandbox.js';
import {
  PYTHON_SANDBOX_ENV,
  PYTHON_SANDBOX_IMAGE,
  isPythonSandboxEnabled,
  runPythonInDockerSandbox,
  type SandboxLike,
} from '../../src/sandbox/python-sandbox.js';

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [PYTHON_SANDBOX_ENV, 'AUTO_SANDBOX'] as const;

describe('python docker sandbox (S8)', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('gates on CODEBUDDY_PYTHON_SANDBOX or AUTO_SANDBOX', () => {
    expect(isPythonSandboxEnabled()).toBe(false);
    process.env.CODEBUDDY_PYTHON_SANDBOX = 'true';
    expect(isPythonSandboxEnabled()).toBe(true);
    delete process.env.CODEBUDDY_PYTHON_SANDBOX;
    process.env.AUTO_SANDBOX = '1';
    expect(isPythonSandboxEnabled()).toBe(true);
  });

  it('runs python3 on a mounted script in an isolated container and maps the result', async () => {
    let captured: { command: string; opts?: Record<string, unknown> } | undefined;
    let scriptOnDisk = '';
    const fakeSandbox: SandboxLike = {
      async execute(command, opts): Promise<SandboxResult> {
        captured = { command, opts };
        // Prove the script was materialized into the mounted workspace.
        scriptOnDisk = await fs.readFile(path.join(opts!.workspaceMount as string, 'script.py'), 'utf8');
        return { success: true, output: 'hello\n', exitCode: 0, durationMs: 12 };
      },
    };

    const result = await runPythonInDockerSandbox("print('hello')", { sandbox: fakeSandbox });

    expect(captured?.command).toBe('python3 /workspace/script.py');
    expect(captured?.opts).toMatchObject({
      image: PYTHON_SANDBOX_IMAGE,
      networkEnabled: false,
    });
    expect(captured?.opts?.workspaceMount).toBeTruthy();
    expect(scriptOnDisk).toBe("print('hello')");
    expect(result).toMatchObject({ success: true, stdout: 'hello\n', exitCode: 0, image: PYTHON_SANDBOX_IMAGE });
  });

  it('cleans up the mounted temp workspace after the run', async () => {
    let workspaceDir = '';
    const fakeSandbox: SandboxLike = {
      async execute(_command, opts): Promise<SandboxResult> {
        workspaceDir = opts!.workspaceMount as string;
        return { success: true, output: '', exitCode: 0, durationMs: 1 };
      },
    };

    await runPythonInDockerSandbox('pass', { sandbox: fakeSandbox });
    expect(workspaceDir).toBeTruthy();
    await expect(fs.access(workspaceDir)).rejects.toThrow();
  });

  it('maps a non-zero exit and stderr', async () => {
    const fakeSandbox: SandboxLike = {
      async execute(): Promise<SandboxResult> {
        return { success: false, output: '', error: 'Traceback', exitCode: 1, durationMs: 5 };
      },
    };
    const result = await runPythonInDockerSandbox('raise SystemExit(1)', { sandbox: fakeSandbox });
    expect(result).toMatchObject({ success: false, stderr: 'Traceback', exitCode: 1 });
  });
});
