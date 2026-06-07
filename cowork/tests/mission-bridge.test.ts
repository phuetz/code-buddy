/**
 * Mission Bridge tests.
 *
 * The bridge is intentionally pure main-process code: it wires MissionManager
 * events, boot recovery, heartbeat and DAG scheduling without importing
 * Electron or registering IPC.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MissionBridge, type MissionBridgeServerEvent } from '../src/main/missions/mission-bridge';
import { MissionStore } from '../src/main/missions/mission-store';
import { MissionStatus, SubTaskStatus } from '../src/main/missions/mission-types';

function makeClock(startMs = Date.UTC(2026, 5, 7, 12, 0, 0)): () => string {
  let t = startMs;
  return () => {
    const iso = new Date(t).toISOString();
    t += 1000;
    return iso;
  };
}

function makeIds(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}_${++n}`;
}

const iso = (ms: number) => new Date(ms).toISOString();
const BASE = Date.UTC(2026, 5, 7, 12, 0, 0);

let baseDir: string;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-bridge-'));
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

function newBridge(events: MissionBridgeServerEvent[] = []): MissionBridge {
  return new MissionBridge({
    store: new MissionStore({ baseDir }),
    now: makeClock(),
    idFactory: makeIds(),
    sendToRenderer: (event) => events.push(event),
    heartbeatIntervalMs: 15 * 60_000,
  });
}

describe('MissionBridge', () => {
  it('streams mission lifecycle events through the injected sender', async () => {
    const events: MissionBridgeServerEvent[] = [];
    const bridge = newBridge(events);
    await bridge.init({ recoverInterrupted: false });

    const mission = await bridge.createMission({ title: 'Bridge mission' });
    await bridge.updateStatus(mission.id, MissionStatus.Running);

    expect(events.map((event) => event.type)).toEqual([
      'mission.created',
      'mission.event',
      'mission.event',
      'mission.updated',
    ]);
    expect(bridge.listMissions().map((item) => item.id)).toEqual([mission.id]);
    bridge.dispose();
  });

  it('applies boot recovery during init and streams the recovery events', async () => {
    const first = newBridge();
    await first.init({ recoverInterrupted: false });
    const mission = await first.createMission({ title: 'Interrupted' });
    await first.updateStatus(mission.id, MissionStatus.Running);
    first.dispose();

    const events: MissionBridgeServerEvent[] = [];
    const recovered = newBridge(events);
    const applied = await recovered.init();

    expect(applied.map((item) => item.missionId)).toEqual([mission.id]);
    expect(recovered.getMission(mission.id)?.status).toBe(MissionStatus.Paused);
    expect(events.some((event) => event.type === 'mission.event')).toBe(true);
    expect(events.some((event) => event.type === 'mission.updated')).toBe(true);
    recovered.dispose();
  });

  it('exposes ready sub-tasks and heartbeat ticks without dispatching execution', async () => {
    const events: MissionBridgeServerEvent[] = [];
    const bridge = newBridge(events);
    await bridge.init({ recoverInterrupted: false });
    const mission = await bridge.createMission({
      title: 'DAG',
      status: MissionStatus.Running,
      subTasks: [
        { id: 'research', title: 'Research' },
        { id: 'write', title: 'Write', dependsOn: ['research'] },
      ],
    });

    expect(bridge.readySubTasks(mission.id).map((subTask) => subTask.id)).toEqual(['research']);
    await bridge.manager.updateSubTaskStatus(mission.id, 'research', SubTaskStatus.Completed);
    expect(bridge.readySubTasks(mission.id).map((subTask) => subTask.id)).toEqual(['write']);

    const due = await bridge.tickHeartbeat(iso(BASE + 20 * 60_000));

    expect(due.map((item) => item.id)).toEqual([mission.id]);
    expect(events.some((event) => event.type === 'mission.heartbeat')).toBe(true);
    expect(events.every((event) => event.type !== 'mission.dispatch')).toBe(true);
    bridge.dispose();
  });
});
