import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { replayRun } from '../../src/observability/run-viewer.js';
import { RunStore } from '../../src/observability/run-store.js';

describe('buddy run replay', () => {
  let tempDir: string;
  let store: RunStore;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-replay-'));
    store = new RunStore(tempDir);
    (RunStore as unknown as { _instance: RunStore | null })._instance = store;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    store.dispose();
    (RunStore as unknown as { _instance: RunStore | null })._instance = null;
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('re-reads recorded view_file events instead of no-opping with "No test steps"', async () => {
    const workspace = path.join(tempDir, 'toy');
    fs.mkdirSync(workspace, { recursive: true });
    const ledgerPath = path.join(workspace, 'src', 'ledger.js');
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(ledgerPath, 'export const MARK = "NIMBUS_LEDGER_MARK=7f3a";\n');

    const runId = store.startRun('headless prompt', {
      cwd: workspace,
      channel: 'terminal',
    });
    store.emit(runId, {
      type: 'tool_call',
      data: { toolName: 'view_file', args: { path: 'src/ledger.js' } },
    });
    store.endRun(runId, 'completed');
    await new Promise((resolve) => setTimeout(resolve, 40));

    await replayRun(runId, true);

    const output = consoleLogSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).not.toContain('No test steps found in this run.');
    expect(output).toContain('NIMBUS_LEDGER_MARK=7f3a');
    expect(output).toContain('src/ledger.js');
  });

  it('re-executes a recorded test command so replay has a disk effect', async () => {
    const workspace = path.join(tempDir, 'toy');
    fs.mkdirSync(workspace, { recursive: true });
    const hitFile = path.join(workspace, 'replay-hit.txt');
    const testFile = path.join(workspace, 'hit.test.cjs');
    fs.writeFileSync(
      testFile,
      `const fs = require('fs');\nconst assert = require('assert');\nfs.writeFileSync(${JSON.stringify(hitFile)}, 'GK28-REPLAY-HIT\\n');\nassert.ok(true);\n`
    );
    const runId = store.startRun('headless prompt', {
      cwd: workspace,
      channel: 'terminal',
    });
    store.emit(runId, {
      type: 'tool_call',
      data: {
        toolName: 'bash',
        args: { command: `node --test ${JSON.stringify(testFile)}` },
      },
    });
    store.endRun(runId, 'completed');
    await new Promise((resolve) => setTimeout(resolve, 40));

    await replayRun(runId, true);

    expect(fs.existsSync(hitFile)).toBe(true);
    expect(fs.readFileSync(hitFile, 'utf8')).toContain('GK28-REPLAY-HIT');
  });
});
