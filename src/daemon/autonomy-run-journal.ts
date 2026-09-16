/**
 * Bridge autonomy ticks into the observability RunStore so
 * `buddy run list|show` sees the same work as `buddy autonomy briefing`.
 */

import type { TickResult } from './autonomous-loop.js';
import type { DaemonRunSummary } from './autonomous-daemon.js';

export interface AutonomyRunJournalStore {
  startRun(objective: string, metadata?: { channel?: string; tags?: string[] }): string;
  emit(runId: string, event: { type: 'decision' | 'run_end' | 'error'; data: Record<string, unknown> }): void;
  endRun(runId: string, status: 'completed' | 'failed' | 'cancelled'): void;
}

export function openAutonomyRun(
  store: AutonomyRunJournalStore,
  objective = 'autonomy run',
): string {
  return store.startRun(objective, { channel: 'autonomy', tags: ['autonomy'] });
}

export function recordAutonomyTick(
  store: AutonomyRunJournalStore,
  runId: string,
  result: TickResult,
  tickNumber: number,
): void {
  store.emit(runId, {
    type: result.outcome === 'failed' ? 'error' : 'decision',
    data: {
      kind: 'autonomy.tick',
      tickNumber,
      outcome: result.outcome,
      ...(result.taskId ? { taskId: result.taskId } : {}),
      ...(result.taskTitle ? { taskTitle: result.taskTitle } : {}),
      ...(result.detail ? { detail: result.detail } : {}),
      ...(result.model
        ? {
          model: result.model.model,
          tier: result.model.tier,
          paid: result.model.paid,
        }
        : {}),
    },
  });
}

export function closeAutonomyRun(
  store: AutonomyRunJournalStore,
  runId: string,
  summary: DaemonRunSummary,
): void {
  store.emit(runId, {
    type: 'decision',
    data: {
      kind: 'autonomy.summary',
      ticks: summary.ticks,
      outcomes: summary.outcomes,
      stoppedReason: summary.stoppedReason,
    },
  });
  const failed = (summary.outcomes['failed'] ?? 0) > 0 && (summary.outcomes['completed'] ?? 0) === 0;
  store.endRun(runId, failed ? 'failed' : 'completed');
}
