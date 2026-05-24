/**
 * Companion IPC — Lisa-inspired senses/status surface for Cowork.
 *
 * Wraps the core companion modules through `core-loader` so Cowork can show
 * Buddy's local sensory journal without duplicating storage logic.
 *
 * @module main/ipc/companion-ipc
 */

import { ipcMain } from 'electron';
import { loadCoreModule } from '../utils/core-loader';
import { logError } from '../utils/logger';
import { resolveWorkDir, errorMessage, type ProjectManagerSource } from './ipc-workdir';

type CompanionPerceptModality =
  | 'vision'
  | 'hearing'
  | 'screen'
  | 'self'
  | 'memory'
  | 'tool'
  | 'suggestion';

interface CompanionPercept {
  id: string;
  modality: CompanionPerceptModality;
  source: string;
  timestamp: string;
  confidence: number;
  summary: string;
  payload: Record<string, unknown>;
  tags: string[];
}

interface CompanionPerceptStats {
  storePath: string;
  exists: boolean;
  total: number;
  byModality: Partial<Record<CompanionPerceptModality, number>>;
  latestTimestamp?: string;
}

interface CompanionSelfEvaluationFinding {
  id: string;
  area: string;
  severity: 'info' | 'warning' | 'action';
  summary: string;
  recommendation: string;
  command?: string;
  tags: string[];
}

interface CompanionSelfEvaluation {
  id: string;
  timestamp: string;
  cwd: string;
  score: number;
  level: 'dormant' | 'awakening' | 'aware' | 'collaborative';
  findings: CompanionSelfEvaluationFinding[];
  strengths: string[];
  nextActions: string[];
  perceptStats: CompanionPerceptStats;
}

interface CameraSnapshotResult {
  success: boolean;
  path?: string;
  output?: string;
  error?: string;
  command?: string;
  perceptId?: string;
  perceptPath?: string;
}

type CompanionModeMod = {
  getCompanionStatus: (options: { cwd?: string }) => Promise<Record<string, unknown>>;
  recordCompanionSelfState: (options: { cwd?: string }) => Promise<CompanionPercept>;
};

type CompanionPerceptsMod = {
  readRecentCompanionPercepts: (options: {
    cwd?: string;
    limit?: number;
    modality?: CompanionPerceptModality;
  }) => Promise<CompanionPercept[]>;
  getCompanionPerceptStats: (options: { cwd?: string }) => Promise<CompanionPerceptStats>;
};

type CompanionCameraMod = {
  checkCameraAvailability: () => Promise<Record<string, unknown>>;
  captureCameraSnapshot: (options: {
    cwd?: string;
    outputPath?: string;
    device?: string;
    timeoutMs?: number;
  }) => Promise<CameraSnapshotResult>;
};

type CompanionSelfEvaluationMod = {
  evaluateCompanionSelf: (options: {
    cwd?: string;
    recordSuggestions?: boolean;
  }) => Promise<CompanionSelfEvaluation>;
};

const NO_PROJECT = 'NO_ACTIVE_PROJECT';

async function companionWorkDir(
  source: ProjectManagerSource,
  projectId?: string,
): Promise<{ cwd: string | null; error?: string }> {
  const cwd = resolveWorkDir(source, projectId);
  if (!cwd) return { cwd: null, error: NO_PROJECT };
  return { cwd };
}

async function loadMode(): Promise<CompanionModeMod | null> {
  return loadCoreModule<CompanionModeMod>('companion/companion-mode.js');
}

async function loadPercepts(): Promise<CompanionPerceptsMod | null> {
  return loadCoreModule<CompanionPerceptsMod>('companion/percepts.js');
}

async function loadCamera(): Promise<CompanionCameraMod | null> {
  return loadCoreModule<CompanionCameraMod>('companion/camera.js');
}

async function loadSelfEvaluation(): Promise<CompanionSelfEvaluationMod | null> {
  return loadCoreModule<CompanionSelfEvaluationMod>('companion/self-evaluation.js');
}

export function registerCompanionIpcHandlers(projectManagerSource: ProjectManagerSource): void {
  ipcMain.handle('companion.status', async (_e, projectId?: string) => {
    const { cwd, error } = await companionWorkDir(projectManagerSource, projectId);
    if (!cwd) return { ok: false as const, error };
    try {
      const mod = await loadMode();
      if (!mod?.getCompanionStatus) return { ok: false as const, error: 'core companion module unavailable' };
      return { ok: true as const, status: await mod.getCompanionStatus({ cwd }) };
    } catch (err) {
      logError('[companion.status] failed:', err);
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  ipcMain.handle(
    'companion.percepts.recent',
    async (
      _e,
      input?: { limit?: number; modality?: CompanionPerceptModality; projectId?: string },
    ) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error, items: [] as CompanionPercept[] };
      try {
        const mod = await loadPercepts();
        if (!mod?.readRecentCompanionPercepts) {
          return { ok: false as const, error: 'core percept module unavailable', items: [] as CompanionPercept[] };
        }
        return {
          ok: true as const,
          items: await mod.readRecentCompanionPercepts({
            cwd,
            limit: input?.limit,
            modality: input?.modality,
          }),
        };
      } catch (err) {
        logError('[companion.percepts.recent] failed:', err);
        return { ok: false as const, error: errorMessage(err), items: [] as CompanionPercept[] };
      }
    },
  );

  ipcMain.handle('companion.percepts.stats', async (_e, projectId?: string) => {
    const { cwd, error } = await companionWorkDir(projectManagerSource, projectId);
    if (!cwd) return { ok: false as const, error };
    try {
      const mod = await loadPercepts();
      if (!mod?.getCompanionPerceptStats) {
        return { ok: false as const, error: 'core percept module unavailable' };
      }
      return { ok: true as const, stats: await mod.getCompanionPerceptStats({ cwd }) };
    } catch (err) {
      logError('[companion.percepts.stats] failed:', err);
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  ipcMain.handle('companion.self.record', async (_e, projectId?: string) => {
    const { cwd, error } = await companionWorkDir(projectManagerSource, projectId);
    if (!cwd) return { ok: false as const, error };
    try {
      const mod = await loadMode();
      if (!mod?.recordCompanionSelfState) {
        return { ok: false as const, error: 'core companion module unavailable' };
      }
      return { ok: true as const, percept: await mod.recordCompanionSelfState({ cwd }) };
    } catch (err) {
      logError('[companion.self.record] failed:', err);
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  ipcMain.handle(
    'companion.evaluate',
    async (_e, input?: { projectId?: string; recordSuggestions?: boolean }) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      try {
        const mod = await loadSelfEvaluation();
        if (!mod?.evaluateCompanionSelf) {
          return { ok: false as const, error: 'core self-evaluation module unavailable' };
        }
        return {
          ok: true as const,
          evaluation: await mod.evaluateCompanionSelf({
            cwd,
            recordSuggestions: input?.recordSuggestions !== false,
          }),
        };
      } catch (err) {
        logError('[companion.evaluate] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle('companion.camera.status', async () => {
    try {
      const mod = await loadCamera();
      if (!mod?.checkCameraAvailability) {
        return { ok: false as const, error: 'core camera module unavailable' };
      }
      return { ok: true as const, status: await mod.checkCameraAvailability() };
    } catch (err) {
      logError('[companion.camera.status] failed:', err);
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  ipcMain.handle(
    'companion.camera.snapshot',
    async (
      _e,
      input?: { outputPath?: string; device?: string; timeoutMs?: number; projectId?: string },
    ) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      try {
        const mod = await loadCamera();
        if (!mod?.captureCameraSnapshot) {
          return { ok: false as const, error: 'core camera module unavailable' };
        }
        const result = await mod.captureCameraSnapshot({
          cwd,
          outputPath: input?.outputPath,
          device: input?.device,
          timeoutMs: input?.timeoutMs,
        });
        if (!result.success) {
          return { ok: false as const, error: result.error ?? 'camera snapshot failed', result };
        }
        return { ok: true as const, result };
      } catch (err) {
        logError('[companion.camera.snapshot] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );
}
