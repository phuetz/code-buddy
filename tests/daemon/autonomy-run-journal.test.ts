import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RunStore } from '../../src/observability/run-store.js';
import {
  closeAutonomyRun,
  openAutonomyRun,
  recordAutonomyTick,
} from '../../src/daemon/autonomy-run-journal.js';
import type { TickResult } from '../../src/daemon/autonomous-loop.js';

describe('autonomy run journal', () => {
  let dir: string;
  let store: RunStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'auto-run-'));
    store = new RunStore(dir);
  });

  afterEach(() => {
    store.dispose();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('records autonomy ticks so buddy run list can show them', () => {
    const runId = openAutonomyRun(store, 'autonomy run');
    recordAutonomyTick(store, runId, {
      outcome: 'completed',
      taskId: 'task-1',
      taskTitle: 'Fix add',
      model: { model: 'qwen3:4b-instruct', tier: 'local', paid: false, reason: 'free-first' },
    } as TickResult, 1);
    closeAutonomyRun(store, runId, {
      ticks: 1,
      outcomes: { completed: 1 },
      stoppedReason: 'maxTicks',
    });

    const listed = store.listRuns(5);
    expect(listed[0]?.runId).toBe(runId);
    expect(listed[0]?.objective).toBe('autonomy run');
    expect(listed[0]?.status).toBe('completed');
    const events = store.getEvents(runId);
    expect(events.some((e) => e.type === 'decision' && (e.data as { taskId?: string }).taskId === 'task-1')).toBe(true);
  });
});
