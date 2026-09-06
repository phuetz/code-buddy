import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunStore } from '../../src/observability/run-store.js';
import { listRuns } from '../../src/observability/run-viewer.js';
import { loadTrajectory } from '../../src/observability/run-trajectory-load.js';
import { renderTrajectory } from '../../src/observability/run-trajectory.js';

describe('B-2: Run lifecycle, completion status, trajectory metrics, and auditLogger.init', () => {
  let tmpHome: string;
  let tmpRunsDir: string;
  let store: RunStore;
  let activeRunIds: string[] = [];
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let originalEnvAuditDir: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'b2-home-'));
    tmpRunsDir = path.join(tmpHome, '.codebuddy', 'runs');
    fs.mkdirSync(tmpRunsDir, { recursive: true });
    originalEnvAuditDir = process.env.CODEBUDDY_AUDIT_DIR;
    process.env.CODEBUDDY_AUDIT_DIR = path.join(tmpHome, '.codebuddy');

    store = new RunStore(tmpRunsDir);
    (RunStore as unknown as { _instance: RunStore | null })._instance = store;
    activeRunIds = [];
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const runId of activeRunIds) {
      try {
        store.endRun(runId, 'cancelled');
      } catch {
        // ignore
      }
    }
    store.dispose();
    (RunStore as unknown as { _instance: RunStore | null })._instance = null;
    if (originalEnvAuditDir !== undefined) {
      process.env.CODEBUDDY_AUDIT_DIR = originalEnvAuditDir;
    } else {
      delete process.env.CODEBUDDY_AUDIT_DIR;
    }
    consoleLogSpy.mockRestore();
    await new Promise((resolve) => setTimeout(resolve, 60));
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function getLogs(): string {
    return consoleLogSpy.mock.calls.map((call) => call.join(' ')).join('\n');
  }

  it('proves that a completed run shows [DONE] in list and trajectory restitutes tokens and duration', async () => {
    // Start run as done in production
    const runId = store.startRun('headless prompt', {
      channel: 'terminal',
      sessionId: 'session_b2_test',
      tags: ['headless', 'qwen3.8-ctx32k:latest'],
    });
    activeRunIds.push(runId);

    // Simulate agent recording tool call
    store.emit(runId, {
      type: 'tool_call',
      data: { toolName: 'bash', toolCallId: 't1', args: { command: 'echo hello' } },
    });
    store.emit(runId, {
      type: 'tool_result',
      data: { toolName: 'bash', toolCallId: 't1', success: true, durationMs: 50 },
    });

    // Simulate completion with tokens & cost
    store.updateMetrics(runId, {
      promptTokens: 5604,
      completionTokens: 250,
      totalTokens: 5854,
      totalCost: 0.005,
    });

    // End run as done in production finalizer
    await new Promise((r) => setTimeout(r, 20)); // ensure >0 ms duration
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);

    // 1. Verify list shows [DONE]
    listRuns(10);
    const listOutput = getLogs();
    expect(listOutput).toContain('[DONE]');
    expect(listOutput).toContain(runId);
    expect(listOutput).not.toContain('[RUNNING]');

    // 2. Verify trajectory restitutes tokens and duration and ended timestamp
    const trajectory = loadTrajectory(runId, { store, homeDir: tmpHome });
    const rendered = renderTrajectory(trajectory);

    expect(rendered).toContain('status=completed');
    expect(rendered).not.toContain('Ended:   non journalisé: endedAt');
    expect(rendered).toContain('Tokens in/out:   5604 / 250');
    expect(rendered).not.toContain('Tokens in/out:   0 / 0');
    expect(rendered).not.toContain('Durée:           0ms');
    expect(rendered).not.toContain("auditLogger.init n'est appelé nulle part en production");
  });
});
