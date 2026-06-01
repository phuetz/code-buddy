import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildHermesTrajectoryCompatibilityReport,
  renderHermesTrajectoryCompatibilityReport,
} from '../../src/observability/hermes-trajectory-compatibility.js';
import { RunStore } from '../../src/observability/run-store.js';
import { resetDataRedactionEngine } from '../../src/security/data-redaction.js';

describe('buildHermesTrajectoryCompatibilityReport', () => {
  let tempDir: string;
  let store: RunStore;
  let activeRunIds: string[];

  beforeEach(() => {
    resetDataRedactionEngine();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-trajectory-compatibility-'));
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
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function startRun(objective: string, metadata?: Parameters<RunStore['startRun']>[1]): string {
    const runId = store.startRun(objective, metadata);
    activeRunIds.push(runId);
    return runId;
  }

  it('reports Hermes trajectory compatibility with a real redacted RunStore probe', async () => {
    const secret = 'sk-abcdefghijklmnopqrstuvwx';
    const runId = startRun('Hermes trajectory proof for research compression', {
      channel: 'cowork',
      tags: ['hermes', 'research'],
    });
    store.emit(runId, {
      type: 'decision',
      data: {
        selectedContext: 'Use stored trajectory proof before claiming Hermes research parity.',
      },
    });
    store.emit(runId, {
      type: 'tool_call',
      data: {
        toolCallId: 'call_real_search',
        toolName: 'web_search',
        args: {
          apiKey: secret,
          query: 'Hermes trajectory proof',
        },
      },
    });
    store.emit(runId, {
      type: 'tool_result',
      data: {
        durationMs: 33,
        output: `Trajectory proof collected with token ${secret}`,
        success: true,
        toolName: 'web_search',
      },
    });
    store.saveArtifact(
      runId,
      'summary.md',
      `Hermes trajectory proof artifact with ${secret}`,
    );
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const report = buildHermesTrajectoryCompatibilityReport({
      includeArtifactContent: true,
      query: 'trajectory proof',
      runId,
      store,
    });
    const raw = JSON.stringify(report);

    expect(report).toMatchObject({
      kind: 'hermes_trajectory_compatibility_report',
      schemaVersion: 1,
      ok: true,
      summary: {
        missingCount: 0,
      },
      schemaVersions: {
        trajectoryBatch: 1,
        trajectoryExport: 1,
        recallPack: 1,
        policyEval: 1,
        goldenWorkflowEval: 1,
      },
      probe: {
        trajectoryExport: {
          found: true,
          runId,
          status: 'completed',
          toolCallCount: 1,
          toolResultCount: 1,
        },
        recallPack: {
          query: 'trajectory proof',
          runCount: 1,
        },
      },
    });
    expect(report.summary.availableCount).toBeGreaterThanOrEqual(5);
    expect(report.summary.partialCount).toBe(0);
    expect(report.summary.goldenFixtureCount).toBeGreaterThan(0);
    expect(report.summary.policyEvalCount).toBeGreaterThan(0);
    expect(report.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'trajectory-export', status: 'available' }),
        expect.objectContaining({ id: 'recall-pack', status: 'available' }),
        expect.objectContaining({ id: 'batch-trajectory-generation', status: 'available' }),
        expect.objectContaining({ id: 'trajectory-compression', status: 'available' }),
      ]),
    );
    expect(report.probe?.trajectoryBatch).toMatchObject({
      runCount: 1,
      sourceRunIds: [runId],
    });
    expect(report.probe?.trajectoryExport?.redactionCount).toBeGreaterThan(0);
    expect(raw).not.toContain(secret);
    const textReport = renderHermesTrajectoryCompatibilityReport(report);
    expect(textReport).toContain('Hermes trajectory compatibility:');
    expect(textReport).toContain('Commands:');
    expect(textReport).toContain('buddy hermes trajectories status --run-id <run-id> --json');
    expect(textReport).toContain('Evidence: 3 file/test reference(s)');
  });
});
