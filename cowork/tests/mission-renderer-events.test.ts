import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAppStore } from '../src/renderer/store';
import { MissionStatus, type Mission, type MissionEvent } from '../src/main/missions/mission-types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const createdEvent: MissionEvent = {
  ts: '2026-06-07T10:00:00.000Z',
  type: 'created',
  message: 'Mission created: renderer bridge',
};

const progressEvent: MissionEvent = {
  ts: '2026-06-07T10:01:00.000Z',
  type: 'progress',
  message: 'Renderer observed mission progress',
};

function sampleMission(events: MissionEvent[] = [createdEvent]): Mission {
  return {
    id: 'mission-renderer-1',
    title: 'Renderer mission wiring',
    description: 'Prove the renderer can consume MissionBridge events.',
    status: MissionStatus.Running,
    subTasks: [],
    progress: 10,
    createdAt: '2026-06-07T10:00:00.000Z',
    updatedAt: '2026-06-07T10:01:00.000Z',
    events,
    costUsd: 0,
    tokens: 0,
  };
}

describe('Mission renderer event readiness', () => {
  beforeEach(() => {
    useAppStore.setState({
      missionRuntime: {},
      missionRuntimeEvents: {},
      missionRuntimeHeartbeats: {},
    });
  });

  it('stores mission snapshots emitted by the main bridge', () => {
    const mission = sampleMission();

    useAppStore.getState().upsertMissionRuntime(mission);

    expect(useAppStore.getState().missionRuntime[mission.id]).toMatchObject({
      id: mission.id,
      title: mission.title,
      status: MissionStatus.Running,
    });
    expect(useAppStore.getState().missionRuntimeEvents[mission.id]).toEqual([createdEvent]);
  });

  it('keeps mission events even when they arrive before the canonical snapshot', () => {
    const store = useAppStore.getState();

    store.applyMissionRuntimeEvent({
      missionId: 'mission-renderer-1',
      event: progressEvent,
    });

    expect(useAppStore.getState().missionRuntimeEvents['mission-renderer-1']).toEqual([
      progressEvent,
    ]);

    useAppStore.getState().upsertMissionRuntime(sampleMission([createdEvent, progressEvent]));

    expect(useAppStore.getState().missionRuntimeEvents['mission-renderer-1']).toEqual([
      createdEvent,
      progressEvent,
    ]);
  });

  it('deduplicates mission events already included in a stored mission', () => {
    const mission = sampleMission();
    const store = useAppStore.getState();

    store.upsertMissionRuntime(mission);
    store.applyMissionRuntimeEvent({ missionId: mission.id, event: createdEvent });

    expect(useAppStore.getState().missionRuntimeEvents[mission.id]).toEqual([createdEvent]);
    expect(useAppStore.getState().missionRuntime[mission.id]?.events).toEqual([createdEvent]);
  });

  it('records mission heartbeat timestamps for liveness badges', () => {
    useAppStore
      .getState()
      .markMissionRuntimeHeartbeat('mission-renderer-1', '2026-06-07T10:02:00.000Z');

    expect(useAppStore.getState().missionRuntimeHeartbeats['mission-renderer-1']).toBe(
      '2026-06-07T10:02:00.000Z'
    );
  });

  it('declares and routes all MissionBridge server event variants', () => {
    const root = path.resolve(__dirname, '..');
    const typesSource = readFileSync(path.join(root, 'src/renderer/types/index.ts'), 'utf8');
    const ipcSource = readFileSync(path.join(root, 'src/renderer/hooks/useIPC.ts'), 'utf8');
    const storeSource = readFileSync(path.join(root, 'src/renderer/store/index.ts'), 'utf8');

    for (const eventType of [
      'mission.created',
      'mission.updated',
      'mission.event',
      'mission.heartbeat',
    ]) {
      expect(typesSource).toContain(`type: '${eventType}'`);
      expect(ipcSource).toContain(`case '${eventType}'`);
    }
    expect(storeSource).toContain('upsertMissionRuntime');
    expect(storeSource).toContain('applyMissionRuntimeEvent');
    expect(storeSource).toContain('markMissionRuntimeHeartbeat');
  });
});
