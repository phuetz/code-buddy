import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildRunTrajectoryBatchExport,
  renderRunTrajectoryBatchExport,
} from '../../src/observability/run-trajectory-batch.js';
import { RunStore } from '../../src/observability/run-store.js';
import { resetDataRedactionEngine } from '../../src/security/data-redaction.js';

describe('buildRunTrajectoryBatchExport', () => {
  let tempDir: string;
  let store: RunStore;
  let activeRunIds: string[];

  beforeEach(() => {
    resetDataRedactionEngine();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-trajectory-batch-'));
    store = new RunStore(tempDir);
    activeRunIds = [];
  });

  afterEach(async () => {
    for (const runId of activeRunIds) {
      try {
        store.endRun(runId, 'cancelled');
      } catch {
        // Ignore already-ended runs.
      }
    }
    store.dispose();
    resetDataRedactionEngine();
    await new Promise((resolve) => setTimeout(resolve, 60));
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  function startRun(objective: string, metadata?: Parameters<RunStore['startRun']>[1]): string {
    const runId = store.startRun(objective, metadata);
    activeRunIds.push(runId);
    return runId;
  }

  it('exports a redacted batch and bounded compressed context from real stored runs', async () => {
    const secret = 'sk-abcdefghijklmnopqrstuvwx';
    const firstRunId = startRun('Hermes batch trajectory proof alpha', {
      channel: 'cowork',
      tags: ['hermes', 'research'],
    });
    store.emit(firstRunId, {
      type: 'tool_call',
      data: {
        toolName: 'web_search',
        args: {
          apiKey: secret,
          query: 'Hermes trajectory alpha',
        },
      },
    });
    store.emit(firstRunId, {
      type: 'tool_result',
      data: {
        output: `Alpha proof token ${secret}`,
        success: true,
        toolName: 'web_search',
      },
    });
    store.saveArtifact(firstRunId, 'alpha.md', `Alpha artifact ${secret}`);
    store.endRun(firstRunId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== firstRunId);

    const secondRunId = startRun('Hermes batch trajectory proof beta', {
      channel: 'cli',
      tags: ['hermes', 'research'],
    });
    store.emit(secondRunId, {
      type: 'tool_call',
      data: {
        toolName: 'view_file',
        args: { path: 'docs/hermes-agent-status.md' },
      },
    });
    store.emit(secondRunId, {
      type: 'tool_result',
      data: {
        output: 'Beta proof collected',
        success: true,
        toolName: 'view_file',
      },
    });
    store.endRun(secondRunId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== secondRunId);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const batch = buildRunTrajectoryBatchExport({
      includeArtifactContent: true,
      maxCompressedBytes: 2_000,
      query: 'batch trajectory proof',
      sources: ['research'],
      store,
    });
    const raw = JSON.stringify(batch);

    expect(batch).toMatchObject({
      kind: 'run_trajectory_batch_export',
      mode: 'redacted_batch_review_export',
      schemaVersion: 1,
      selection: {
        query: 'batch trajectory proof',
        sources: ['research'],
      },
      summary: {
        completedCount: 2,
        runCount: 2,
        toolCallCount: 2,
        toolResultCount: 2,
      },
    });
    expect(batch.compressed.format).toBe('agent_recall_context');
    expect(batch.compressed.text).toContain('# Trajectory batch recall context');
    expect(batch.compressed.sourceRunIds).toEqual(expect.arrayContaining([firstRunId, secondRunId]));
    expect(batch.privacy.redactionCount).toBeGreaterThan(0);
    expect(raw).not.toContain(secret);
    expect(renderRunTrajectoryBatchExport(batch)).toContain('Run trajectory batch export');
  });

  it('reports skipped explicit run ids without failing the whole batch', () => {
    const runId = startRun('Hermes explicit batch proof', { channel: 'cli' });
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);

    const batch = buildRunTrajectoryBatchExport({
      runIds: [runId, 'run_missing'],
      store,
    });

    expect(batch.selection.selectedRunIds).toEqual([runId]);
    expect(batch.selection.skippedRunIds).toEqual(['run_missing']);
    expect(batch.summary.runCount).toBe(1);
  });
});
