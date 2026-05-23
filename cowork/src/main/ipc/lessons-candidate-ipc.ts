/**
 * Lesson-candidate review queue IPC (Hermes parity item 7, surfaced in Cowork).
 *
 * Wraps the core `getLessonCandidateQueue(workDir)` singleton
 * (`src/agent/lesson-candidate-queue.ts`). The queue enforces "no silent
 * procedural memory mutation": `approve` is the ONLY path that writes
 * `lessons.md`, and it requires an explicit human reviewer. This bridge keeps
 * that contract — the renderer must pass `reviewedBy` to approve/discard.
 *
 * Every result is an `{ ok, error?, ... }` envelope so the renderer can show a
 * "select a project first" empty state (`NO_ACTIVE_PROJECT`) or a clean error
 * instead of an unhandled rejection.
 *
 * @module main/ipc/lessons-candidate-ipc
 */

import { ipcMain } from 'electron';
import { logError } from '../utils/logger';
import { loadCoreModule } from '../utils/core-loader';
import { resolveWorkDir, errorMessage, type ProjectManagerSource } from './ipc-workdir';

export type LessonCategory = 'PATTERN' | 'RULE' | 'CONTEXT' | 'INSIGHT';
export type LessonCandidateStatus = 'pending' | 'approved' | 'discarded';

export interface LessonCandidate {
  id: string;
  category: LessonCategory;
  content: string;
  context?: string;
  status: LessonCandidateStatus;
  createdAt: number;
  source: 'self_observed' | 'manual';
  reviewedAt?: number;
  reviewedBy?: string;
  reviewNote?: string;
  approvedLessonId?: string;
}

interface ApproveInput {
  reviewedBy: string;
  content?: string;
  category?: LessonCategory;
  context?: string;
  reviewNote?: string;
}

interface DiscardInput {
  reviewedBy?: string;
  reason?: string;
}

interface LessonCandidateQueueLike {
  list(status?: LessonCandidateStatus): LessonCandidate[];
  get(id: string): LessonCandidate | null;
  approve(id: string, input: ApproveInput): Promise<{ candidate: LessonCandidate; lesson: { id: string } }>;
  discard(id: string, input: DiscardInput): LessonCandidate;
  getStats(): { total: number; byStatus: Record<LessonCandidateStatus, number> };
}

type QueueMod = {
  getLessonCandidateQueue: (workDir?: string) => LessonCandidateQueueLike;
};

const NO_PROJECT = 'NO_ACTIVE_PROJECT';

async function getQueue(
  source: ProjectManagerSource,
  projectId?: string,
): Promise<{ queue: LessonCandidateQueueLike | null; reason?: string }> {
  const workDir = resolveWorkDir(source, projectId);
  if (!workDir) return { queue: null, reason: NO_PROJECT };
  const mod = await loadCoreModule<QueueMod>('agent/lesson-candidate-queue.js');
  if (!mod?.getLessonCandidateQueue) {
    return { queue: null, reason: 'core lesson-candidate-queue module unavailable' };
  }
  return { queue: mod.getLessonCandidateQueue(workDir) };
}

export function registerLessonCandidateIpcHandlers(projectManagerSource: ProjectManagerSource): void {
  ipcMain.handle(
    'lessonCandidate.list',
    async (_e, status?: LessonCandidateStatus, projectId?: string) => {
      const { queue, reason } = await getQueue(projectManagerSource, projectId);
      if (!queue) return { ok: false as const, error: reason, items: [] as LessonCandidate[] };
      try {
        return { ok: true as const, items: queue.list(status) };
      } catch (err) {
        logError('[lessonCandidate.list] failed:', err);
        return { ok: false as const, error: errorMessage(err), items: [] as LessonCandidate[] };
      }
    },
  );

  ipcMain.handle('lessonCandidate.stats', async (_e, projectId?: string) => {
    const { queue, reason } = await getQueue(projectManagerSource, projectId);
    if (!queue) return { ok: false as const, error: reason };
    try {
      return { ok: true as const, stats: queue.getStats() };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  ipcMain.handle('lessonCandidate.get', async (_e, id: string, projectId?: string) => {
    const { queue, reason } = await getQueue(projectManagerSource, projectId);
    if (!queue) return { ok: false as const, error: reason };
    try {
      return { ok: true as const, candidate: queue.get(id) };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  // The ONLY write path — requires an explicit reviewer. Async (flushes the
  // LessonsTracker write chain so lessons.md is durable before returning).
  ipcMain.handle(
    'lessonCandidate.approve',
    async (_e, id: string, input: ApproveInput, projectId?: string) => {
      const { queue, reason } = await getQueue(projectManagerSource, projectId);
      if (!queue) return { ok: false as const, error: reason };
      if (!input?.reviewedBy?.trim()) {
        return { ok: false as const, error: 'reviewedBy is required to approve a lesson candidate.' };
      }
      try {
        const result = await queue.approve(id, input);
        return { ok: true as const, candidate: result.candidate, lessonId: result.lesson.id };
      } catch (err) {
        logError('[lessonCandidate.approve] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'lessonCandidate.discard',
    async (_e, id: string, input: DiscardInput, projectId?: string) => {
      const { queue, reason } = await getQueue(projectManagerSource, projectId);
      if (!queue) return { ok: false as const, error: reason };
      try {
        return { ok: true as const, candidate: queue.discard(id, input ?? {}) };
      } catch (err) {
        logError('[lessonCandidate.discard] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );
}
