import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildRunTrajectoryExport,
  renderRunTrajectoryExport,
} from '../../src/observability/run-trajectory-export.js';
import { RunStore } from '../../src/observability/run-store.js';
import { resetDataRedactionEngine } from '../../src/security/data-redaction.js';

describe('buildRunTrajectoryExport', () => {
  let tempDir: string;
  let store: RunStore;
  let activeRunIds: string[];

  beforeEach(() => {
    resetDataRedactionEngine();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-trajectory-export-'));
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

  it('exports a redacted run trajectory with prompt, context, tools, artifacts and final answer', async () => {
    const secret = 'sk-abcdefghijklmnopqrstuvwx';
    const runId = startRun('Architect lead discovery with public evidence', {
      channel: 'cowork',
      sessionId: 'session_123',
      tags: ['fleet', 'research'],
    });
    store.emit(runId, {
      type: 'decision',
      data: {
        selectedContext: 'Use public directory source URLs beside extracted contacts.',
      },
    });
    store.emit(runId, {
      type: 'tool_call',
      data: {
        toolCallId: 'call_search',
        toolName: 'web_search',
        args: {
          apiKey: secret,
          query: 'architects near Lyon',
        },
      },
    });
    store.emit(runId, {
      type: 'tool_result',
      data: {
        durationMs: 42,
        output: `Found public architect directory. token=${secret}`,
        success: true,
        toolName: 'web_search',
      },
    });
    store.saveArtifact(
      runId,
      'summary.md',
      `Public evidence summary with ${secret}`,
    );
    store.emit(runId, {
      type: 'run_end',
      data: {
        finalAnswer: `Export contacts for manual review only. ${secret}`,
        status: 'completed',
      },
    });
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const exported = buildRunTrajectoryExport(runId, {
      includeArtifactContent: true,
      maxArtifactBytes: 500,
      store,
    });

    expect(exported).toMatchObject({
      schemaVersion: 1,
      kind: 'run_trajectory_export',
      mode: 'redacted_review_export',
      run: {
        runId,
        channel: 'cowork',
        sessionId: 'session_123',
        source: 'cowork',
        tags: ['fleet', 'research'],
      },
      privacy: {
        artifactContentIncluded: true,
        redaction: 'secrets-redacted',
      },
      prompt: {
        sources: expect.arrayContaining(['summary.objective']),
      },
    });
    expect(exported?.selectedContext).toEqual([
      expect.objectContaining({
        source: 'decision.selectedContext',
      }),
    ]);
    expect(exported?.toolCalls).toEqual([
      expect.objectContaining({
        callId: 'call_search',
        toolName: 'web_search',
      }),
    ]);
    expect(exported?.toolResults).toEqual([
      expect.objectContaining({
        success: true,
        toolName: 'web_search',
      }),
    ]);
    expect(exported?.artifacts).toEqual([
      expect.objectContaining({
        contentPreview: expect.stringContaining('[REDACTED'),
        name: 'summary.md',
      }),
    ]);
    expect(JSON.stringify(exported)).not.toContain(secret);
    expect(exported?.privacy.redactionCount).toBeGreaterThan(0);
    expect(renderRunTrajectoryExport(exported as NonNullable<typeof exported>)).toContain('Run trajectory export');
  });

  it('returns null when the run cannot be found', () => {
    expect(buildRunTrajectoryExport('run_missing', { store })).toBeNull();
  });
});
