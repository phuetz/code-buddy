import { Command } from 'commander';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerRunCommands } from '../../src/commands/run-cli/index.js';
import { resetLessonCandidateQueues } from '../../src/agent/lesson-candidate-queue.js';
import { RunStore } from '../../src/observability/run-store.js';

describe('buddy run retrospective', () => {
  let tempDir: string;
  let oldCwd: string;
  let store: RunStore;
  let activeRunIds: string[];
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-run-retro-'));
    oldCwd = process.cwd();
    process.chdir(tempDir);
    store = new RunStore(path.join(tempDir, 'runs'));
    activeRunIds = [];
    (RunStore as unknown as { _instance: RunStore | null })._instance = store;
    resetLessonCandidateQueues();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const runId of activeRunIds) {
      try {
        store.endRun(runId, 'cancelled');
      } catch {
        // Ignore already-ended runs.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    consoleLogSpy.mockRestore();
    store.dispose();
    (RunStore as unknown as { _instance: RunStore | null })._instance = null;
    resetLessonCandidateQueues();
    process.chdir(oldCwd);
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('runs the Learning Agent from the CLI against a real persisted run', async () => {
    const runId = store.startRun('CLI retrospective proof', { channel: 'cli' });
    activeRunIds.push(runId);
    store.emit(runId, { type: 'tool_call', data: { toolName: 'search', args: { query: 'learning' } } });
    store.emit(runId, { type: 'tool_result', data: { toolName: 'search', success: true, durationMs: 10 } });
    store.emit(runId, { type: 'tool_call', data: { toolName: 'view_file', args: { path: 'src/agent/learning-agent.ts' } } });
    store.emit(runId, { type: 'tool_result', data: { toolName: 'view_file', success: true, durationMs: 10 } });
    store.emit(runId, { type: 'tool_call', data: { toolName: 'bash', args: { command: 'npm run typecheck' } } });
    store.emit(runId, { type: 'tool_result', data: { toolName: 'bash', success: true, durationMs: 10 } });
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);
    await new Promise((resolve) => setTimeout(resolve, 120));

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    registerRunCommands(program);

    await program.parseAsync(['node', 'test', 'run', 'retrospective', runId, '--force', '--json']);

    const output = JSON.parse(consoleLogSpy.mock.calls.map((call) => call.join(' ')).join('\n'));
    expect(output.skipped).toBe(false);
    expect(output.retrospective.toolSequence).toEqual(['search', 'view_file', 'bash']);
    expect(fs.existsSync(path.join(tempDir, '.codebuddy', 'learning', 'pattern-library.json'))).toBe(true);
  });
});
