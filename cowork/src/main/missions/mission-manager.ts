/**
 * Mission Manager — orchestration core for the Mission Orchestrator (Phase 1).
 *
 * Owns the in-memory mission state machine on top of {@link MissionStore} and
 * emits lifecycle events so an IPC layer can later subscribe and stream them
 * to the Cowork renderer (Mission Board). This is the PURE core: it has NO
 * Electron, NO IPC, NO LLM calls and NO bridge coupling. It is just
 * `state machine + JSON persistence + events`, fully unit-testable with plain
 * vitest (the LLM decomposition + WorkflowBridge/SubAgentBridge/FleetBridge
 * execution wiring is Phase-1 follow-up, documented in
 * `docs/MISSION-ORCHESTRATOR-PHASE1-PLAN.md`).
 *
 * Events (Node `EventEmitter`):
 *   - `mission:created`  → (mission: Mission)
 *   - `mission:updated`  → (mission: Mission)
 *   - `mission:event`    → ({ missionId: string; event: MissionEvent })
 *
 * Determinism: the clock and id factory are injected (defaults: ISO-8601
 * `Date` and `uuid` v4). Nothing here calls `Date.now()` for stored values.
 *
 * @module cowork/main/missions/mission-manager
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { MissionStore } from './mission-store';
import {
  MissionStatus,
  SubTaskStatus,
  isTerminalStatus,
  type Clock,
  type IdFactory,
  type Mission,
  type MissionCreateInput,
  type MissionEvent,
  type MissionFilter,
  type SubTask,
} from './mission-types';

export interface MissionManagerOptions {
  store: MissionStore;
  /** ISO-8601 clock. Default `() => new Date().toISOString()`. */
  now?: Clock;
  /** Id factory. Default `uuid` v4. */
  idFactory?: IdFactory;
}

/** Payload of the `mission:event` emitter signal. */
export interface MissionEventSignal {
  missionId: string;
  event: MissionEvent;
}

export class MissionManager extends EventEmitter {
  private readonly store: MissionStore;
  private readonly now: Clock;
  private readonly newId: IdFactory;
  private readonly missions = new Map<string, Mission>();
  private hydrated = false;

  constructor(options: MissionManagerOptions) {
    super();
    this.store = options.store;
    this.now = options.now ?? (() => new Date().toISOString());
    this.newId = options.idFactory ?? (() => uuidv4());
  }

  /**
   * Rehydrate the in-memory cache from disk. Idempotent — safe to call at
   * boot. Missions persisted by a previous Cowork session reappear here.
   */
  async init(): Promise<void> {
    if (this.hydrated) return;
    const persisted = await this.store.loadAll();
    for (const mission of persisted) {
      this.missions.set(mission.id, mission);
    }
    this.hydrated = true;
  }

  // ─── Reads ──────────────────────────────────────────────────────────

  /** Get a single mission by id from the in-memory cache. */
  getMission(id: string): Mission | null {
    return this.missions.get(id) ?? null;
  }

  /** List missions, optionally filtered by status. Newest first. */
  listMissions(filter?: MissionFilter): Mission[] {
    let all = Array.from(this.missions.values());
    if (filter?.status) {
      const wanted = Array.isArray(filter.status) ? filter.status : [filter.status];
      all = all.filter((m) => wanted.includes(m.status));
    }
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // ─── Mutations ──────────────────────────────────────────────────────

  /** Create, persist and announce a new mission. */
  async createMission(input: MissionCreateInput): Promise<Mission> {
    const ts = this.now();
    const subTasks: SubTask[] = (input.subTasks ?? []).map((st) => ({
      id: st.id ?? this.newId(),
      title: st.title,
      status: st.status ?? SubTaskStatus.Pending,
      progress: clampProgress(st.progress ?? 0),
      ...(st.description !== undefined ? { description: st.description } : {}),
      ...(st.dependsOn !== undefined ? { dependsOn: st.dependsOn } : {}),
      ...(st.result !== undefined ? { result: st.result } : {}),
      ...(st.error !== undefined ? { error: st.error } : {}),
    }));

    const mission: Mission = {
      id: this.newId(),
      title: input.title,
      description: input.description ?? '',
      status: input.status ?? MissionStatus.Planning,
      subTasks,
      progress: computeProgress(subTasks),
      createdAt: ts,
      updatedAt: ts,
      events: [],
      costUsd: 0,
      tokens: 0,
    };

    // Seed the activity log with a creation event (in-memory append so the
    // event is part of the very first persisted snapshot).
    mission.events.push({ ts, type: 'created', message: `Mission created: ${mission.title}` });

    this.missions.set(mission.id, mission);
    await this.store.save(mission);
    this.emit('mission:created', mission);
    this.emit('mission:event', {
      missionId: mission.id,
      event: mission.events[mission.events.length - 1]!,
    } satisfies MissionEventSignal);
    return mission;
  }

  /** Add a sub-task to a mission, recompute progress, persist, announce. */
  async addSubTask(
    missionId: string,
    subtask: Omit<SubTask, 'id' | 'status' | 'progress'> &
      Partial<Pick<SubTask, 'id' | 'status' | 'progress'>>,
  ): Promise<Mission> {
    const mission = this.require(missionId);
    const newSubTask: SubTask = {
      id: subtask.id ?? this.newId(),
      title: subtask.title,
      status: subtask.status ?? SubTaskStatus.Pending,
      progress: clampProgress(subtask.progress ?? 0),
      ...(subtask.description !== undefined ? { description: subtask.description } : {}),
      ...(subtask.dependsOn !== undefined ? { dependsOn: subtask.dependsOn } : {}),
      ...(subtask.result !== undefined ? { result: subtask.result } : {}),
      ...(subtask.error !== undefined ? { error: subtask.error } : {}),
    };
    mission.subTasks.push(newSubTask);
    this.appendEvent(mission, {
      type: 'subtask_added',
      message: `Sub-task added: ${newSubTask.title}`,
      data: { subTaskId: newSubTask.id },
    });
    this.recomputeProgress(mission);
    return this.touchAndPersist(mission);
  }

  /**
   * Update a sub-task's status (and optionally progress / result / error),
   * recompute the mission progress, persist and announce.
   */
  async updateSubTaskStatus(
    missionId: string,
    subTaskId: string,
    status: SubTaskStatus,
    patch: Partial<Pick<SubTask, 'progress' | 'result' | 'error'>> = {},
  ): Promise<Mission> {
    const mission = this.require(missionId);
    const subTask = mission.subTasks.find((st) => st.id === subTaskId);
    if (!subTask) {
      throw new Error(`Sub-task not found: ${subTaskId} (mission ${missionId})`);
    }
    subTask.status = status;
    // A completed sub-task is 100% by definition unless an explicit progress
    // value was supplied; otherwise honour any provided progress.
    if (patch.progress !== undefined) {
      subTask.progress = clampProgress(patch.progress);
    } else if (status === SubTaskStatus.Completed) {
      subTask.progress = 100;
    }
    if (patch.result !== undefined) subTask.result = patch.result;
    if (patch.error !== undefined) subTask.error = patch.error;

    this.appendEvent(mission, {
      type: 'subtask_updated',
      message: `Sub-task ${subTask.title} → ${status}`,
      data: { subTaskId, status },
    });
    this.recomputeProgress(mission);
    return this.touchAndPersist(mission);
  }

  /**
   * Recompute aggregate progress from sub-tasks: percentage of sub-tasks in
   * a {@link SubTaskStatus.Completed} state. Mutates the mission in place and
   * returns the value. Zero sub-tasks → 0 (no divide-by-zero).
   */
  recomputeProgress(mission: Mission): number {
    mission.progress = computeProgress(mission.subTasks);
    return mission.progress;
  }

  /** Transition mission status, persist and announce. */
  async updateStatus(missionId: string, status: MissionStatus): Promise<Mission> {
    const mission = this.require(missionId);
    const from = mission.status;
    if (from === status) return mission;
    mission.status = status;
    this.appendEvent(mission, {
      type: 'status_changed',
      message: `Status: ${from} → ${status}`,
      data: { from, to: status },
    });
    return this.touchAndPersist(mission);
  }

  /**
   * Record an arbitrary event in a mission's activity log. The caller may
   * omit `ts`; it is filled from the injected clock. Persists and emits both
   * `mission:event` and `mission:updated`.
   */
  async recordEvent(
    missionId: string,
    event: Omit<MissionEvent, 'ts'> & Partial<Pick<MissionEvent, 'ts'>>,
  ): Promise<Mission> {
    const mission = this.require(missionId);
    this.appendEvent(mission, event);
    return this.touchAndPersist(mission);
  }

  /**
   * Cancel a mission. No-op (returns the mission) if already terminal.
   */
  async cancel(missionId: string): Promise<Mission> {
    const mission = this.require(missionId);
    if (isTerminalStatus(mission.status)) return mission;
    mission.status = MissionStatus.Cancelled;
    this.appendEvent(mission, { type: 'cancelled', message: 'Mission cancelled' });
    return this.touchAndPersist(mission);
  }

  /** Accrue cost / token usage for a mission (heartbeat / billing hooks). */
  async addUsage(
    missionId: string,
    usage: { costUsd?: number; tokens?: number },
  ): Promise<Mission> {
    const mission = this.require(missionId);
    mission.costUsd += usage.costUsd ?? 0;
    mission.tokens += usage.tokens ?? 0;
    return this.touchAndPersist(mission);
  }

  /** Remove a mission from memory and disk. Returns true if it existed. */
  async removeMission(missionId: string): Promise<boolean> {
    const existed = this.missions.delete(missionId);
    await this.store.remove(missionId);
    return existed;
  }

  // ─── Internals ──────────────────────────────────────────────────────

  private require(missionId: string): Mission {
    const mission = this.missions.get(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);
    return mission;
  }

  /** Append an event (timestamp from the injected clock) and emit it. */
  private appendEvent(
    mission: Mission,
    event: Omit<MissionEvent, 'ts'> & Partial<Pick<MissionEvent, 'ts'>>,
  ): void {
    const full: MissionEvent = {
      ts: event.ts ?? this.now(),
      type: event.type,
      message: event.message,
      ...(event.data !== undefined ? { data: event.data } : {}),
    };
    mission.events.push(full);
    this.emit('mission:event', {
      missionId: mission.id,
      event: full,
    } satisfies MissionEventSignal);
  }

  /** Bump updatedAt, persist, emit `mission:updated`. */
  private async touchAndPersist(mission: Mission): Promise<Mission> {
    mission.updatedAt = this.now();
    await this.store.save(mission);
    this.emit('mission:updated', mission);
    return mission;
  }
}

/** Percentage (0–100) of sub-tasks that are completed. Empty → 0. */
function computeProgress(subTasks: SubTask[]): number {
  if (subTasks.length === 0) return 0;
  const done = subTasks.filter((st) => st.status === SubTaskStatus.Completed).length;
  return Math.round((done / subTasks.length) * 100);
}

function clampProgress(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
}
