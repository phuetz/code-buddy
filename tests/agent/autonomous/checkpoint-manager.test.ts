import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { saveCheckpoint, loadCheckpoint } from '../../../src/agent/autonomous/checkpoint-manager.js';
import type { AgenticCodingCheckpoint } from '../../../src/agent/autonomous/checkpoint-manager.js';

describe('checkpoint-manager', () => {
  let tempHome: string;
  let oldHome: string | undefined;

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-checkpoint-home-'));
    oldHome = process.env.CODEBUDDY_HOME;
    process.env.CODEBUDDY_HOME = tempHome;
  });

  afterEach(async () => {
    process.env.CODEBUDDY_HOME = oldHome;
    await fs.rm(tempHome, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 });
  });

  it('saves and loads a checkpoint correctly', async () => {
    const checkpoint: AgenticCodingCheckpoint = {
      runId: 'test-run-123',
      step: 'initialized',
      timestamp: new Date().toISOString(),
      options: { taskFile: 'task.json' },
      contract: {
        repo: 'D:/repo',
        task: 'Do task',
        allowedPaths: ['file.ts'],
        verification: ['npm test'],
        riskLevel: 'low',
        edits: [],
        maxFilesChanged: 5,
        maxToolRounds: 5,
        memoryPolicy: 'none',
        fleetPolicy: 'none',
      },
    };

    await saveCheckpoint(checkpoint);
    const loaded = await loadCheckpoint('test-run-123');
    expect(loaded).toBeDefined();
    expect(loaded?.runId).toBe('test-run-123');
    expect(loaded?.contract.task).toBe('Do task');
  });

  it('returns null if checkpoint does not exist', async () => {
    const loaded = await loadCheckpoint('non-existent');
    expect(loaded).toBeNull();
  });
});
