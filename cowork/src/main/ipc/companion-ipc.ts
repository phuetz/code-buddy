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

interface CompanionCompetitiveGap {
  id: string;
  dimension: string;
  severity: 'lead' | 'parity' | 'gap';
  summary: string;
  recommendation: string;
  competitorRefs: string[];
  command?: string;
  tags: string[];
}

interface CompanionCompetitiveRadar {
  id: string;
  timestamp: string;
  cwd: string;
  score: number;
  currentStrengths: string[];
  gaps: CompanionCompetitiveGap[];
  nextMoves: string[];
  sourceNotes: string[];
}

type CompanionImpulseKind = 'readiness' | 'sense' | 'mission' | 'safety' | 'memory' | 'conversation';
type CompanionImpulsePriority = 'high' | 'medium' | 'low';

interface CompanionImpulse {
  id: string;
  kind: CompanionImpulseKind;
  priority: CompanionImpulsePriority;
  title: string;
  message: string;
  command?: string;
  evidence: Array<{ label: string; value: string }>;
  tags: string[];
}

interface CompanionImpulseBrief {
  id: string;
  timestamp: string;
  cwd: string;
  summary: string;
  nextPrompt: string;
  impulses: CompanionImpulse[];
  context: {
    perceptTotal: number;
    openMissions: number;
    inProgressMissions: number;
    safetyEvents: number;
    latestPerceptTimestamp?: string;
    latestSafetyTimestamp?: string;
  };
}

type CompanionMissionStatus = 'open' | 'in_progress' | 'done' | 'dismissed';
type CompanionSafetyEventKind = 'sense' | 'tool' | 'mission' | 'permission' | 'data';
type CompanionSafetyEventRisk = 'low' | 'medium' | 'high';
type CompanionSafetyEventStatus = 'planned' | 'allowed' | 'completed' | 'failed' | 'denied';

interface CompanionMission {
  id: string;
  title: string;
  dimension: string;
  status: CompanionMissionStatus;
  priority: 'P0' | 'P1' | 'P2';
  summary: string;
  recommendation: string;
  sourceGapId: string;
  sourceRadarId?: string;
  competitorRefs: string[];
  command?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

interface CompanionMissionBoard {
  schemaVersion: 1;
  cwd: string;
  storePath: string;
  updatedAt: string;
  missions: CompanionMission[];
}

interface CompanionMissionBoardSyncResult {
  board: CompanionMissionBoard;
  radarId: string;
  created: number;
  updated: number;
  unchanged: number;
}

interface CompanionMissionRunResult {
  success: boolean;
  dryRun: boolean;
  message: string;
  mission?: CompanionMission;
  board?: CompanionMissionBoard;
  brief?: string;
  briefPath?: string;
  perceptId?: string;
  safetyEventId?: string;
  syncedBoard?: boolean;
}

interface CompanionSafetyEvent {
  id: string;
  timestamp: string;
  cwd: string;
  kind: CompanionSafetyEventKind;
  risk: CompanionSafetyEventRisk;
  action: string;
  reason: string;
  status: CompanionSafetyEventStatus;
  source: string;
  artifactPath?: string;
  missionId?: string;
  payload: Record<string, unknown>;
  tags: string[];
}

interface CompanionSafetyLedgerStats {
  ledgerPath: string;
  exists: boolean;
  total: number;
  byKind: Partial<Record<CompanionSafetyEventKind, number>>;
  byRisk: Partial<Record<CompanionSafetyEventRisk, number>>;
  byStatus: Partial<Record<CompanionSafetyEventStatus, number>>;
  latestTimestamp?: string;
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

type CompanionCompetitiveRadarMod = {
  buildCompanionCompetitiveRadar: (options: {
    cwd?: string;
    recordSuggestions?: boolean;
  }) => Promise<CompanionCompetitiveRadar>;
};

type CompanionImpulsesMod = {
  buildCompanionImpulseBrief: (options: {
    cwd?: string;
    recordSuggestions?: boolean;
  }) => Promise<CompanionImpulseBrief>;
};

type CompanionMissionBoardMod = {
  syncCompanionMissionBoard: (options: {
    cwd?: string;
    recordSuggestions?: boolean;
  }) => Promise<CompanionMissionBoardSyncResult>;
  readCompanionMissionBoard: (options: { cwd?: string }) => Promise<CompanionMissionBoard>;
  updateCompanionMissionStatus: (
    id: string,
    status: CompanionMissionStatus,
    options: { cwd?: string },
  ) => Promise<CompanionMission>;
};

type CompanionMissionRunnerMod = {
  runNextCompanionMission: (options: {
    cwd?: string;
    dryRun?: boolean;
  }) => Promise<CompanionMissionRunResult>;
};

type CompanionSafetyLedgerMod = {
  readRecentCompanionSafetyEvents: (options: {
    cwd?: string;
    limit?: number;
    kind?: CompanionSafetyEventKind;
    risk?: CompanionSafetyEventRisk;
  }) => Promise<CompanionSafetyEvent[]>;
  getCompanionSafetyLedgerStats: (options: { cwd?: string }) => Promise<CompanionSafetyLedgerStats>;
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

async function loadCompetitiveRadar(): Promise<CompanionCompetitiveRadarMod | null> {
  return loadCoreModule<CompanionCompetitiveRadarMod>('companion/competitive-radar.js');
}

async function loadImpulses(): Promise<CompanionImpulsesMod | null> {
  return loadCoreModule<CompanionImpulsesMod>('companion/impulses.js');
}

async function loadMissionBoard(): Promise<CompanionMissionBoardMod | null> {
  return loadCoreModule<CompanionMissionBoardMod>('companion/mission-board.js');
}

async function loadMissionRunner(): Promise<CompanionMissionRunnerMod | null> {
  return loadCoreModule<CompanionMissionRunnerMod>('companion/mission-runner.js');
}

async function loadSafetyLedger(): Promise<CompanionSafetyLedgerMod | null> {
  return loadCoreModule<CompanionSafetyLedgerMod>('companion/safety-ledger.js');
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

  ipcMain.handle(
    'companion.radar',
    async (_e, input?: { projectId?: string; recordSuggestions?: boolean }) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      try {
        const mod = await loadCompetitiveRadar();
        if (!mod?.buildCompanionCompetitiveRadar) {
          return { ok: false as const, error: 'core competitive radar module unavailable' };
        }
        return {
          ok: true as const,
          radar: await mod.buildCompanionCompetitiveRadar({
            cwd,
            recordSuggestions: input?.recordSuggestions !== false,
          }),
        };
      } catch (err) {
        logError('[companion.radar] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'companion.impulses',
    async (_e, input?: { projectId?: string; recordSuggestions?: boolean }) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      try {
        const mod = await loadImpulses();
        if (!mod?.buildCompanionImpulseBrief) {
          return { ok: false as const, error: 'core companion impulses module unavailable' };
        }
        return {
          ok: true as const,
          brief: await mod.buildCompanionImpulseBrief({
            cwd,
            recordSuggestions: input?.recordSuggestions !== false,
          }),
        };
      } catch (err) {
        logError('[companion.impulses] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'companion.missions.sync',
    async (_e, input?: { projectId?: string; recordSuggestions?: boolean }) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      try {
        const mod = await loadMissionBoard();
        if (!mod?.syncCompanionMissionBoard) {
          return { ok: false as const, error: 'core mission board module unavailable' };
        }
        return {
          ok: true as const,
          result: await mod.syncCompanionMissionBoard({
            cwd,
            recordSuggestions: input?.recordSuggestions !== false,
          }),
        };
      } catch (err) {
        logError('[companion.missions.sync] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'companion.missions.list',
    async (_e, input?: { projectId?: string; status?: CompanionMissionStatus }) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error, items: [] as CompanionMission[] };
      try {
        const mod = await loadMissionBoard();
        if (!mod?.readCompanionMissionBoard) {
          return { ok: false as const, error: 'core mission board module unavailable', items: [] as CompanionMission[] };
        }
        const board = await mod.readCompanionMissionBoard({ cwd });
        return {
          ok: true as const,
          board,
          items: board.missions.filter(mission => !input?.status || mission.status === input.status),
        };
      } catch (err) {
        logError('[companion.missions.list] failed:', err);
        return { ok: false as const, error: errorMessage(err), items: [] as CompanionMission[] };
      }
    },
  );

  ipcMain.handle(
    'companion.missions.update',
    async (_e, input?: { projectId?: string; missionId?: string; status?: CompanionMissionStatus }) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      if (!input?.missionId || !input.status) {
        return { ok: false as const, error: 'missionId and status are required' };
      }
      try {
        const mod = await loadMissionBoard();
        if (!mod?.updateCompanionMissionStatus) {
          return { ok: false as const, error: 'core mission board module unavailable' };
        }
        return {
          ok: true as const,
          mission: await mod.updateCompanionMissionStatus(input.missionId, input.status, { cwd }),
        };
      } catch (err) {
        logError('[companion.missions.update] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'companion.missions.runNext',
    async (_e, input?: { projectId?: string; dryRun?: boolean }) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      try {
        const mod = await loadMissionRunner();
        if (!mod?.runNextCompanionMission) {
          return { ok: false as const, error: 'core mission runner module unavailable' };
        }
        return {
          ok: true as const,
          result: await mod.runNextCompanionMission({
            cwd,
            dryRun: Boolean(input?.dryRun),
          }),
        };
      } catch (err) {
        logError('[companion.missions.runNext] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'companion.safety.recent',
    async (
      _e,
      input?: {
        projectId?: string;
        limit?: number;
        kind?: CompanionSafetyEventKind;
        risk?: CompanionSafetyEventRisk;
      },
    ) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error, items: [] as CompanionSafetyEvent[] };
      try {
        const mod = await loadSafetyLedger();
        if (!mod?.readRecentCompanionSafetyEvents) {
          return { ok: false as const, error: 'core safety ledger module unavailable', items: [] as CompanionSafetyEvent[] };
        }
        return {
          ok: true as const,
          items: await mod.readRecentCompanionSafetyEvents({
            cwd,
            limit: input?.limit,
            kind: input?.kind,
            risk: input?.risk,
          }),
        };
      } catch (err) {
        logError('[companion.safety.recent] failed:', err);
        return { ok: false as const, error: errorMessage(err), items: [] as CompanionSafetyEvent[] };
      }
    },
  );

  ipcMain.handle('companion.safety.stats', async (_e, projectId?: string) => {
    const { cwd, error } = await companionWorkDir(projectManagerSource, projectId);
    if (!cwd) return { ok: false as const, error };
    try {
      const mod = await loadSafetyLedger();
      if (!mod?.getCompanionSafetyLedgerStats) {
        return { ok: false as const, error: 'core safety ledger module unavailable' };
      }
      return { ok: true as const, stats: await mod.getCompanionSafetyLedgerStats({ cwd }) };
    } catch (err) {
      logError('[companion.safety.stats] failed:', err);
      return { ok: false as const, error: errorMessage(err) };
    }
  });

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
