/**
 * WorkflowOrchestrator (Phase O V0.4.1).
 *
 * Wraps a pool of MultiAgentSystem instances so /agents can run multiple
 * workflows concurrently — or queue them when the pool is full. With
 * `max_concurrent_workflows = 1` (default) the runtime state matches V0.3
 * exactly: one MAS singleton, sequential workflow execution, same
 * `current.json` persistence behaviour for /agents resume.
 *
 * Why a pool?
 * MultiAgentSystem keeps mutable per-run state on the instance
 * (`currentPlan`, `sharedContext.goal`, `timeline`, `isRunning`). Two
 * concurrent `runWorkflow()` calls on the same instance would step on
 * each other. The orchestrator reserves an instance per active workflow:
 * the first slot is the legacy singleton (`getMultiAgentSystem`), so
 * V0.3 callers and tests are unaffected; further slots are
 * `createMultiAgentSystem(...)` instances spun up on demand.
 *
 * Honest limitations (V0.4.1):
 * - Cost: each MAS instantiates 4 specialised agents (orchestrator +
 *   coder + reviewer + tester) with their own LLM clients. Running 3
 *   workflows in parallel = 3× LLM bill. Default 1 keeps V0.3 cost.
 * - Streaming: each active workflow attaches its own
 *   workflow-event-streamer to stdout. With pool > 1, lines from
 *   different workflows interleave (no workflowId prefix yet). V0.5+
 *   may add a prefix or per-workflow log files.
 * - Stop scope: `stopAll()` calls `stop()` on every MAS in the pool.
 *   `stop(workflowId)` raises `enable_per_workflow_stop must be true`
 *   when the flag is off (default), to surface the limitation
 *   explicitly rather than silently doing the wrong thing.
 */

import { EventEmitter } from 'events';
import { logger } from '../../utils/logger.js';
// Phase (d).3 (V0.4.1) — opt-in fleet broadcast for workflow lifecycle
// events. Eager-imported so concurrent emits don't get serialized through
// the dynamic-import promise chain (which observably starved subsequent
// emits in vitest under fast event bursts). The fleet-bridge module
// itself stays lean; it lazy-imports its own deps.
import { broadcastFleetEvent as _broadcastFleetEvent } from '../../server/websocket/fleet-bridge.js';
import {
  type MultiAgentSystem,
  createMultiAgentSystem,
  getMultiAgentSystem,
  resetMultiAgentSystem,
} from './multi-agent-system.js';
import type {
  CollaborationStrategy,
  WorkflowOptions,
  WorkflowResult,
  WorkflowEvent,
  AgentTask,
  AgentExecutionResult,
} from './types.js';
import type { MultiAgentProviderOverrides } from './provider-overrides.js';
import {
  saveWorkflowById,
  clearWorkflowById,
} from './workflow-multi-persistence.js';
import type { PersistedWorkflow } from './workflow-persistence.js';

export type QueuePolicy = 'queue' | 'reject';

export interface OrchestratorConfig {
  apiKey: string;
  baseURL?: string;
  /** Max active workflows at once. Default 1 = V0.3 compat (singleton only). */
  maxConcurrentWorkflows: number;
  /** What to do when submit arrives and pool is full. */
  queuePolicy: QueuePolicy;
  /** When false (default), `stop(workflowId)` raises rather than mis-stopping
   *  the wrong workflow. `stopAll()` always works. */
  enablePerWorkflowStop: boolean;
  /** Optional per-role provider/model overrides for heterogeneous swarms. */
  perAgentOverrides?: MultiAgentProviderOverrides;
}

const DEFAULT_CONFIG: Omit<OrchestratorConfig, 'apiKey' | 'baseURL'> = {
  maxConcurrentWorkflows: 1,
  queuePolicy: 'queue',
  enablePerWorkflowStop: false,
};

/** Public-shape info for an active workflow (no MAS reference exposed). */
export interface ActiveWorkflowInfo {
  workflowId: string;
  goal: string;
  strategy: CollaborationStrategy;
  startedAt: Date;
}

/** Public-shape info for a queued workflow (no resolve/reject exposed). */
export interface QueuedWorkflowInfo {
  workflowId: string;
  goal: string;
  strategy: CollaborationStrategy;
  queuedAt: Date;
}

interface ActiveSlot {
  workflowId: string;
  goal: string;
  strategy: CollaborationStrategy;
  startedAt: Date;
  mas: MultiAgentSystem;
  /** True when this slot wraps the legacy singleton (slot 0). Used by
   *  `release()` to choose between resetMultiAgentSystem (singleton) and
   *  dispose (per-instance). */
  isSingleton: boolean;
  promise: Promise<WorkflowResult>;
  /** Detach hook for the live streamer. */
  streamerDetach: (() => void) | null;
  /** Listener for workflow:event so we can persist + clean up. */
  eventListener: ((event: WorkflowEvent) => void) | null;
}

interface QueuedSlot {
  workflowId: string;
  goal: string;
  strategy: CollaborationStrategy;
  options: Partial<WorkflowOptions>;
  queuedAt: Date;
  resolve: (r: WorkflowResult) => void;
  reject: (err: unknown) => void;
}

let workflowCounter = 0;
function makeWorkflowId(): string {
  workflowCounter += 1;
  // 8 chars random + counter for uniqueness across rapid submits
  return `wf-${Date.now().toString(36)}-${workflowCounter.toString(36)}`;
}

/**
 * Phase (d).3 V0.4.1 — fleet stream opt-in for workflow lifecycle events.
 * Mirrors the agent:tool gate (CODEBUDDY_FLEET_STREAM=1). Best-effort,
 * lazy-imports the fleet bridge so this module stays usable in CLI-only
 * mode where no WS server is running.
 */
function isFleetStreamEnabled(): boolean {
  const v = process.env.CODEBUDDY_FLEET_STREAM;
  return v === '1' || v === 'true' || v === 'TRUE';
}

function emitFleetWorkflowEvent(
  type: 'fleet:workflow:event' | 'fleet:workflow:start' | 'fleet:workflow:complete',
  workflowId: string,
  payload: Record<string, unknown>,
): void {
  if (!isFleetStreamEnabled()) return;
  try {
    _broadcastFleetEvent(type, { workflowId, ...payload }, workflowId);
  } catch {
    // fleet-bridge swallows internally; this catches any surprise
    // (e.g. tests stubbing it weirdly). Best-effort, never breaks
    // workflow execution.
  }
}

/**
 * Reset the workflowId counter. For tests that need predictable ids.
 * Production code never calls this.
 */
export function _resetWorkflowCounterForTests(): void {
  workflowCounter = 0;
}

/**
 * Orchestrator singleton. Created lazily by getWorkflowOrchestrator;
 * reset via resetWorkflowOrchestrator (tests + /agents disable).
 */
export class WorkflowOrchestrator extends EventEmitter {
  private config: OrchestratorConfig;
  private active: Map<string, ActiveSlot> = new Map();
  private queue: QueuedSlot[] = [];
  /** Tracks how many MAS instances are currently in the pool (singleton + extras). */
  private singletonInUse = false;

  constructor(config: Partial<OrchestratorConfig> & Pick<OrchestratorConfig, 'apiKey'>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config } as OrchestratorConfig;
    if (this.config.maxConcurrentWorkflows < 1) {
      throw new Error('maxConcurrentWorkflows must be >= 1');
    }
  }

  /**
   * Submit a workflow. Returns either:
   * - { workflowId, status: 'started', promise } when a pool slot was free.
   * - { workflowId, status: 'queued', promise } when the queue absorbed it.
   * - { workflowId, status: 'rejected' } when queuePolicy='reject' and pool full.
   *   In that case, no promise is returned and the caller should handle.
   *
   * The `promise` resolves with the WorkflowResult or rejects on error,
   * regardless of whether the workflow started immediately or after queuing.
   */
  async submitWorkflow(
    goal: string,
    options: Partial<WorkflowOptions> = {},
  ): Promise<
    | { workflowId: string; status: 'started' | 'queued'; promise: Promise<WorkflowResult> }
    | { workflowId: string; status: 'rejected'; reason: string }
  > {
    const workflowId = makeWorkflowId();
    const strategy = options.strategy ?? 'hierarchical';

    if (this.active.size < this.config.maxConcurrentWorkflows) {
      const promise = this.startSlot(workflowId, goal, strategy, options);
      return { workflowId, status: 'started', promise };
    }

    if (this.config.queuePolicy === 'reject') {
      return {
        workflowId,
        status: 'rejected',
        reason: `Pool full (${this.config.maxConcurrentWorkflows}/${this.config.maxConcurrentWorkflows}) and queue_policy=reject. Try /agents stop first or wait.`,
      };
    }

    // Queue path. The promise is created here and resolved when the queued
    // slot eventually starts and completes.
    const promise = new Promise<WorkflowResult>((resolve, reject) => {
      this.queue.push({
        workflowId,
        goal,
        strategy,
        options,
        queuedAt: new Date(),
        resolve,
        reject,
      });
    });
    return { workflowId, status: 'queued', promise };
  }

  /**
   * Start a slot now: acquire a MAS, run the workflow, attach streamer +
   * persist on events, and arrange release/dequeue when complete.
   *
   * Registration is SYNCHRONOUS at the top — the slot is in `this.active`
   * before any await yields control to the event loop. Without this,
   * back-to-back submitWorkflow calls race: both see active.size=0 and
   * both start despite max_concurrent=1. async setup (initial save,
   * streamer attach) happens after registration is durable.
   */
  private startSlot(
    workflowId: string,
    goal: string,
    strategy: CollaborationStrategy,
    options: Partial<WorkflowOptions>,
  ): Promise<WorkflowResult> {
    const { mas, isSingleton } = this.acquireMAS();
    const startedAt = new Date();
    const liveState: PersistedWorkflow = {
      goal,
      startedAt: startedAt.toISOString(),
      strategy,
      status: 'running',
      plan: null,
      results: [],
      artifacts: [],
      timeline: [],
      errors: [],
    };

    // Debounced save on workflow:event — same pattern as agents-handler V0.3.
    let saveTimer: NodeJS.Timeout | null = null;
    const flush = () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      saveWorkflowById(workflowId, liveState).catch(() => {
        /* logged inside */
      });
    };
    const debouncedSave = () => {
      if (saveTimer) return;
      saveTimer = setTimeout(() => {
        saveTimer = null;
        flush();
      }, 500);
    };

    const eventListener = (event: WorkflowEvent) => {
      liveState.timeline.push(event);
      if (event.type === 'task_completed' && event.data) {
        const data = event.data as { task?: AgentTask; result?: AgentExecutionResult };
        if (data.task && data.result) {
          liveState.results.push([data.task.id, data.result]);
          if (data.result.artifacts?.length) {
            liveState.artifacts.push(...data.result.artifacts);
          }
        }
      }
      // Phase (d).3 — fleet broadcast (opt-in via CODEBUDDY_FLEET_STREAM=1).
      // Emit BEFORE the local re-emit so a throwing local listener can't
      // block the fleet broadcast.
      emitFleetWorkflowEvent('fleet:workflow:event', workflowId, { event });
      // Re-emit for listeners on the orchestrator (UI, tests).
      this.emit('workflow:event', { workflowId, event });
      debouncedSave();
    };
    (mas as unknown as {
      on: (e: string, h: (event: WorkflowEvent) => void) => void;
    }).on('workflow:event', eventListener);

    // Phase (d).3 — workflow lifecycle hooks for fleet streaming. Hooks
    // are detached automatically when finalizeSlot calls mas.off()
    // (only for workflow:event listener — start/complete listeners are
    // registered per-slot but the singleton MAS reuses listeners across
    // workflows; the fire-once `addListener` pattern handles that).
    const onMasStart = (data: unknown) => {
      const plan = (data as { plan?: { goal?: string } } | undefined)?.plan;
      emitFleetWorkflowEvent('fleet:workflow:start', workflowId, {
        goal: plan?.goal,
        strategy,
      });
    };
    const onMasComplete = (data: unknown) => {
      const result = (data as { result?: { success?: boolean; summary?: string; totalDuration?: number } } | undefined)?.result;
      emitFleetWorkflowEvent('fleet:workflow:complete', workflowId, {
        success: result?.success,
        summary: result?.summary,
        durationMs: result?.totalDuration,
      });
    };
    (mas as unknown as { once: (e: string, h: (data: unknown) => void) => void }).once('workflow:start', onMasStart);
    (mas as unknown as { once: (e: string, h: (data: unknown) => void) => void }).once('workflow:complete', onMasComplete);

    // Run the workflow synchronously (returns a promise). The mock's
    // mockImplementationOnce path needs runWorkflow called once; calling
    // it now means the slot's promise is wired before any await yields.
    const workflowOpts: Partial<WorkflowOptions> = { ...options, strategy };
    let streamerDetach: (() => void) | null = null;
    const promise = mas
      .runWorkflow(goal, workflowOpts)
      .then(
        (result) => {
          this.finalizeSlot(workflowId, mas, isSingleton, liveState, result, null, eventListener, streamerDetach, flush);
          return result;
        },
        (err: unknown) => {
          this.finalizeSlot(workflowId, mas, isSingleton, liveState, null, err, eventListener, streamerDetach, flush);
          throw err;
        },
      );

    // SYNCHRONOUS registration — must happen before any await downstream.
    this.active.set(workflowId, {
      workflowId,
      goal,
      strategy,
      startedAt,
      mas,
      isSingleton,
      promise,
      streamerDetach,
      eventListener,
    });
    this.emit('workflow:started', { workflowId, goal, strategy, startedAt });

    // Async setup: initial persistence + streamer attach. These happen in
    // the background; failure is best-effort and never aborts the workflow.
    saveWorkflowById(workflowId, liveState).catch(() => {
      /* logged inside */
    });
    void this.attachStreamerAsync(workflowId, mas).then((detach) => {
      streamerDetach = detach;
      const slot = this.active.get(workflowId);
      if (slot) slot.streamerDetach = detach;
    });

    return promise;
  }

  /**
   * Lazy-import the streamer module and attach. Returns the detach hook
   * or null on failure.
   */
  private async attachStreamerAsync(
    _workflowId: string,
    mas: MultiAgentSystem,
  ): Promise<(() => void) | null> {
    try {
      const { attachStreamer } = await import('./workflow-event-streamer.js');
      const handle = attachStreamer(mas as unknown as Parameters<typeof attachStreamer>[0]);
      return handle.detach;
    } catch (err) {
      logger.debug('[orchestrator] streamer attach skipped', { error: String(err) });
      return null;
    }
  }

  /**
   * Common cleanup path for both success + error. Persists final state,
   * releases the MAS slot, and pumps the queue if anything is waiting.
   */
  private finalizeSlot(
    workflowId: string,
    mas: MultiAgentSystem,
    isSingleton: boolean,
    liveState: PersistedWorkflow,
    result: WorkflowResult | null,
    err: unknown | null,
    eventListener: (event: WorkflowEvent) => void,
    streamerDetach: (() => void) | null,
    flush: () => void,
  ): void {
    // Detach streamer + listener first so any late events don't fire.
    if (streamerDetach) {
      try {
        streamerDetach();
      } catch {
        /* ignore */
      }
    }
    try {
      (mas as unknown as {
        off: (e: string, h: (event: WorkflowEvent) => void) => void;
      }).off('workflow:event', eventListener);
    } catch {
      /* ignore — older test mocks may lack .off */
    }

    // Persist final state.
    if (result) {
      liveState = {
        ...liveState,
        status: result.success ? 'completed' : 'failed',
        plan: result.plan ?? null,
        finishedAt: new Date().toISOString(),
        summary: result.summary,
        errors: result.errors ?? [],
      };
    } else {
      liveState = {
        ...liveState,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        errors: [err instanceof Error ? err.message : String(err)],
      };
    }
    flush();
    if (result?.success) {
      // Clean workflows are not kept on disk (matches V0.3 behaviour).
      clearWorkflowById(workflowId).catch(() => {
        /* logged inside */
      });
    }

    // Release MAS back to the pool.
    this.releaseMAS(mas, isSingleton);
    this.active.delete(workflowId);

    this.emit('workflow:finished', {
      workflowId,
      success: result?.success ?? false,
      summary: result?.summary,
      error: err ? (err instanceof Error ? err.message : String(err)) : undefined,
    });

    // Pump the queue.
    this.pumpQueue();
  }

  private pumpQueue(): void {
    while (
      this.active.size < this.config.maxConcurrentWorkflows &&
      this.queue.length > 0
    ) {
      const next = this.queue.shift();
      if (!next) break;
      // startSlot returns the promise; wire it to the queued resolve/reject
      // so the caller's submit() promise resolves correctly.
      this.startSlot(next.workflowId, next.goal, next.strategy, next.options).then(
        (r) => next.resolve(r),
        (e) => next.reject(e),
      );
    }
  }

  /**
   * Stop one workflow by id. Throws if `enable_per_workflow_stop` is false
   * (V0.4.1 default) — see honest-limitations note in the file header.
   */
  async stopWorkflow(workflowId: string): Promise<void> {
    if (!this.config.enablePerWorkflowStop) {
      throw new Error(
        `Per-workflow stop is disabled. V0.4.1 default — set ` +
          `coordination.enable_per_workflow_stop = true (V0.5 risk: may stop wrong slot since MAS lacks cancellation tokens). ` +
          `Use /agents stop (no id) to stop ALL active workflows.`,
      );
    }
    const slot = this.active.get(workflowId);
    if (!slot) {
      throw new Error(`No active workflow with id: ${workflowId}`);
    }
    slot.mas.stop();
    // The MAS finalize path handles release + queue pumping.
  }

  /**
   * Stop ALL active workflows. Drains the queue too (queued workflows are
   * rejected). Safe default; matches V0.3 /agents stop semantics for the
   * common case (max_concurrent = 1).
   */
  async stopAll(): Promise<void> {
    for (const slot of this.active.values()) {
      try {
        slot.mas.stop();
      } catch {
        /* ignore — best-effort */
      }
    }
    // Reject queued items so callers don't hang.
    while (this.queue.length > 0) {
      const q = this.queue.shift();
      if (!q) break;
      q.reject(new Error('Workflow cancelled by /agents stop'));
    }
  }

  getActive(): ActiveWorkflowInfo[] {
    return Array.from(this.active.values()).map((s) => ({
      workflowId: s.workflowId,
      goal: s.goal,
      strategy: s.strategy,
      startedAt: s.startedAt,
    }));
  }

  getQueue(): QueuedWorkflowInfo[] {
    return this.queue.map((q) => ({
      workflowId: q.workflowId,
      goal: q.goal,
      strategy: q.strategy,
      queuedAt: q.queuedAt,
    }));
  }

  /** Number of active + queued (for /agents status one-liner). */
  getStats(): { active: number; queued: number; capacity: number } {
    return {
      active: this.active.size,
      queued: this.queue.length,
      capacity: this.config.maxConcurrentWorkflows,
    };
  }

  /** Wait for an active workflow's promise. Returns null if not found. */
  getWorkflowPromise(workflowId: string): Promise<WorkflowResult> | null {
    return this.active.get(workflowId)?.promise ?? null;
  }

  /**
   * Acquire a MAS instance from the pool. Slot 0 = legacy singleton; slots
   * 1..N = newly created instances. Per-instance MAS is disposed on
   * release; the singleton is reset only if it's the last reference.
   */
  private acquireMAS(): { mas: MultiAgentSystem; isSingleton: boolean } {
    if (!this.singletonInUse) {
      const mas = this.config.perAgentOverrides
        ? getMultiAgentSystem(this.config.apiKey, this.config.baseURL, undefined, this.config.perAgentOverrides)
        : getMultiAgentSystem(this.config.apiKey, this.config.baseURL);
      this.singletonInUse = true;
      return { mas, isSingleton: true };
    }
    // Pool > 1 — create a fresh instance. Each is disposed on release.
    const mas = this.config.perAgentOverrides
      ? createMultiAgentSystem(this.config.apiKey, this.config.baseURL, undefined, this.config.perAgentOverrides)
      : createMultiAgentSystem(this.config.apiKey, this.config.baseURL);
    return { mas, isSingleton: false };
  }

  private releaseMAS(_mas: MultiAgentSystem, isSingleton: boolean): void {
    if (isSingleton) {
      this.singletonInUse = false;
      // Don't reset the singleton between workflows — its event listeners
      // (coordinator wiring) are reused. Match V0.3 behaviour.
      return;
    }
    try {
      _mas.dispose();
    } catch (err) {
      logger.debug('[orchestrator] MAS dispose failed (best-effort)', { error: String(err) });
    }
  }

  /** Reset all state. Used by /agents disable + tests. */
  dispose(): void {
    // Stop active workflows + reject queued.
    for (const slot of this.active.values()) {
      try {
        slot.mas.stop();
      } catch {
        /* ignore */
      }
      if (slot.streamerDetach) {
        try {
          slot.streamerDetach();
        } catch {
          /* ignore */
        }
      }
    }
    while (this.queue.length > 0) {
      const q = this.queue.shift();
      if (!q) break;
      q.reject(new Error('Orchestrator disposed'));
    }
    this.active.clear();
    if (this.singletonInUse) {
      resetMultiAgentSystem();
      this.singletonInUse = false;
    }
    this.removeAllListeners();
  }
}

// ─── Singleton accessor ───────────────────────────────────────────────────

let orchestratorInstance: WorkflowOrchestrator | null = null;

export function getWorkflowOrchestrator(
  config: Partial<OrchestratorConfig> & Pick<OrchestratorConfig, 'apiKey'>,
): WorkflowOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new WorkflowOrchestrator(config);
  }
  return orchestratorInstance;
}

export function resetWorkflowOrchestrator(): void {
  if (orchestratorInstance) {
    orchestratorInstance.dispose();
  }
  orchestratorInstance = null;
}

/** Test-only — direct access to the singleton if it exists. */
export function _peekWorkflowOrchestratorForTests(): WorkflowOrchestrator | null {
  return orchestratorInstance;
}
