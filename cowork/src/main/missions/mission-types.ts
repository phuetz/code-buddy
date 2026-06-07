/**
 * Mission Orchestrator — core types (Phase 1).
 *
 * The "Mission Orchestrator" turns a complex natural-language task into a
 * tracked, long-running unit of autonomous work (see
 * `docs/AUTONOMOUS-SYSTEM-ROADMAP.md` §2.1–§2.4). These types describe the
 * persisted state of a single mission and its sub-tasks plus the event log
 * that the Mission Board UI streams.
 *
 * Design notes (important for testability):
 *   - This module is PURE TypeScript: no Electron, no better-sqlite3, no IPC.
 *     It can be exercised with plain vitest, with no native rebuild and
 *     without booting Electron.
 *   - All timestamps are ISO-8601 strings, produced by an injected clock
 *     (`() => string`). Nothing here calls `Date.now()` at module scope, so
 *     tests are deterministic.
 *
 * @module cowork/main/missions/mission-types
 */

/** Lifecycle status of a mission. */
export enum MissionStatus {
  /** Decomposing the request into sub-tasks (LLM planning). */
  Planning = 'planning',
  /** Actively executing sub-tasks. */
  Running = 'running',
  /** Suspended pending a human approval / input. */
  WaitingApproval = 'waiting_approval',
  /** Temporarily paused by the user. */
  Paused = 'paused',
  /** All sub-tasks finished successfully. */
  Completed = 'completed',
  /** Terminated by an unrecoverable error. */
  Failed = 'failed',
  /** Cancelled by the user before completion. */
  Cancelled = 'cancelled',
}

/** Lifecycle status of an individual sub-task within a mission. */
export enum SubTaskStatus {
  Pending = 'pending',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Skipped = 'skipped',
}

/**
 * A single decomposed unit of work inside a mission. The DAG edges
 * (`dependsOn`) let the Mission Board render an interactive dependency graph
 * and let the orchestrator schedule sub-tasks once their dependencies are
 * satisfied. Phase 1 keeps execution out of scope, so these are pure data.
 */
export interface SubTask {
  id: string;
  title: string;
  status: SubTaskStatus;
  /** 0–100 completion of this sub-task. */
  progress: number;
  /** Optional longer description / acceptance criteria. */
  description?: string;
  /** Ids of sub-tasks that must complete before this one can start. */
  dependsOn?: string[];
  /** Free-form result payload once finished. */
  result?: unknown;
  /** Error message if the sub-task failed. */
  error?: string;
}

/** A timestamped entry in a mission's audit / activity log. */
export interface MissionEvent {
  /** ISO-8601 timestamp (injected clock — never `Date.now()` here). */
  ts: string;
  /**
   * Event category, e.g. `created`, `status_changed`, `subtask_added`,
   * `subtask_updated`, `progress`, `info`, `warning`, `error`,
   * `heartbeat`, `checkpoint`. Kept as a free string so new event kinds
   * can be added without a breaking enum change.
   */
  type: string;
  /** Human-readable summary for the Mission Board activity feed. */
  message: string;
  /** Optional structured payload (tool output, cost delta, etc.). */
  data?: unknown;
}

/**
 * A tracked autonomous mission — the central record persisted to
 * `~/.codebuddy/missions/<id>.json` and streamed to the Mission Board.
 */
export interface Mission {
  id: string;
  title: string;
  description: string;
  status: MissionStatus;
  /** Decomposed DAG of sub-tasks. */
  subTasks: SubTask[];
  /** Aggregate 0–100 progress (derived from sub-tasks). */
  progress: number;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 last-update timestamp. */
  updatedAt: string;
  /** Append-only activity log. */
  events: MissionEvent[];
  /** Running USD cost accrued by the mission. */
  costUsd: number;
  /** Running token usage accrued by the mission. */
  tokens: number;
  /** Top-level error message when the mission has failed. */
  error?: string;
}

/** Input accepted by `MissionManager.createMission`. */
export interface MissionCreateInput {
  title: string;
  description?: string;
  /** Optional seed sub-tasks (e.g. from an LLM decomposition step). */
  subTasks?: Array<
    Omit<SubTask, 'id' | 'status' | 'progress'> &
      Partial<Pick<SubTask, 'id' | 'status' | 'progress'>>
  >;
  /** Optional starting status (defaults to {@link MissionStatus.Planning}). */
  status?: MissionStatus;
}

/** Filter for `MissionManager.listMissions`. */
export interface MissionFilter {
  status?: MissionStatus | MissionStatus[];
}

/**
 * Injectable clock — returns an ISO-8601 timestamp. Defaulted in the manager
 * to `() => new Date().toISOString()`; overridden in tests for determinism.
 */
export type Clock = () => string;

/**
 * Injectable id factory — returns a unique mission/sub-task id. Defaulted in
 * the manager to `uuid` v4; overridden in tests for stable assertions.
 */
export type IdFactory = () => string;

/** Statuses that mean the mission has reached a terminal state. */
export const TERMINAL_MISSION_STATUSES: readonly MissionStatus[] = [
  MissionStatus.Completed,
  MissionStatus.Failed,
  MissionStatus.Cancelled,
];

/** True if the mission can no longer transition (completed/failed/cancelled). */
export function isTerminalStatus(status: MissionStatus): boolean {
  return TERMINAL_MISSION_STATUSES.includes(status);
}
