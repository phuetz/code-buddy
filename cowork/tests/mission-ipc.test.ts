import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  };
});

vi.mock('electron', () => ({ ipcMain: { handle: electronMock.handle } }));

import { registerMissionIpcHandlers } from '../src/main/ipc/mission-ipc';
import type { MissionBridge } from '../src/main/missions/mission-bridge';
import {
  MissionStatus,
  SubTaskStatus,
  type Mission,
  type SubTask,
} from '../src/main/missions/mission-types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const mission: Mission = {
  id: 'mission-ipc-1',
  title: 'Wire Mission IPC',
  description: 'Expose MissionBridge through main-process handlers.',
  status: MissionStatus.Running,
  subTasks: [],
  progress: 0,
  createdAt: '2026-06-07T11:00:00.000Z',
  updatedAt: '2026-06-07T11:00:00.000Z',
  events: [],
  costUsd: 0,
  tokens: 0,
};

const readySubTask: SubTask = {
  id: 'research',
  title: 'Research IPC path',
  status: SubTaskStatus.Pending,
  progress: 0,
};

function makeBridge(overrides: Partial<MissionBridge> = {}): MissionBridge {
  return {
    listMissions: vi.fn(() => [mission]),
    getMission: vi.fn(() => mission),
    createMission: vi.fn(async () => mission),
    updateStatus: vi.fn(async () => ({ ...mission, status: MissionStatus.Completed })),
    cancel: vi.fn(async () => ({ ...mission, status: MissionStatus.Cancelled })),
    readySubTasks: vi.fn(() => [readySubTask]),
    tickHeartbeat: vi.fn(async () => [mission]),
    ...overrides,
  } as unknown as MissionBridge;
}

describe('mission IPC handlers', () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.handle.mockClear();
  });

  it('resolves the MissionBridge lazily after startup registration', async () => {
    let bridge: MissionBridge | null = null;
    registerMissionIpcHandlers(() => bridge);

    const list = electronMock.handlers.get('mission.list');
    expect(list).toBeDefined();
    await expect(list?.({})).resolves.toEqual({
      ok: false,
      error: 'MissionBridge not initialized',
      missions: [],
    });

    bridge = makeBridge();
    await expect(list?.({}, { status: MissionStatus.Running })).resolves.toEqual({
      ok: true,
      missions: [mission],
    });
    expect(bridge.listMissions).toHaveBeenCalledWith({ status: MissionStatus.Running });
  });

  it('routes create, status update, cancel, ready sub-tasks, and heartbeat ticks', async () => {
    const bridge = makeBridge();
    registerMissionIpcHandlers(bridge);

    await expect(
      electronMock.handlers.get('mission.create')?.({}, { title: 'Wire IPC' })
    ).resolves.toEqual({ ok: true, mission });
    await expect(
      electronMock.handlers.get('mission.updateStatus')?.({}, {
        missionId: mission.id,
        status: MissionStatus.Completed,
      })
    ).resolves.toMatchObject({ ok: true, mission: { status: MissionStatus.Completed } });
    await expect(electronMock.handlers.get('mission.cancel')?.({}, mission.id)).resolves.toMatchObject({
      ok: true,
      mission: { status: MissionStatus.Cancelled },
    });
    await expect(electronMock.handlers.get('mission.readySubTasks')?.({}, mission.id)).resolves.toEqual({
      ok: true,
      subTasks: [readySubTask],
    });
    await expect(
      electronMock.handlers.get('mission.tickHeartbeat')?.({}, '2026-06-07T11:05:00.000Z')
    ).resolves.toEqual({ ok: true, missions: [mission] });

    expect(bridge.createMission).toHaveBeenCalledWith({ title: 'Wire IPC' });
    expect(bridge.updateStatus).toHaveBeenCalledWith(mission.id, MissionStatus.Completed);
    expect(bridge.cancel).toHaveBeenCalledWith(mission.id);
    expect(bridge.readySubTasks).toHaveBeenCalledWith(mission.id);
    expect(bridge.tickHeartbeat).toHaveBeenCalledWith('2026-06-07T11:05:00.000Z');
  });

  it('validates required mission inputs before touching the bridge', async () => {
    const bridge = makeBridge();
    registerMissionIpcHandlers(bridge);

    await expect(
      electronMock.handlers.get('mission.create')?.({}, { title: '   ' })
    ).resolves.toMatchObject({
      ok: false,
      error: 'title is required',
    });
    await expect(
      electronMock.handlers.get('mission.updateStatus')?.({}, { missionId: mission.id })
    ).resolves.toMatchObject({
      ok: false,
      error: 'missionId and status are required',
    });
    await expect(electronMock.handlers.get('mission.readySubTasks')?.({})).resolves.toMatchObject({
      ok: false,
      error: 'missionId is required',
    });
    expect(bridge.createMission).not.toHaveBeenCalled();
    expect(bridge.updateStatus).not.toHaveBeenCalled();
    expect(bridge.readySubTasks).not.toHaveBeenCalled();
  });

  it('is wired at main-process boot and exposed through preload', () => {
    const root = path.resolve(__dirname, '..');
    const mainSource = readFileSync(path.join(root, 'src/main/index.ts'), 'utf8');
    const preloadSource = readFileSync(path.join(root, 'src/preload/index.ts'), 'utf8');

    expect(mainSource).toContain("import { MissionBridge } from './missions/mission-bridge'");
    expect(mainSource).toContain("import { registerMissionIpcHandlers } from './ipc/mission-ipc'");
    expect(mainSource).toContain('missionBridge = new MissionBridge({ sendToRenderer })');
    expect(mainSource).toContain('registerMissionIpcHandlers(() => missionBridge)');
    expect(preloadSource).toContain('missions: {');
    expect(preloadSource).toContain("ipcRenderer.invoke('mission.list'");
    expect(preloadSource).toContain("ipcRenderer.invoke('mission.updateStatus'");
  });
});
