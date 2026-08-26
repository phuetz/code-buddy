/**
 * AI-Scientist-lite Phase 2 — real-brick sandbox ADAPTER tests.
 *
 * The docker executor and the e2b runScript boundary are INJECTED, so there is
 * ZERO real Docker/E2B in CI. The load-bearing assertion is the SECURITY one:
 * the docker adapter runs with the NETWORK CUT (`networkEnabled:false` →
 * `docker run --network none`). We also assert the SandboxResult → ExecuteCodeResult
 * translation (exit code, stdout/stderr, timeout).
 *
 * Scripts are staged under a throwaway temp `rootDir` (NOT the repo), cleaned up
 * after each test, so nothing is written into the working tree.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

import {
  runInDocker,
  runInE2b,
} from '../../../src/agent/science/experiment-sandbox-backends.js';
import type { SandboxResult, SandboxConfig } from '../../../src/sandbox/docker-sandbox.js';
import type { E2BSandboxResult } from '../../../src/sandbox/e2b-sandbox.js';
import type { ExecuteCodeRunnerOptions } from '../../../src/tools/execute-code-runner.js';

const tmpDirs: string[] = [];

async function scratchRoot(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'exp-sbx-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => undefined);
  }
});

function okResult(over: Partial<SandboxResult> = {}): SandboxResult {
  return { success: true, output: 'accuracy=0.91\n', exitCode: 0, durationMs: 42, ...over };
}

// --------------------------------------------------------------------------
// Docker adapter — NETWORK CUT
// --------------------------------------------------------------------------

describe('runInDocker — network is CUT (the Phase 2 security property)', () => {
  it('passes networkEnabled:false to the docker executor (→ docker run --network none)', async () => {
    const rootDir = await scratchRoot();
    let seenOpts: Partial<SandboxConfig> | undefined;
    let seenCommand: string | undefined;
    const dockerExecute = vi.fn(async (command: string, opts: Partial<SandboxConfig>) => {
      seenCommand = command;
      seenOpts = opts;
      return okResult();
    });

    const options: ExecuteCodeRunnerOptions = { envMode: 'isolate', rootDir };
    const result = await runInDocker(
      { code: 'print("accuracy=0.91")', language: 'python' },
      options,
      { dockerExecute, createId: () => 'fixed-id', now: () => new Date('2026-01-01T00:00:00Z') },
    );

    // THE assertion: the network is provably cut.
    expect(dockerExecute).toHaveBeenCalledOnce();
    expect(seenOpts?.networkEnabled).toBe(false);
    // Python runs in a python image (interpreter present offline).
    expect(seenOpts?.image).toBe('python:3.12-slim');
    // The script is bind-mounted and invoked from /workspace (no network needed).
    expect(seenOpts?.workspaceMount).toBe(path.join(rootDir, '.codebuddy', 'execute-code', 'fixed-id'));
    expect(seenCommand).toBe('python /workspace/script.py');

    // SandboxResult → ExecuteCodeResult translation.
    expect(result.kind).toBe('execute_code_result');
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('accuracy=0.91');
    expect(result.language).toBe('python');
    expect(result.commandPreview).toContain('--network none');
    expect(result.durationMs).toBe(42);
  });

  it('selects a node image + .mjs invocation for javascript', async () => {
    const rootDir = await scratchRoot();
    let seenOpts: Partial<SandboxConfig> | undefined;
    let seenCommand: string | undefined;
    const dockerExecute = vi.fn(async (command: string, opts: Partial<SandboxConfig>) => {
      seenCommand = command;
      seenOpts = opts;
      return okResult({ output: 'ok\n' });
    });

    await runInDocker(
      { code: 'console.log("ok")', language: 'javascript' },
      { envMode: 'isolate', rootDir },
      { dockerExecute, createId: () => 'js-id' },
    );

    expect(seenOpts?.networkEnabled).toBe(false);
    expect(seenOpts?.image).toBe('node:22-slim');
    expect(seenCommand).toBe('node /workspace/script.mjs');
  });

  it('maps a non-zero exit into ok:false + error, keeping stderr', async () => {
    const rootDir = await scratchRoot();
    const dockerExecute = vi.fn(async () => okResult({ success: false, exitCode: 2, error: 'boom on line 3' }));

    const result = await runInDocker(
      { code: 'raise SystemExit(2)', language: 'python' },
      { envMode: 'isolate', rootDir },
      { dockerExecute, createId: () => 'err-id' },
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('boom on line 3');
    expect(result.error).toContain('exited with code 2');
  });

  it('maps a timeout into timedOut:true', async () => {
    const rootDir = await scratchRoot();
    const dockerExecute = vi.fn(async () =>
      okResult({ success: false, exitCode: 1, error: 'Command timed out after 30000ms' }),
    );

    const result = await runInDocker(
      { code: 'while True: pass', language: 'python' },
      { envMode: 'isolate', rootDir },
      { dockerExecute, createId: () => 'to-id' },
    );

    expect(result.timedOut).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out/i);
    // The timeout banner is not surfaced as stderr.
    expect(result.stderr).toBe('');
  });

  it('stages the script on the host run dir (mount source exists)', async () => {
    const rootDir = await scratchRoot();
    let mount: string | undefined;
    const dockerExecute = vi.fn(async (_c: string, opts: Partial<SandboxConfig>) => {
      mount = opts.workspaceMount;
      return okResult();
    });

    await runInDocker(
      { code: 'print(1)', language: 'python' },
      { envMode: 'isolate', rootDir },
      { dockerExecute, createId: () => 'stage-id' },
    );

    const staged = await fs.readFile(path.join(mount!, 'script.py'), 'utf8');
    expect(staged).toBe('print(1)');
  });
});

// --------------------------------------------------------------------------
// E2B adapter — off-host routing
// --------------------------------------------------------------------------

describe('runInE2b — off-host microVM routing', () => {
  it('routes the script + language to E2B.runScript and maps the result', async () => {
    let seenCode: string | undefined;
    let seenLang: string | undefined;
    const runScript = vi.fn(async (code: string, language: string): Promise<E2BSandboxResult> => {
      seenCode = code;
      seenLang = language;
      return { success: true, output: 'accuracy=0.88\n', exitCode: 0, durationMs: 120, sandboxId: 'sbx-1' };
    });

    const result = await runInE2b(
      { code: 'print("accuracy=0.88")', language: 'python' },
      { envMode: 'isolate', rootDir: '/ignored' },
      { runScript, createId: () => 'e2b-id' },
    );

    expect(runScript).toHaveBeenCalledOnce();
    expect(seenCode).toBe('print("accuracy=0.88")');
    expect(seenLang).toBe('python');
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('accuracy=0.88');
    // No host run dir — the paths are virtual (ran off-host).
    expect(result.runDir).toBe('e2b://sbx-1');
    expect(result.commandPreview).toContain('e2b');
  });

  it('maps an e2b failure into ok:false + error', async () => {
    const runScript = vi.fn(
      async (): Promise<E2BSandboxResult> => ({
        success: false,
        output: '',
        error: 'traceback ...',
        exitCode: 1,
        durationMs: 5,
      }),
    );

    const result = await runInE2b(
      { code: 'boom', language: 'python' },
      { envMode: 'isolate', rootDir: '/ignored' },
      { runScript, createId: () => 'e2b-fail' },
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain('exited with code 1');
  });
});
