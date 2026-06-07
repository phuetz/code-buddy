import { ipcMain } from 'electron';
import type { MissionBridge } from '../missions/mission-bridge';
import type {
  Mission,
  MissionCreateInput,
  MissionFilter,
  MissionStatus,
  SubTask,
} from '../missions/mission-types';

type MissionBridgeSource = MissionBridge | null | (() => MissionBridge | null);

function resolveBridge(source: MissionBridgeSource): MissionBridge | null {
  return typeof source === 'function' ? source() : source;
}

function unavailable(extra: Record<string, unknown> = {}) {
  return { ok: false as const, error: 'MissionBridge not initialized', ...extra };
}

export type MissionListResult =
  | { ok: true; missions: Mission[] }
  | { ok: false; error: string; missions: [] };

export type MissionItemResult =
  | { ok: true; mission: Mission | null }
  | { ok: false; error: string; mission: null };

export type MissionReadySubTasksResult =
  | { ok: true; subTasks: SubTask[] }
  | { ok: false; error: string; subTasks: [] };

export function registerMissionIpcHandlers(source: MissionBridgeSource) {
  ipcMain.handle('mission.list', async (_event, filter?: MissionFilter): Promise<MissionListResult> => {
    const bridge = resolveBridge(source);
    if (!bridge) return unavailable({ missions: [] }) as MissionListResult;
    return { ok: true, missions: bridge.listMissions(filter) };
  });

  ipcMain.handle('mission.get', async (_event, missionId?: string): Promise<MissionItemResult> => {
    if (!missionId) return { ok: false, error: 'missionId is required', mission: null };
    const bridge = resolveBridge(source);
    if (!bridge) return unavailable({ mission: null }) as MissionItemResult;
    return { ok: true, mission: bridge.getMission(missionId) };
  });

  ipcMain.handle('mission.create', async (_event, input?: MissionCreateInput): Promise<MissionItemResult> => {
    if (!input?.title?.trim()) {
      return { ok: false, error: 'title is required', mission: null };
    }
    const bridge = resolveBridge(source);
    if (!bridge) return unavailable({ mission: null }) as MissionItemResult;
    return { ok: true, mission: await bridge.createMission(input) };
  });

  ipcMain.handle(
    'mission.updateStatus',
    async (
      _event,
      input?: { missionId?: string; status?: MissionStatus }
    ): Promise<MissionItemResult> => {
      if (!input?.missionId || !input.status) {
        return { ok: false, error: 'missionId and status are required', mission: null };
      }
      const bridge = resolveBridge(source);
      if (!bridge) return unavailable({ mission: null }) as MissionItemResult;
      return { ok: true, mission: await bridge.updateStatus(input.missionId, input.status) };
    }
  );

  ipcMain.handle('mission.cancel', async (_event, missionId?: string): Promise<MissionItemResult> => {
    if (!missionId) return { ok: false, error: 'missionId is required', mission: null };
    const bridge = resolveBridge(source);
    if (!bridge) return unavailable({ mission: null }) as MissionItemResult;
    return { ok: true, mission: await bridge.cancel(missionId) };
  });

  ipcMain.handle(
    'mission.readySubTasks',
    async (_event, missionId?: string): Promise<MissionReadySubTasksResult> => {
      if (!missionId) return { ok: false, error: 'missionId is required', subTasks: [] };
      const bridge = resolveBridge(source);
      if (!bridge) return unavailable({ subTasks: [] }) as MissionReadySubTasksResult;
      return { ok: true, subTasks: bridge.readySubTasks(missionId) };
    }
  );

  ipcMain.handle('mission.tickHeartbeat', async (_event, now?: string): Promise<MissionListResult> => {
    const bridge = resolveBridge(source);
    if (!bridge) return unavailable({ missions: [] }) as MissionListResult;
    return { ok: true, missions: await bridge.tickHeartbeat(now) };
  });
}
