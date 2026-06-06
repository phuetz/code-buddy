/**
 * Python-in-Docker sandbox (S8).
 *
 * A skill materialized by the background review can carry a `scripts/<name>.py`
 * — a statically re-runnable action. The execute-code runner only spawns
 * `python3` LOCALLY, so there is no isolated path for those scripts. This helper
 * runs a Python script inside the local Docker sandbox (default
 * `python:3.12-slim`, no network), so generated Python actions execute isolated
 * on this machine — no subscription, no remote runtime.
 *
 * @module sandbox/python-sandbox
 */

import { mkdtemp, writeFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { DockerSandbox, type SandboxResult } from './docker-sandbox.js';

/** Opt-in to running generated Python in Docker. */
export const PYTHON_SANDBOX_ENV = 'CODEBUDDY_PYTHON_SANDBOX';
/** Default container image for Python scripts. */
export const PYTHON_SANDBOX_IMAGE = 'python:3.12-slim';

const TRUTHY = new Set(['1', 'true', 'on', 'yes', 'enabled']);

function truthy(name: string): boolean {
  return TRUTHY.has((process.env[name] ?? '').trim().toLowerCase());
}

/** Whether generated Python should run in the Docker sandbox. */
export function isPythonSandboxEnabled(): boolean {
  return truthy(PYTHON_SANDBOX_ENV) || truthy('AUTO_SANDBOX');
}

/** Minimal sandbox surface so tests can inject a fake (no real Docker). */
export interface SandboxLike {
  execute(
    command: string,
    opts?: {
      image?: string;
      workspaceMount?: string;
      networkEnabled?: boolean;
      timeout?: number;
    },
  ): Promise<SandboxResult>;
}

export interface RunPythonInSandboxOptions {
  image?: string;
  /** Allow network inside the container. Default false (isolated). */
  networkEnabled?: boolean;
  timeoutMs?: number;
  /** Injected sandbox. Defaults to a fresh DockerSandbox. */
  sandbox?: SandboxLike;
  /** Temp root for the mounted workspace. Defaults to os.tmpdir(). */
  tmpRoot?: string;
}

export interface RunPythonInSandboxResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  image: string;
}

/**
 * Run a Python script in the local Docker sandbox. The code is written to a
 * temp dir mounted as `/workspace`, then `python3 /workspace/script.py` runs in
 * the container. The temp dir is always cleaned up.
 */
export async function runPythonInDockerSandbox(
  code: string,
  options: RunPythonInSandboxOptions = {},
): Promise<RunPythonInSandboxResult> {
  const image = options.image ?? PYTHON_SANDBOX_IMAGE;
  const sandbox = options.sandbox ?? new DockerSandbox({ image });
  const tmpRoot = options.tmpRoot ?? os.tmpdir();
  const workspace = await mkdtemp(path.join(tmpRoot, 'codebuddy-py-'));

  try {
    await writeFile(path.join(workspace, 'script.py'), code, 'utf8');
    const result = await sandbox.execute('python3 /workspace/script.py', {
      image,
      workspaceMount: workspace,
      networkEnabled: options.networkEnabled ?? false,
      ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
    });
    return {
      success: result.success,
      stdout: result.output ?? '',
      stderr: result.error ?? '',
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      image,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}
