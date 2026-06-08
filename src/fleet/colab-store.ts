/**
 * Fleet collaboration store — native reader/writer for the autonomous-fleet
 * convention (`AUTONOMOUS-FLEET-PROTOCOL-2026-05-02.md`).
 *
 * The convention is three shared JSON files (today living in
 * `claude-et-patrice/.codebuddy/`, driven until now by an external
 * `heartbeat_tick.py` wrapper):
 *   - `colab-tasks.json`   — the fleet task queue
 *   - `colab-worklog.json` — append-only work log
 *   - `presence.json`      — ephemeral liveness per agent
 *
 * This module gives Code Buddy a first-class way to read/claim/complete those
 * tasks so the HeartbeatEngine (or a CLI) can drive the cycle natively instead
 * of shelling out to Python.
 *
 * Distributed-coordination caveats (by design, do not "fix" with file locks):
 *  - Claiming is **advisory/optimistic**. The real arbiter across machines is
 *    git push order ("first to push wins"), per the protocol — callers must
 *    `git pull --rebase` before and reconcile after. Unit tests prove the local
 *    store logic, NOT the cross-machine race resolution.
 *  - The shared dir is usually a DIFFERENT repo (claude-et-patrice) with its own
 *    write rules; this module only mutates the JSON it owns and preserves the
 *    human `version`/`comment` fields.
 *
 * Safety: {@link FleetColabStore.isAutoClaimable} is the load-bearing guardrail
 * — `critical`-priority tasks are never auto-claimed (they need Patrice).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type ColabTaskStatus = 'open' | 'in_progress' | 'completed' | 'blocked';
export type ColabTaskPriority = 'critical' | 'high' | 'medium' | 'low';

const PRIORITY_RANK: Record<ColabTaskPriority, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

const DEFAULT_CLAIM_TTL_MS = 15 * 60 * 1000;

export interface ColabTask {
  id: string;
  title: string;
  description?: string;
  status: ColabTaskStatus;
  priority: ColabTaskPriority;
  assignedAgent?: string | null;
  claimedBy?: string | null;
  claimedAt?: string | null;
  completedAt?: string | null;
  blockedReason?: string;
  filesToModify?: string[];
  acceptanceCriteria?: string[];
  /** Ids of tasks that must be `completed` before this one is claimable (DAG). */
  dependsOn?: string[];
  createdBy?: string;
  createdAt?: string;
}

export interface ColabWorklogFileChange {
  file: string;
  changes: string;
}

export interface ColabWorklogEntry {
  id: string;
  date: string;
  agent: string;
  taskId?: string | null;
  summary: string;
  filesModified: ColabWorklogFileChange[];
  issues: string[];
  nextSteps: string[];
  elapsedSeconds?: number;
}

export interface ColabPresence {
  host: string;
  lastSeen: string;
  status: 'active' | 'idle' | 'offline';
  currentTask?: string | null;
}

export interface FleetColabStoreConfig {
  /** Directory holding the colab-*.json files (default: <cwd>/.codebuddy or CODEBUDDY_FLEET_COLAB_DIR). */
  dir?: string;
  /** This agent's id, `<host>/<repo>` (default: hostname/cwd-basename). */
  agentId?: string;
  /**
   * Claim lease in ms (Hermes-kanban-style). An in_progress task whose claim is
   * older than this is treated as reclaimable — so a crashed agent's task does
   * not stay stuck. Lazy-on-read (no timer); 0 disables. Default 15 min.
   */
  claimTtlMs?: number;
  /** Injectable clock (epoch ms) for deterministic tests. */
  now?: () => number;
  /** Injectable id generator for deterministic tests. */
  generateId?: (prefix: string) => string;
}

export interface CompleteTaskInput {
  summary: string;
  filesModified?: ColabWorklogFileChange[];
  elapsedSeconds?: number;
  nextSteps?: string[];
  issues?: string[];
  agentId?: string;
}

export interface AddTaskInput {
  title: string;
  description?: string;
  priority?: ColabTaskPriority;
  filesToModify?: string[];
  acceptanceCriteria?: string[];
  dependsOn?: string[];
  createdBy?: string;
  id?: string;
}

interface TasksFile {
  version: string;
  comment?: string;
  tasks: ColabTask[];
}

interface WorklogFile {
  version: string;
  comment?: string;
  entries: ColabWorklogEntry[];
}

interface PresenceFile {
  version: string;
  comment?: string;
  agents: Record<string, ColabPresence>;
}

/** Derive the default `<host>/<repo>` agent id from the environment. */
export function defaultFleetAgentId(cwd: string = process.cwd()): string {
  const host = os.hostname().toLowerCase().split('.')[0] || 'unknown-host';
  const repo = path.basename(path.resolve(cwd)) || 'repo';
  return `${host}/${repo}`;
}

export class FleetColabStore {
  private readonly dir: string;
  readonly agentId: string;
  private readonly now: () => number;
  private readonly generateId: (prefix: string) => string;
  private readonly claimTtlMs: number;
  private readonly tasksPath: string;
  private readonly worklogPath: string;
  private readonly presencePath: string;

  constructor(config: FleetColabStoreConfig = {}) {
    this.dir = config.dir
      ?? process.env['CODEBUDDY_FLEET_COLAB_DIR']
      ?? path.join(process.cwd(), '.codebuddy');
    this.agentId = config.agentId ?? defaultFleetAgentId();
    this.now = config.now ?? (() => Date.now());
    let counter = 0;
    this.generateId = config.generateId ?? ((prefix: string) => `${prefix}-${this.now()}-${++counter}`);
    this.claimTtlMs = config.claimTtlMs ?? DEFAULT_CLAIM_TTL_MS;
    this.tasksPath = path.join(this.dir, 'colab-tasks.json');
    this.worklogPath = path.join(this.dir, 'colab-worklog.json');
    this.presencePath = path.join(this.dir, 'presence.json');
  }

  // ── Tasks ───────────────────────────────────────────────────────────────

  listTasks(filter?: { status?: ColabTaskStatus; priority?: ColabTaskPriority }): ColabTask[] {
    let tasks = this.readTasks().tasks.map((t) => ({ ...t }));
    if (filter?.status) tasks = tasks.filter((t) => t.status === filter.status);
    if (filter?.priority) tasks = tasks.filter((t) => t.priority === filter.priority);
    return tasks;
  }

  getTask(taskId: string): ColabTask | null {
    const task = this.readTasks().tasks.find((t) => t.id === taskId);
    return task ? { ...task } : null;
  }

  /**
   * The load-bearing safety predicate: a task is auto-claimable only when it is
   * open, unclaimed, and NOT `critical` (critical work needs Patrice's eyes).
   */
  isAutoClaimable(task: Pick<ColabTask, 'status' | 'priority' | 'claimedBy'>): boolean {
    return task.status === 'open' && !task.claimedBy && task.priority !== 'critical';
  }

  /**
   * Whether an in_progress task's claim lease has expired (Hermes-kanban-style
   * reclaim of a crashed agent's work). Lazy: evaluated on read, no timer.
   */
  isClaimExpired(task: Pick<ColabTask, 'status' | 'claimedAt'>, nowMs: number = this.now()): boolean {
    if (this.claimTtlMs <= 0) return false;
    if (task.status !== 'in_progress' || !task.claimedAt) return false;
    const claimedMs = Date.parse(task.claimedAt);
    return Number.isFinite(claimedMs) && nowMs - claimedMs > this.claimTtlMs;
  }

  /**
   * Sweep expired claims back to `open` (for a daemon to call proactively).
   * Returns the reclaimed task ids. Lazy callers can rely on {@link nextClaimable},
   * which already treats expired claims as available.
   */
  reclaimExpired(): string[] {
    const file = this.readTasks();
    const nowMs = this.now();
    const reclaimed: string[] = [];
    for (const task of file.tasks) {
      if (this.isClaimExpired(task, nowMs)) {
        task.status = 'open';
        task.claimedBy = null;
        task.claimedAt = null;
        reclaimed.push(task.id);
      }
    }
    if (reclaimed.length > 0) this.writeTasks(file);
    return reclaimed;
  }

  /** Dependency ids that are not yet `completed` (unknown/missing ids count as unmet). */
  unmetDependencies(task: Pick<ColabTask, 'dependsOn'>, tasks: ColabTask[]): string[] {
    if (!task.dependsOn || task.dependsOn.length === 0) return [];
    const completed = new Set(tasks.filter((t) => t.status === 'completed').map((t) => t.id));
    return task.dependsOn.filter((id) => !completed.has(id));
  }

  /** True when every dependency of a task is `completed` (DAG readiness). */
  areDependenciesMet(task: Pick<ColabTask, 'dependsOn'>, tasks: ColabTask[]): boolean {
    return this.unmetDependencies(task, tasks).length === 0;
  }

  /**
   * Highest-priority auto-claimable task (open + unclaimed + non-critical),
   * matching the protocol's "première open + claimedBy=null par priority desc".
   * Pass `allowCritical` only for a human-supervised claim.
   */
  nextClaimable(options: { allowCritical?: boolean } = {}): ColabTask | null {
    const nowMs = this.now();
    const all = this.readTasks().tasks;
    const candidates = all.filter((t) =>
      ((t.status === 'open' && !t.claimedBy) || this.isClaimExpired(t, nowMs))
      && (options.allowCritical || t.priority !== 'critical')
      && this.areDependenciesMet(t, all),
    );
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]);
    return { ...candidates[0]! };
  }

  /**
   * Optimistically claim a task for this agent. Advisory only — the real
   * cross-machine arbiter is git push order; callers reconcile after pull.
   */
  claim(taskId: string, agentId: string = this.agentId): ColabTask {
    const file = this.readTasks();
    const task = file.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Unknown fleet task '${taskId}'`);
    // An expired claim is reclaimable by anyone (the previous owner is presumed
    // dead) — so the ownership/status guards below are skipped when expired.
    const expired = this.isClaimExpired(task);
    // Check ownership before status so a task held by another (live) agent gives
    // the clearer "already claimed by X" rather than a generic "not open".
    if (task.claimedBy && task.claimedBy !== agentId && !expired) {
      throw new Error(`Task '${taskId}' already claimed by '${task.claimedBy}'`);
    }
    if (task.status !== 'open' && !expired) {
      throw new Error(`Task '${taskId}' is '${task.status}', not open`);
    }
    const unmet = this.unmetDependencies(task, file.tasks);
    if (unmet.length > 0) {
      throw new Error(`Task '${taskId}' blocked by unmet dependencies: ${unmet.join(', ')}`);
    }
    task.status = 'in_progress';
    task.claimedBy = agentId;
    task.claimedAt = this.isoNow();
    this.writeTasks(file);
    return { ...task };
  }

  /** Mark a claimed task completed and append a worklog entry. */
  completeTask(taskId: string, input: CompleteTaskInput): { task: ColabTask; worklog: ColabWorklogEntry } {
    const file = this.readTasks();
    const task = file.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Unknown fleet task '${taskId}'`);
    const agentId = input.agentId ?? this.agentId;
    task.status = 'completed';
    task.completedAt = this.isoNow();
    if (!task.claimedBy) task.claimedBy = agentId;
    this.writeTasks(file);

    const worklog = this.appendWorklog({
      agent: agentId,
      taskId,
      summary: input.summary,
      filesModified: input.filesModified ?? [],
      issues: input.issues ?? [],
      nextSteps: input.nextSteps ?? [],
      ...(input.elapsedSeconds !== undefined ? { elapsedSeconds: input.elapsedSeconds } : {}),
    });
    return { task: { ...task }, worklog };
  }

  /** Block a task with a reason (needs human/unblocking). */
  blockTask(taskId: string, reason: string): ColabTask {
    const file = this.readTasks();
    const task = file.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Unknown fleet task '${taskId}'`);
    task.status = 'blocked';
    task.blockedReason = reason;
    this.writeTasks(file);
    return { ...task };
  }

  /** Release a claimed task back to the open pool. */
  releaseTask(taskId: string): ColabTask {
    const file = this.readTasks();
    const task = file.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Unknown fleet task '${taskId}'`);
    task.status = 'open';
    task.claimedBy = null;
    task.claimedAt = null;
    this.writeTasks(file);
    return { ...task };
  }

  addTask(input: AddTaskInput): ColabTask {
    const file = this.readTasks();
    const task: ColabTask = {
      id: input.id ?? this.generateId('task'),
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      status: 'open',
      priority: input.priority ?? 'medium',
      assignedAgent: null,
      claimedBy: null,
      claimedAt: null,
      ...(input.filesToModify ? { filesToModify: input.filesToModify } : {}),
      ...(input.acceptanceCriteria ? { acceptanceCriteria: input.acceptanceCriteria } : {}),
      ...(input.dependsOn && input.dependsOn.length > 0 ? { dependsOn: [...new Set(input.dependsOn)] } : {}),
      createdBy: input.createdBy ?? this.agentId,
      createdAt: this.isoNow(),
    };
    file.tasks.push(task);
    this.writeTasks(file);
    return { ...task };
  }

  /** Add a `child dependsOn parent` edge (DAG). Both tasks must exist; self-links rejected. */
  link(childId: string, parentId: string): ColabTask {
    if (childId === parentId) throw new Error(`A task cannot depend on itself ('${childId}')`);
    const file = this.readTasks();
    const child = file.tasks.find((t) => t.id === childId);
    const parent = file.tasks.find((t) => t.id === parentId);
    if (!child) throw new Error(`Unknown fleet task '${childId}'`);
    if (!parent) throw new Error(`Unknown dependency task '${parentId}'`);
    const deps = new Set(child.dependsOn ?? []);
    deps.add(parentId);
    child.dependsOn = [...deps];
    this.writeTasks(file);
    return { ...child };
  }

  /** Remove a `child dependsOn parent` edge. Returns false if the edge was absent. */
  unlink(childId: string, parentId: string): boolean {
    const file = this.readTasks();
    const child = file.tasks.find((t) => t.id === childId);
    if (!child) throw new Error(`Unknown fleet task '${childId}'`);
    const next = (child.dependsOn ?? []).filter((id) => id !== parentId);
    if (next.length === (child.dependsOn ?? []).length) return false;
    if (next.length > 0) child.dependsOn = next;
    else delete child.dependsOn;
    this.writeTasks(file);
    return true;
  }

  // ── Worklog ───────────────────────────────────────────────────────────────

  appendWorklog(entry: Omit<ColabWorklogEntry, 'id' | 'date'> & { id?: string; date?: string }): ColabWorklogEntry {
    const file = this.readWorklog();
    const full: ColabWorklogEntry = {
      id: entry.id ?? this.generateId('wl'),
      date: entry.date ?? this.isoNow(),
      agent: entry.agent,
      ...(entry.taskId !== undefined ? { taskId: entry.taskId } : {}),
      summary: entry.summary,
      filesModified: entry.filesModified ?? [],
      issues: entry.issues ?? [],
      nextSteps: entry.nextSteps ?? [],
      ...(entry.elapsedSeconds !== undefined ? { elapsedSeconds: entry.elapsedSeconds } : {}),
    };
    file.entries.push(full);
    this.writeWorklog(file);
    return { ...full };
  }

  listWorklog(): ColabWorklogEntry[] {
    return this.readWorklog().entries.map((e) => ({ ...e }));
  }

  // ── Presence ───────────────────────────────────────────────────────────────

  updatePresence(
    update: { status?: ColabPresence['status']; currentTask?: string | null; host?: string } = {},
    agentId: string = this.agentId,
  ): ColabPresence {
    const file = this.readPresence();
    const existing = file.agents[agentId];
    const presence: ColabPresence = {
      host: update.host ?? existing?.host ?? agentId,
      lastSeen: this.isoNow(),
      status: update.status ?? existing?.status ?? 'active',
      currentTask: update.currentTask !== undefined ? update.currentTask : (existing?.currentTask ?? null),
    };
    file.agents[agentId] = presence;
    this.writePresence(file);
    return { ...presence };
  }

  listPresence(): Record<string, ColabPresence> {
    const agents = this.readPresence().agents;
    return Object.fromEntries(Object.entries(agents).map(([k, v]) => [k, { ...v }]));
  }

  /** Agent ids whose last presence update is older than `thresholdMs` (stale/offline). */
  stalePresence(thresholdMs: number): string[] {
    const nowMs = this.now();
    return Object.entries(this.readPresence().agents)
      .filter(([, p]) => {
        const seen = Date.parse(p.lastSeen);
        return Number.isFinite(seen) && nowMs - seen > thresholdMs;
      })
      .map(([id]) => id);
  }

  getDir(): string {
    return this.dir;
  }

  // ── Persistence (preserves human version/comment fields) ────────────────────

  private isoNow(): string {
    return new Date(this.now()).toISOString();
  }

  private readTasks(): TasksFile {
    const parsed = this.readJson<Partial<TasksFile>>(this.tasksPath);
    return {
      version: typeof parsed?.version === 'string' ? parsed.version : '0.1',
      ...(typeof parsed?.comment === 'string' ? { comment: parsed.comment } : {}),
      tasks: Array.isArray(parsed?.tasks) ? parsed!.tasks as ColabTask[] : [],
    };
  }

  private writeTasks(file: TasksFile): void {
    this.writeJson(this.tasksPath, file);
  }

  private readWorklog(): WorklogFile {
    const parsed = this.readJson<Partial<WorklogFile>>(this.worklogPath);
    return {
      version: typeof parsed?.version === 'string' ? parsed.version : '0.1',
      ...(typeof parsed?.comment === 'string' ? { comment: parsed.comment } : {}),
      entries: Array.isArray(parsed?.entries) ? parsed!.entries as ColabWorklogEntry[] : [],
    };
  }

  private writeWorklog(file: WorklogFile): void {
    this.writeJson(this.worklogPath, file);
  }

  private readPresence(): PresenceFile {
    const parsed = this.readJson<Partial<PresenceFile>>(this.presencePath);
    return {
      version: typeof parsed?.version === 'string' ? parsed.version : '0.1',
      ...(typeof parsed?.comment === 'string' ? { comment: parsed.comment } : {}),
      agents: parsed?.agents && typeof parsed.agents === 'object' ? parsed.agents : {},
    };
  }

  private writePresence(file: PresenceFile): void {
    this.writeJson(this.presencePath, file);
  }

  private readJson<T>(filePath: string): T | null {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
    } catch {
      return null;
    }
  }

  private writeJson(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  }
}
