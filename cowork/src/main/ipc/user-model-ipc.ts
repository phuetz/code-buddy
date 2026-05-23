/**
 * User-model review IPC (Hermes parity item 24, surfaced in Cowork).
 *
 * Wraps the core `getUserModel(workDir)` singleton (`src/memory/user-model.ts`).
 * Same "no silent write" discipline as the lesson queue: `accept` is the only
 * method that mutates the active model and requires an explicit reviewer.
 *
 * The core privacy screen refuses health/finance/relationship/credential
 * content and throws `UserModelPrivacyError`. That message flows back verbatim
 * in the `{ ok:false, error }` envelope so the renderer can show it as a clean
 * "refused — outside scope" notice rather than a crash.
 *
 * @module main/ipc/user-model-ipc
 */

import { ipcMain } from 'electron';
import { logError } from '../utils/logger';
import { loadCoreModule } from '../utils/core-loader';
import { resolveWorkDir, errorMessage, type ProjectManagerSource } from './ipc-workdir';

export type UserObservationKind = 'preference' | 'trait' | 'expertise' | 'working-style';
export type UserObservationStatus = 'pending' | 'accepted' | 'discarded';

export interface UserObservation {
  id: string;
  kind: UserObservationKind;
  content: string;
  confidence?: number;
  status: UserObservationStatus;
  createdAt: number;
  source: 'self_observed' | 'manual';
  reviewedAt?: number;
  reviewedBy?: string;
  reviewNote?: string;
}

interface AcceptInput {
  reviewedBy: string;
  content?: string;
  kind?: UserObservationKind;
  reviewNote?: string;
}

interface DiscardInput {
  reviewedBy?: string;
  reason?: string;
}

interface UserModelLike {
  list(status?: UserObservationStatus): UserObservation[];
  get(id: string): UserObservation | null;
  getAccepted(kind?: UserObservationKind): UserObservation[];
  accept(id: string, input: AcceptInput): UserObservation;
  discard(id: string, input: DiscardInput): UserObservation;
  summarize(): string | null;
  getStats(): {
    total: number;
    byStatus: Record<UserObservationStatus, number>;
    byKind: Record<UserObservationKind, number>;
  };
  clear(status?: UserObservationStatus): number;
}

type UserModelMod = {
  getUserModel: (workDir?: string) => UserModelLike;
};

const NO_PROJECT = 'NO_ACTIVE_PROJECT';

async function getModel(
  source: ProjectManagerSource,
  projectId?: string,
): Promise<{ model: UserModelLike | null; reason?: string }> {
  const workDir = resolveWorkDir(source, projectId);
  if (!workDir) return { model: null, reason: NO_PROJECT };
  const mod = await loadCoreModule<UserModelMod>('memory/user-model.js');
  if (!mod?.getUserModel) {
    return { model: null, reason: 'core user-model module unavailable' };
  }
  return { model: mod.getUserModel(workDir) };
}

export function registerUserModelIpcHandlers(projectManagerSource: ProjectManagerSource): void {
  ipcMain.handle(
    'userModel.list',
    async (_e, status?: UserObservationStatus, projectId?: string) => {
      const { model, reason } = await getModel(projectManagerSource, projectId);
      if (!model) return { ok: false as const, error: reason, items: [] as UserObservation[] };
      try {
        return { ok: true as const, items: model.list(status) };
      } catch (err) {
        logError('[userModel.list] failed:', err);
        return { ok: false as const, error: errorMessage(err), items: [] as UserObservation[] };
      }
    },
  );

  ipcMain.handle('userModel.stats', async (_e, projectId?: string) => {
    const { model, reason } = await getModel(projectManagerSource, projectId);
    if (!model) return { ok: false as const, error: reason };
    try {
      return { ok: true as const, stats: model.getStats() };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  ipcMain.handle('userModel.summarize', async (_e, projectId?: string) => {
    const { model, reason } = await getModel(projectManagerSource, projectId);
    if (!model) return { ok: false as const, error: reason };
    try {
      return { ok: true as const, summary: model.summarize() };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  ipcMain.handle('userModel.get', async (_e, id: string, projectId?: string) => {
    const { model, reason } = await getModel(projectManagerSource, projectId);
    if (!model) return { ok: false as const, error: reason };
    try {
      return { ok: true as const, observation: model.get(id) };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  // The only model-write path — requires an explicit reviewer. Re-screens
  // edited content against the privacy boundary (may throw UserModelPrivacyError).
  ipcMain.handle(
    'userModel.accept',
    async (_e, id: string, input: AcceptInput, projectId?: string) => {
      const { model, reason } = await getModel(projectManagerSource, projectId);
      if (!model) return { ok: false as const, error: reason };
      if (!input?.reviewedBy?.trim()) {
        return { ok: false as const, error: 'reviewedBy is required to accept an observation.' };
      }
      try {
        return { ok: true as const, observation: model.accept(id, input) };
      } catch (err) {
        // Privacy refusals land here too — surface the message, not a crash.
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'userModel.discard',
    async (_e, id: string, input: DiscardInput, projectId?: string) => {
      const { model, reason } = await getModel(projectManagerSource, projectId);
      if (!model) return { ok: false as const, error: reason };
      try {
        return { ok: true as const, observation: model.discard(id, input ?? {}) };
      } catch (err) {
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );
}
