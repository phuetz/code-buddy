import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildLocalHermesToolParityManifest } from '../../src/agent/hermes-tool-parity-local.js';
import type { ExecuteCodeResult } from '../../src/tools/execute-code-runner.js';
import { createExecuteCodeTools } from '../../src/tools/registry/execute-code-tools.js';

let tempWorkspace: string;
let originalCwd: string;
let idCounter: number;

function fixedNow(): Date {
  return new Date('2026-05-30T18:00:00.000Z');
}

function nextId(): string {
  idCounter += 1;
  return `execute-real-${idCounter}`;
}

function parseToolOutput(result: { success: boolean; output?: string; error?: string }): ExecuteCodeResult {
  expect(result.output).toBeTruthy();
  return JSON.parse(result.output as string) as ExecuteCodeResult;
}

describe('execute_code real subprocess integration', () => {
  beforeEach(async () => {
    originalCwd = process.cwd();
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-execute-code-real-'));
    idCounter = 0;
    process.chdir(tempWorkspace);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempWorkspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('runs JavaScript through a real Node subprocess and persists artifacts', async () => {
    const [tool] = createExecuteCodeTools({
      rootDir: tempWorkspace,
      now: fixedNow,
      createId: nextId,
    });

    const result = await tool!.execute({
      language: 'javascript',
      args: ['from-arg'],
      env: { CUSTOM_VALUE: '42' },
      code: [
        "import fs from 'node:fs';",
        "import path from 'node:path';",
        'const artifact = {',
        "  value: Number(process.env.CUSTOM_VALUE),",
        '  args: process.argv.slice(2),',
        "  workspace: process.env.CODEBUDDY_WORKSPACE_ROOT,",
        '};',
        "fs.writeFileSync(path.join(process.env.CODEBUDDY_EXECUTE_CODE_RUN_DIR, 'artifact.json'), JSON.stringify(artifact, null, 2));",
        'console.log(JSON.stringify(artifact));',
      ].join('\n'),
    });

    expect(result.success, result.error).toBe(true);
    const payload = parseToolOutput(result);
    expect(payload).toMatchObject({
      kind: 'execute_code_result',
      ok: true,
      runId: 'execute-real-1',
      language: 'javascript',
      exitCode: 0,
      timedOut: false,
      runDir: path.join(tempWorkspace, '.codebuddy', 'execute-code', 'execute-real-1'),
    });
    expect(payload.files).toEqual(expect.arrayContaining([
      'artifact.json',
      'result.json',
      'script.mjs',
      'stderr.log',
      'stdout.log',
    ]));
    expect(payload.stdout).toContain('"value":42');

    const artifact = JSON.parse(await fs.readFile(path.join(payload.runDir, 'artifact.json'), 'utf8')) as {
      value: number;
      args: string[];
      workspace: string;
    };
    expect(artifact).toEqual({
      value: 42,
      args: ['from-arg'],
      workspace: tempWorkspace,
    });
    await expect(fs.stat(payload.scriptPath)).resolves.toBeTruthy();
    await expect(fs.stat(payload.stdoutPath)).resolves.toBeTruthy();
    await expect(fs.stat(payload.stderrPath)).resolves.toBeTruthy();
    await expect(fs.readFile(payload.resultPath, 'utf8')).resolves.toContain('"kind": "execute_code_result"');
  });

  it('kills long-running subprocesses and still writes result artifacts', async () => {
    const [tool] = createExecuteCodeTools({
      rootDir: tempWorkspace,
      now: fixedNow,
      createId: nextId,
    });

    const result = await tool!.execute({
      language: 'javascript',
      timeout_ms: 1000,
      code: 'setInterval(() => {}, 1000);',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
    const payload = parseToolOutput(result);
    expect(payload).toMatchObject({
      ok: false,
      runId: 'execute-real-1',
      timedOut: true,
      error: 'execute_code timed out after 1000ms',
    });
    await expect(fs.readFile(payload.resultPath, 'utf8')).resolves.toContain('"timedOut": true');
  });

  it('marks official Hermes execute_code as an exact local tool', () => {
    const manifest = buildLocalHermesToolParityManifest('2026-05-30T18:00:00.000Z');
    expect(manifest.tools).toContainEqual(expect.objectContaining({
      name: 'execute_code',
      status: 'exact',
      detectedCodeBuddyTools: expect.arrayContaining(['execute_code']),
    }));
  });
});
