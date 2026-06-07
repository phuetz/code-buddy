/**
 * Mission Orchestrator core tests (Phase 1).
 *
 * Exercises the PURE mission core — types + JSON store + manager state
 * machine + events — with no Electron, no IPC and no native modules. The
 * store is driven against a real `os.tmpdir()` directory so the atomic
 * temp+rename write and the concurrent-save case are genuinely tested.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MissionStore } from '../src/main/missions/mission-store';
import { MissionManager } from '../src/main/missions/mission-manager';
import {
  MissionStatus,
  SubTaskStatus,
  isTerminalStatus,
  type Mission,
  type MissionEvent,
} from '../src/main/missions/mission-types';

// ─── Deterministic clock + id factory ─────────────────────────────────

/** Monotonic ISO clock so createdAt/updatedAt ordering is stable in tests. */
function makeClock(startMs = Date.UTC(2026, 5, 7, 12, 0, 0)): () => string {
  let t = startMs;
  return () => {
    const iso = new Date(t).toISOString();
    t += 1000; // advance 1s per tick
    return iso;
  };
}

/** Sequential id factory so create→reload assertions are stable. */
function makeIds(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}_${++n}`;
}

let baseDir: string;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-core-'));
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

function freshManager(): MissionManager {
  const store = new MissionStore({ baseDir });
  return new MissionManager({ store, now: makeClock(), idFactory: makeIds() });
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('MissionManager — create, persist, reload', () => {
  it('creates a mission, persists it, and reloads from a FRESH store instance', async () => {
    const mgr = freshManager();
    const mission = await mgr.createMission({
      title: 'Ship Mission Board',
      description: 'Phase 1 foundation',
    });

    expect(mission.status).toBe(MissionStatus.Planning);
    expect(mission.progress).toBe(0);
    expect(mission.costUsd).toBe(0);
    expect(mission.tokens).toBe(0);
    // Creation event seeded in the very first persisted snapshot.
    expect(mission.events.map((e) => e.type)).toContain('created');

    // Simulate a restart: brand-new store + manager reading the same dir.
    const reloaded = new MissionManager({ store: new MissionStore({ baseDir }) });
    await reloaded.init();
    const back = reloaded.getMission(mission.id);
    expect(back).not.toBeNull();
    expect(back!.title).toBe('Ship Mission Board');
    expect(back!.description).toBe('Phase 1 foundation');
    expect(back!.events.some((e: MissionEvent) => e.type === 'created')).toBe(true);
  });

  it('seeds sub-tasks supplied at creation', async () => {
    const mgr = freshManager();
    const mission = await mgr.createMission({
      title: 'With subtasks',
      subTasks: [{ title: 'Research' }, { title: 'Implement' }],
    });
    expect(mission.subTasks).toHaveLength(2);
    expect(mission.subTasks[0]!.status).toBe(SubTaskStatus.Pending);
    expect(mission.subTasks[0]!.progress).toBe(0);
    expect(mission.subTasks[0]!.id).toBeTruthy();
  });
});

describe('MissionManager — progress recompute from sub-tasks', () => {
  it('progress = percentage of completed sub-tasks, zero subtasks = 0', async () => {
    const mgr = freshManager();
    const mission = await mgr.createMission({ title: 'progress' });
    expect(mission.progress).toBe(0); // no subtasks → no divide-by-zero

    await mgr.addSubTask(mission.id, { title: 'A' });
    await mgr.addSubTask(mission.id, { title: 'B' });
    await mgr.addSubTask(mission.id, { title: 'C' });
    await mgr.addSubTask(mission.id, { title: 'D' });
    expect(mgr.getMission(mission.id)!.progress).toBe(0);

    const subIds = mgr.getMission(mission.id)!.subTasks.map((s) => s.id);
    await mgr.updateSubTaskStatus(mission.id, subIds[0]!, SubTaskStatus.Completed);
    expect(mgr.getMission(mission.id)!.progress).toBe(25);

    await mgr.updateSubTaskStatus(mission.id, subIds[1]!, SubTaskStatus.Completed);
    await mgr.updateSubTaskStatus(mission.id, subIds[2]!, SubTaskStatus.Completed);
    expect(mgr.getMission(mission.id)!.progress).toBe(75);

    await mgr.updateSubTaskStatus(mission.id, subIds[3]!, SubTaskStatus.Completed);
    expect(mgr.getMission(mission.id)!.progress).toBe(100);
  });

  it('completing a sub-task forces its progress to 100', async () => {
    const mgr = freshManager();
    const m = await mgr.createMission({ title: 'p', subTasks: [{ title: 'X' }] });
    const id = m.subTasks[0]!.id;
    const updated = await mgr.updateSubTaskStatus(m.id, id, SubTaskStatus.Completed);
    expect(updated.subTasks[0]!.progress).toBe(100);
  });

  it('throws on an unknown sub-task id', async () => {
    const mgr = freshManager();
    const m = await mgr.createMission({ title: 'p' });
    await expect(
      mgr.updateSubTaskStatus(m.id, 'nope', SubTaskStatus.Running),
    ).rejects.toThrow(/Sub-task not found/);
  });
});

describe('MissionManager — status transitions', () => {
  it('transitions status and records an event', async () => {
    const mgr = freshManager();
    const m = await mgr.createMission({ title: 'states' });

    await mgr.updateStatus(m.id, MissionStatus.Running);
    expect(mgr.getMission(m.id)!.status).toBe(MissionStatus.Running);

    await mgr.updateStatus(m.id, MissionStatus.WaitingApproval);
    await mgr.updateStatus(m.id, MissionStatus.Paused);
    await mgr.updateStatus(m.id, MissionStatus.Running);
    await mgr.updateStatus(m.id, MissionStatus.Completed);

    const final = mgr.getMission(m.id)!;
    expect(final.status).toBe(MissionStatus.Completed);
    const transitions = final.events.filter((e) => e.type === 'status_changed');
    expect(transitions).toHaveLength(5);
    expect((transitions[0]!.data as { to: string }).to).toBe(MissionStatus.Running);
  });

  it('updating to the same status is a no-op (no event)', async () => {
    const mgr = freshManager();
    const m = await mgr.createMission({ title: 'noop', status: MissionStatus.Running });
    const before = mgr.getMission(m.id)!.events.length;
    await mgr.updateStatus(m.id, MissionStatus.Running);
    expect(mgr.getMission(m.id)!.events.length).toBe(before);
  });

  it('persists status transitions across reload', async () => {
    const mgr = freshManager();
    const m = await mgr.createMission({ title: 'persist-status' });
    await mgr.updateStatus(m.id, MissionStatus.Running);

    const reloaded = new MissionManager({ store: new MissionStore({ baseDir }) });
    await reloaded.init();
    expect(reloaded.getMission(m.id)!.status).toBe(MissionStatus.Running);
  });
});

describe('MissionManager — cancel', () => {
  it('cancels a mission and marks it terminal', async () => {
    const mgr = freshManager();
    const m = await mgr.createMission({ title: 'cancel-me' });
    const cancelled = await mgr.cancel(m.id);
    expect(cancelled.status).toBe(MissionStatus.Cancelled);
    expect(isTerminalStatus(cancelled.status)).toBe(true);
    expect(cancelled.events.some((e) => e.type === 'cancelled')).toBe(true);
  });

  it('cancel is a no-op once terminal', async () => {
    const mgr = freshManager();
    const m = await mgr.createMission({ title: 'done' });
    await mgr.updateStatus(m.id, MissionStatus.Completed);
    const before = mgr.getMission(m.id)!.events.length;
    const result = await mgr.cancel(m.id);
    expect(result.status).toBe(MissionStatus.Completed);
    expect(mgr.getMission(m.id)!.events.length).toBe(before);
  });
});

describe('MissionManager — event log append', () => {
  it('appends arbitrary events with injected timestamps', async () => {
    const mgr = freshManager();
    const m = await mgr.createMission({ title: 'log' });
    await mgr.recordEvent(m.id, { type: 'info', message: 'heartbeat tick', data: { x: 1 } });
    await mgr.recordEvent(m.id, { type: 'warning', message: 'slow tool' });

    const events = mgr.getMission(m.id)!.events;
    expect(events.some((e) => e.type === 'info' && e.message === 'heartbeat tick')).toBe(true);
    expect(events.some((e) => e.type === 'warning')).toBe(true);
    // Every event has an ISO timestamp from the injected clock.
    for (const e of events) {
      expect(typeof e.ts).toBe('string');
      expect(() => new Date(e.ts).toISOString()).not.toThrow();
    }
  });

  it('emits mission:created, mission:updated and mission:event', async () => {
    const mgr = freshManager();
    const created: Mission[] = [];
    const updated: Mission[] = [];
    const evented: Array<{ missionId: string; event: MissionEvent }> = [];
    mgr.on('mission:created', (m: Mission) => created.push(m));
    mgr.on('mission:updated', (m: Mission) => updated.push(m));
    mgr.on('mission:event', (sig: { missionId: string; event: MissionEvent }) =>
      evented.push(sig),
    );

    const m = await mgr.createMission({ title: 'events' });
    expect(created).toHaveLength(1);
    expect(evented.some((s) => s.event.type === 'created')).toBe(true);

    await mgr.updateStatus(m.id, MissionStatus.Running);
    expect(updated).toHaveLength(1);
    expect(evented.some((s) => s.event.type === 'status_changed')).toBe(true);
  });

  it('accrues cost and tokens', async () => {
    const mgr = freshManager();
    const m = await mgr.createMission({ title: 'billing' });
    await mgr.addUsage(m.id, { costUsd: 0.5, tokens: 1200 });
    await mgr.addUsage(m.id, { costUsd: 0.25, tokens: 300 });
    const got = mgr.getMission(m.id)!;
    expect(got.costUsd).toBeCloseTo(0.75);
    expect(got.tokens).toBe(1500);
  });
});

describe('MissionStore — atomic writes & concurrency', () => {
  it('removes a mission file and reports existence correctly', async () => {
    const store = new MissionStore({ baseDir });
    const mission = sampleMission('rm_1');
    await store.save(mission);
    expect(await store.load('rm_1')).not.toBeNull();
    expect(await store.remove('rm_1')).toBe(true);
    expect(await store.load('rm_1')).toBeNull();
    expect(await store.remove('rm_1')).toBe(false);
  });

  it('list() ignores temp files and non-json entries', async () => {
    const store = new MissionStore({ baseDir });
    await store.save(sampleMission('a'));
    await store.save(sampleMission('b'));
    // Stray temp + junk files must not appear as missions.
    await fs.writeFile(path.join(baseDir, 'c.json.123.tmp'), 'partial', 'utf-8');
    await fs.writeFile(path.join(baseDir, 'notes.txt'), 'x', 'utf-8');
    const ids = (await store.list()).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('concurrent saves of the SAME mission never corrupt the file', async () => {
    const store = new MissionStore({ baseDir });
    // 50 concurrent saves with distinct progress values. Because each save
    // uses a unique temp file + rename, the live file is always a complete,
    // parseable JSON document — one of the writers wins the final rename.
    const saves: Promise<void>[] = [];
    for (let i = 0; i < 50; i++) {
      const m = sampleMission('hot');
      m.progress = i;
      m.tokens = i * 10;
      saves.push(store.save(m));
    }
    await Promise.all(saves);

    const final = await store.load('hot');
    expect(final).not.toBeNull();
    // Must be a fully-formed mission (not a half-written / truncated file).
    expect(final!.id).toBe('hot');
    expect(typeof final!.progress).toBe('number');
    expect(Array.isArray(final!.subTasks)).toBe(true);

    // No orphaned temp files left behind after the dust settles.
    const leftover = (await fs.readdir(baseDir)).filter((f) => f.endsWith('.tmp'));
    expect(leftover).toEqual([]);
  });

  it('loadAll() survives a corrupt file by skipping it', async () => {
    const store = new MissionStore({ baseDir });
    await store.save(sampleMission('good'));
    await fs.writeFile(path.join(baseDir, 'broken.json'), '{ not valid json', 'utf-8');
    const all = await store.loadAll();
    expect(all.map((m) => m.id)).toEqual(['good']);
  });

  it('list() returns [] when the base dir does not exist yet', async () => {
    const store = new MissionStore({ baseDir: path.join(baseDir, 'does-not-exist') });
    expect(await store.list()).toEqual([]);
    expect(await store.loadAll()).toEqual([]);
  });
});

// ─── helpers ──────────────────────────────────────────────────────────

function sampleMission(id: string): Mission {
  const ts = '2026-06-07T12:00:00.000Z';
  return {
    id,
    title: `Mission ${id}`,
    description: '',
    status: MissionStatus.Planning,
    subTasks: [],
    progress: 0,
    createdAt: ts,
    updatedAt: ts,
    events: [],
    costUsd: 0,
    tokens: 0,
  };
}
