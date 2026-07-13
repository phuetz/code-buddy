/**
 * Mission Bridge tests.
 *
 * The bridge is intentionally pure main-process code: it wires MissionManager
 * events, boot recovery, heartbeat and DAG scheduling without importing
 * Electron or registering IPC.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MissionBridge, type MissionBridgeServerEvent } from '../src/main/missions/mission-bridge';
import { MissionStore } from '../src/main/missions/mission-store';
import { MissionStatus, SubTaskStatus } from '../src/main/missions/mission-types';
import { VOICE_MISSION_EVENT } from '../src/shared/voice-background-mission';

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

  it('persists a voice mission before starting the existing background session', async () => {
    const events: MissionBridgeServerEvent[] = [];
    const store = new MissionStore({ baseDir });
    const executeVoiceMission = vi.fn(async ({ missionId }: { missionId: string }) => {
      expect(await store.load(missionId)).not.toBeNull();
      return { sessionId: 'session-voice-1' };
    });
    const bridge = new MissionBridge({
      store,
      now: makeClock(),
      idFactory: makeIds('voice'),
      sendToRenderer: (event) => events.push(event),
      executeVoiceMission,
    });
    await bridge.init({ recoverInterrupted: false });

    const queued = await bridge.createVoiceMission({
      prompt: 'Fais une recherche approfondie et prépare un rapport.',
      cwd: '/workspace',
      projectId: 'project-1',
    });

    expect(queued.status).toBe(MissionStatus.Running);
    expect(queued.events.some((event) => event.type === VOICE_MISSION_EVENT.queued)).toBe(true);
    expect(executeVoiceMission).toHaveBeenCalledTimes(1);
    expect(executeVoiceMission).toHaveBeenCalledWith(
      expect.objectContaining({
        missionId: queued.id,
        cwd: '/workspace',
        projectId: 'project-1',
        prompt: expect.stringContaining('<external_action_policy>'),
      }),
    );
    expect(bridge.getMission(queued.id)?.progress).toBe(0);
    expect(
      bridge
        .getMission(queued.id)
        ?.events.some((event) => event.type === VOICE_MISSION_EVENT.sessionStarted),
    ).toBe(true);
    expect(events.some((event) => event.type === 'mission.created')).toBe(true);
    bridge.dispose();
  });

  it('settles a voice session, keeps its result session, and restores it after restart', async () => {
    const bridge = new MissionBridge({
      store: new MissionStore({ baseDir }),
      now: makeClock(),
      idFactory: makeIds('voice'),
      executeVoiceMission: async () => ({ sessionId: 'session-result-1' }),
    });
    await bridge.init({ recoverInterrupted: false });
    const mission = await bridge.createVoiceMission({ prompt: 'Prépare un rapport complet.' });
    await vi.waitFor(() => expect(bridge.getMission(mission.id)?.status).toBe(MissionStatus.Running));

    const completed = await bridge.settleVoiceSession({
      sessionId: 'session-result-1',
      status: 'completed',
      resultPreview: 'Le rapport est prêt.',
    });

    expect(completed?.status).toBe(MissionStatus.Completed);
    expect(completed?.progress).toBe(100);
    expect(completed?.subTasks[0]?.result).toMatchObject({
      sessionId: 'session-result-1',
      preview: 'Le rapport est prêt.',
    });
    bridge.dispose();

    const restored = new MissionBridge({ store: new MissionStore({ baseDir }) });
    await restored.init();
    expect(restored.getMission(mission.id)?.status).toBe(MissionStatus.Completed);
    expect(
      restored
        .getMission(mission.id)
        ?.events.some((event) => event.type === VOICE_MISSION_EVENT.completed),
    ).toBe(true);
    restored.dispose();
  });

  it('cancels the linked session only through explicit mission cancellation', async () => {
    const cancelVoiceSession = vi.fn();
    const bridge = new MissionBridge({
      store: new MissionStore({ baseDir }),
      now: makeClock(),
      idFactory: makeIds('voice'),
      executeVoiceMission: async () => ({ sessionId: 'session-cancel-1' }),
      cancelVoiceSession,
    });
    await bridge.init({ recoverInterrupted: false });
    const mission = await bridge.createVoiceMission({ prompt: 'Analyse ces données.' });
    await vi.waitFor(() => expect(bridge.getMission(mission.id)?.status).toBe(MissionStatus.Running));

    const cancelled = await bridge.cancel(mission.id);

    expect(cancelVoiceSession).toHaveBeenCalledWith('session-cancel-1');
    expect(cancelled.status).toBe(MissionStatus.Cancelled);
    bridge.dispose();
  });

  it('never resurrects a mission cancelled while its background session is starting', async () => {
    let resolveExecution: ((value: { sessionId: string }) => void) | undefined;
    let signalExecutionStarted: (() => void) | undefined;
    const executionStarted = new Promise<void>((resolve) => {
      signalExecutionStarted = resolve;
    });
    const execution = new Promise<{ sessionId: string }>((resolve) => {
      resolveExecution = resolve;
    });
    const cancelVoiceSession = vi.fn();
    const bridge = new MissionBridge({
      store: new MissionStore({ baseDir }),
      now: makeClock(),
      idFactory: makeIds('race'),
      executeVoiceMission: () => {
        signalExecutionStarted?.();
        return execution;
      },
      cancelVoiceSession,
    });
    await bridge.init({ recoverInterrupted: false });

    const creation = bridge.createVoiceMission({ prompt: 'Prépare un long rapport.' });
    await executionStarted;
    const missionId = bridge.listMissions()[0]!.id;
    await bridge.cancel(missionId);
    resolveExecution?.({ sessionId: 'late-session' });
    await creation;

    expect(bridge.getMission(missionId)?.status).toBe(MissionStatus.Cancelled);
    expect(cancelVoiceSession).toHaveBeenCalledWith('late-session');
    bridge.dispose();
  });

  it('never rewrites a mission to running when its session completes during startup persistence', async () => {
    let releaseStartedEvent: (() => void) | undefined;
    let signalStartedEvent: (() => void) | undefined;
    const startedEventEntered = new Promise<void>((resolve) => {
      signalStartedEvent = resolve;
    });
    const startedEventGate = new Promise<void>((resolve) => {
      releaseStartedEvent = resolve;
    });
    const bridge = new MissionBridge({
      store: new MissionStore({ baseDir }),
      now: makeClock(),
      idFactory: makeIds('settle-race'),
      executeVoiceMission: async () => ({ sessionId: 'fast-session' }),
    });
    await bridge.init({ recoverInterrupted: false });
    const originalRecordEvent = bridge.manager.recordEvent.bind(bridge.manager);
    vi.spyOn(bridge.manager, 'recordEvent').mockImplementation(async (missionId, event) => {
      const persisted = await originalRecordEvent(missionId, event);
      if (event.type === VOICE_MISSION_EVENT.sessionStarted) {
        signalStartedEvent?.();
        await startedEventGate;
      }
      return persisted;
    });

    const creation = bridge.createVoiceMission({ prompt: 'Prépare une synthèse.' });
    await startedEventEntered;
    await bridge.settleVoiceSession({
      sessionId: 'fast-session',
      status: 'completed',
      resultPreview: 'Terminé très vite.',
    });
    releaseStartedEvent?.();
    const mission = await creation;

    expect(bridge.getMission(mission.id)?.status).toBe(MissionStatus.Completed);
    expect(bridge.getMission(mission.id)?.progress).toBe(100);
    bridge.dispose();
  });

  it('reconciles a persisted voice session with SessionManager state after restart', async () => {
    const first = new MissionBridge({
      store: new MissionStore({ baseDir }),
      now: makeClock(),
      idFactory: makeIds('recover'),
      executeVoiceMission: async () => ({ sessionId: 'persisted-session' }),
    });
    await first.init({ recoverInterrupted: false });
    const mission = await first.createVoiceMission({ prompt: 'Prépare un dossier complet.' });
    expect(mission.status).toBe(MissionStatus.Running);
    first.dispose();

    const restored = new MissionBridge({
      store: new MissionStore({ baseDir }),
      inspectVoiceSession: () => 'completed',
    });
    await restored.init();

    expect(restored.getMission(mission.id)?.status).toBe(MissionStatus.Completed);
    expect(restored.getMission(mission.id)?.progress).toBe(100);
    restored.dispose();
  });
});
