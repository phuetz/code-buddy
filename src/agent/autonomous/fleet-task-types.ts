/**
 * Fleet task types — Phase (d).18 (Autonomous Fleet Protocol v0.1).
 *
 * Mirrors the JSON shapes used by `claude-et-patrice/.codebuddy/`:
 *   - `colab-tasks.json`     — queue of fleet tasks
 *   - `colab-worklog.json`   — append-only audit trail
 *   - `presence.json`        — liveness map
 *
 * These shapes were established by the Python wrapper
 * `claude-et-patrice/tools/heartbeat_tick.py` and proven over 6
 * successful autonomous cycles on 2026-05-02. The native TypeScript
 * port keeps the shapes identical so both wrappers can co-exist.
 *
 * @module src/agent/autonomous/fleet-task-types
 */

export type FleetTaskStatus = 'open' | 'in_progress' | 'completed' | 'blocked';
export type FleetTaskPriority = 'critical' | 'high' | 'medium' | 'low';

export interface FleetTask {
  id: string;
  title: string;
  description: string;
  status: FleetTaskStatus;
  priority: FleetTaskPriority;
  /** Optional pre-assignment hint — picker honours it as a soft preference. */
  assignedAgent?: string | null;
  /** Host id of the claimer. `null` while the task is open. */
  claimedBy?: string | null;
  /** ISO-8601 UTC timestamp of claim. */
  claimedAt?: string | null;
  /** ISO-8601 UTC timestamp of completion (any terminal status). */
  completedAt?: string | null;
  /** Allow-list of files the claimer is allowed to modify. Empty = no scope guard. */
  filesToModify: string[];
  /** Free-form acceptance criteria, surfaced in the prompt to the claimer. */
  acceptanceCriteria: string[];
  createdBy: string;
  createdAt: string;
  /** Free-form note, e.g. why the task is currently blocked. */
  blockedBy?: string;
  /**
   * Phase (d).20 — hint to the autonomous tick: when `true` AND a local
   * LLM (Ollama) is configured on the host that picks up the task, run
   * the task on the local LLM instead of the host's default provider.
   * Useful for mechanical tasks (lint, summary, doc) where local quality
   * is sufficient and cloud quota is precious. When `OLLAMA_HOST` is not
   * set, the task falls back to the host's default provider (no block).
   */
  preferLocal?: boolean;
  /**
   * Phase 2 (Hermes self-improving) — opt-in Draft→Review→Test chain.
   * When set, the autonomous tick runs the task as a sequence of
   * in-process agent calls, one per role, with each stage's output
   * threaded into the next stage's prompt.
   *
   * Recommended values:
   *   ['code', 'review', 'safe']      → Draft → Review → Test
   *   ['code', 'review']              → Draft → Review (no tests stage)
   *   ['research', 'code']            → Research → Implementation
   *
   * Per-stage timeout = `maxTaskMs / chainRoles.length` unless the
   * tick caller overrides via `maxStageMs`. Worklog gets a `chainStages`
   * array with one entry per stage (auditable). When unset (default),
   * the tick runs single-shot as before — no behaviour change for
   * existing tasks.
   */
  chainRoles?: string[];
}

export interface FleetTasksFile {
  version: string;
  comment?: string;
  tasks: FleetTask[];
}

export interface WorklogFileEntry {
  id: string;
  date: string;
  agent: string;
  taskId?: string;
  summary: string;
  filesModified: Array<{ file: string; changes: string }>;
  issues: string[];
  nextSteps: string[];
  /** Wall-clock seconds the agent took to execute the task. */
  elapsedSeconds?: number;
  /** Phase (d).20 — provider id used (e.g. "ollama", "grok"). Surface for cost audit. */
  provider?: string;
  /** Phase (d).20 — model name used. */
  model?: string;
  /**
   * Phase 2 (Hermes auto-chain) — per-stage breakdown for sagas that
   * ran as a Draft→Review→Test sequence. Each entry mirrors the
   * `AgentTaskOutput` JSON the agent emitted on that stage's last
   * line. Absent for single-shot tasks. Old worklog readers ignore
   * unknown fields, so adding this is backward-compatible.
   */
  chainStages?: Array<{
    role: string;
    summary: string;
    timedOut?: boolean;
    elapsedSeconds?: number;
  }>;
}

export interface WorklogFile {
  version: string;
  comment?: string;
  entries: WorklogFileEntry[];
}

export interface PresenceAgentEntry {
  host: string;
  lastSeen: string;
  status: 'active' | 'idle' | 'offline';
  currentTask: string | null;
}

export interface PresenceFile {
  version: string;
  comment?: string;
  agents: Record<string, PresenceAgentEntry>;
}

/**
 * Strict JSON shape the in-process agent must emit on the LAST line of
 * its response. The tick handler parses it from agent output to feed
 * the worklog. Mirror of the python wrapper's `parse_claude_output`.
 */
export interface AgentTaskOutput {
  summary: string;
  files_modified?: Array<{ file: string; changes: string }>;
  issues?: string[];
  next_steps?: string[];
}

/** Outcome returned by `runFleetTick()` — useful for telemetry + tests. */
export type FleetTickOutcome =
  | { kind: 'fleet_paused' }
  | { kind: 'no_task' }
  | { kind: 'dirty_repo'; status: string }
  | { kind: 'pull_failed'; error: string }
  | { kind: 'claim_lost'; taskId: string; error: string }
  | {
      kind: 'completed';
      taskId: string;
      elapsedMs: number;
      summary: string;
    }
  | {
      kind: 'blocked';
      taskId: string;
      reason: 'timeout' | 'out_of_scope' | 'agent_error';
      details: string;
    }
  | { kind: 'disabled' };

/** Priority rank for sorting; lower number = higher priority. */
export const PRIORITY_RANK: Record<FleetTaskPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};
