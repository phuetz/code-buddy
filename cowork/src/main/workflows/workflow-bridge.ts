/**
 * WorkflowBridge — Cowork visual workflow CRUD + execution.
 *
 * Persists `WorkflowDefinition` records to `<userData>/workflows/workflows.json`
 * and runs them by compiling the visual DAG into the core
 * `WorkflowDefinition` shape, then delegating to the core
 * `Orchestrator` (`src/orchestration/orchestrator.ts`).
 *
 * The compile + execution pipeline is:
 *   visual DAG  →  dag-compiler.compileVisualToCore()  →  Orchestrator
 *
 * A custom agent (`CoworkToolAgent`) is registered at boot to fulfil the
 * two task types emitted by the compiler: `tool_invoke` (delegated to
 * `FormalToolRegistry`) and `approval_wait` (suspended until the renderer
 * answers via the `workflow.approve` IPC channel).
 *
 * @module main/workflows/workflow-bridge
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { ServerEvent } from '../../renderer/types';
import type {
  WorkflowVisualDefinition,
  WorkflowVisualNode,
  WorkflowVisualEdge,
  WorkflowEventPayload,
  WorkflowRunResult,
  PendingApproval,
} from '../../shared/workflow-types';
import { log, logError, logWarn } from '../utils/logger';
import { loadCoreModule } from '../utils/core-loader';
import { compileVisualToCore } from './dag-compiler';
import {
  CoworkToolAgent,
  COWORK_TOOL_AGENT_ID,
  type FormalToolRegistryLike,
} from './cowork-tool-agent';

// ──────────────────────────────────────────────────────────────────────────
// Persistence shapes — same as previous version, kept to avoid breaking
// existing workflows.json files in user data dirs.
// ──────────────────────────────────────────────────────────────────────────

export interface WorkflowNode extends WorkflowVisualNode {}
export interface WorkflowEdge extends WorkflowVisualEdge {}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt: number;
  updatedAt: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Core module shapes (loaded dynamically via core-loader)
// ──────────────────────────────────────────────────────────────────────────

interface CoreOrchestratorModule {
  Orchestrator: new (config?: Record<string, unknown>) => CoreOrchestrator;
}

interface CoreOrchestrator {
  registerAgent(definition: Record<string, unknown>): unknown;
  unregisterAgent(agentId: string): boolean;
  getTask(taskId: string): { definition: { id: string; type: string; input: Record<string, unknown> } } | undefined;
  completeTask(taskId: string, output: Record<string, unknown>): void;
  failTask(taskId: string, error: string): void;
  start(): void;
  stop(): void;
  startWorkflow(
    definition: Record<string, unknown>,
    input: Record<string, unknown>
  ): Promise<{
    instanceId: string;
    status: string;
    output?: Record<string, unknown>;
    error?: string;
    completedSteps: string[];
    startedAt: Date;
    completedAt?: Date;
  }>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  prependListener(event: string, handler: (...args: unknown[]) => void): void;
  removeListener(event: string, handler: (...args: unknown[]) => void): void;
  processQueue(): void;
}

interface CoreToolRegistryModule {
  getFormalToolRegistry(): FormalToolRegistryLike;
}

// ──────────────────────────────────────────────────────────────────────────
// Bridge
// ──────────────────────────────────────────────────────────────────────────

export class WorkflowBridge {
  private filePath: string;
  private cache: WorkflowDefinition[] | null = null;

  private orchestrator: CoreOrchestrator | null = null;
  private toolAgent: CoworkToolAgent | null = null;
  private orchestratorBootPromise: Promise<void> | null = null;
  private orchestratorBootError: string | null = null;
  private sendToRenderer: ((event: ServerEvent) => void) | null = null;

  /** Maps task.id → visual node.id, populated when a workflow is compiled. */
  private taskToVisualNode = new Map<string, string>();
  /** Maps Orchestrator instanceId → persistent workflow.id. */
  private instanceToWorkflowId = new Map<string, string>();
  /** Active workflow run, used to tag lifecycle events. V1 = 1 at a time. */
  private currentRun: { workflowId: string; instanceId: string } | null = null;

  constructor() {
    const userDataPath = app.getPath('userData');
    const dir = path.join(userDataPath, 'workflows');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.filePath = path.join(dir, 'workflows.json');
  }

  setSendToRenderer(fn: (event: ServerEvent) => void): void {
    this.sendToRenderer = fn;
  }

  // ────── CRUD ──────

  list(): WorkflowDefinition[] {
    if (this.cache) return this.cache;
    if (!fs.existsSync(this.filePath)) {
      this.cache = [];
      return this.cache;
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      this.cache = Array.isArray(parsed) ? (parsed as WorkflowDefinition[]) : [];
      return this.cache;
    } catch (err) {
      logWarn('[WorkflowBridge] failed to load workflows:', err);
      this.cache = [];
      return this.cache;
    }
  }

  get(id: string): WorkflowDefinition | null {
    return this.list().find((w) => w.id === id) ?? null;
  }

  create(input: Omit<WorkflowDefinition, 'id' | 'createdAt' | 'updatedAt'>): WorkflowDefinition {
    const now = Date.now();
    const definition: WorkflowDefinition = {
      ...input,
      id: `wf_${now}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      updatedAt: now,
    };
    const all = this.list();
    all.push(definition);
    this.persist(all);
    return definition;
  }

  update(id: string, patch: Partial<WorkflowDefinition>): WorkflowDefinition | null {
    const all = this.list();
    const index = all.findIndex((w) => w.id === id);
    if (index === -1) return null;
    const updated = { ...all[index], ...patch, id, updatedAt: Date.now() };
    all[index] = updated;
    this.persist(all);
    return updated;
  }

  delete(id: string): boolean {
    const all = this.list();
    const next = all.filter((w) => w.id !== id);
    if (next.length === all.length) return false;
    this.persist(next);
    return true;
  }

  // ────── Approval bridge ──────

  /** Called by the IPC handler when the renderer answers an approval. */
  approveStep(stepId: string, approved: boolean): boolean {
    if (!this.toolAgent) return false;
    return this.toolAgent.resolveApproval(stepId, approved);
  }

  // ────── Execution ──────

  async run(
    id: string,
    initialContext: Record<string, unknown> = {}
  ): Promise<WorkflowRunResult> {
    const definition = this.get(id);
    if (!definition) {
      return {
        success: false,
        status: 'failed',
        duration: 0,
        completedSteps: 0,
        totalSteps: 0,
        error: `Workflow not found: ${id}`,
      };
    }

    const totalNodes = definition.nodes.filter(
      (n) => n.type !== 'start' && n.type !== 'end'
    ).length;

    // Compile first — fail-fast on configuration errors before booting the
    // orchestrator, so users get a clear message at design time.
    const visual: WorkflowVisualDefinition = {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      nodes: definition.nodes,
      edges: definition.edges,
    };
    let coreDef;
    try {
      coreDef = compileVisualToCore(visual);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn('[WorkflowBridge] compile failed:', message);
      return {
        success: false,
        status: 'failed',
        duration: 0,
        completedSteps: 0,
        totalSteps: totalNodes,
        error: `Compilation error: ${message}`,
      };
    }

    // Lazy-boot orchestrator on first run.
    await this.ensureOrchestrator();
    if (!this.orchestrator || !this.toolAgent) {
      return {
        success: false,
        status: 'failed',
        duration: 0,
        completedSteps: 0,
        totalSteps: totalNodes,
        error: this.orchestratorBootError ?? 'Orchestrator unavailable',
      };
    }

    // Index tasks → visual node ids, used in lifecycle event handlers.
    this.indexTasksByVisualNode(coreDef);

    // Capture the orchestrator-generated instanceId synchronously so
    // lifecycle events fired during startWorkflow can be tagged with the
    // persistent workflow.id (V1 = one workflow at a time, the first
    // workflow_started event after our call is ours).
    let captured = false;
    const captureHandler = (...args: unknown[]): void => {
      if (captured) return;
      captured = true;
      const evt = args[0] as { instanceId: string };
      this.instanceToWorkflowId.set(evt.instanceId, definition.id);
      this.currentRun = { workflowId: definition.id, instanceId: evt.instanceId };
    };
    // prependListener so we run BEFORE the global lifecycle emitter installed
    // in ensureOrchestrator — otherwise the first emit would carry an empty
    // workflowId because instanceToWorkflowId hasn't been populated yet.
    this.orchestrator.prependListener('workflow_started', captureHandler);

    const startedAt = Date.now();
    try {
      const instance = await this.orchestrator.startWorkflow(
        coreDef as unknown as Record<string, unknown>,
        initialContext
      );
      // Final safety: ensure the mapping is set even if our handler
      // missed the event (defensive).
      this.instanceToWorkflowId.set(instance.instanceId, definition.id);
      const duration = Date.now() - startedAt;
      const success = instance.status === 'completed';

      // Final emit so the renderer can mark the workflow complete.
      this.emitWorkflowEvent({
        type: success ? 'completed' : 'failed',
        workflowId: definition.id,
        instanceId: instance.instanceId,
        ...(success
          ? { output: instance.output ?? {} }
          : { error: instance.error ?? 'Workflow failed' }),
      } as WorkflowEventPayload);

      this.taskToVisualNode.clear();
      this.instanceToWorkflowId.delete(instance.instanceId);
      this.currentRun = null;

      log('[WorkflowBridge] run finished:', definition.id, instance.status);
      return {
        success,
        status: success ? 'completed' : 'failed',
        duration,
        completedSteps: instance.completedSteps.length,
        totalSteps: totalNodes,
        instanceId: instance.instanceId,
        output: instance.output,
        error: instance.error,
      };
    } catch (err) {
      const duration = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      logWarn('[WorkflowBridge] run failed:', message);
      this.taskToVisualNode.clear();
      return {
        success: false,
        status: 'failed',
        duration,
        completedSteps: 0,
        totalSteps: totalNodes,
        error: message,
      };
    } finally {
      this.orchestrator?.removeListener('workflow_started', captureHandler);
    }
  }

  /** Cancel any pending approvals (e.g. on app shutdown). */
  shutdown(): void {
    this.toolAgent?.cancelPending(undefined, 'shutdown');
    this.orchestrator?.stop();
  }

  // ──────── Internals ────────

  private async ensureOrchestrator(): Promise<void> {
    if (this.orchestrator && this.toolAgent) return;
    if (this.orchestratorBootPromise) return this.orchestratorBootPromise;

    this.orchestratorBootPromise = (async () => {
      try {
        const orchestratorModule = await loadCoreModule<CoreOrchestratorModule>(
          'orchestration/orchestrator.js'
        );
        const registryModule = await loadCoreModule<CoreToolRegistryModule>(
          'tools/registry/index.js'
        );
        if (!orchestratorModule || !registryModule) {
          throw new Error('Orchestrator or tool registry core module unavailable');
        }
        const orchestrator = new orchestratorModule.Orchestrator({
          maxAgents: 4,
          logLevel: 'warn',
        });
        const registry = registryModule.getFormalToolRegistry();

        const toolAgent = new CoworkToolAgent({
          registry,
          onApprovalRequired: (payload) => {
            const approval: PendingApproval = {
              workflowInstanceId: payload.workflowInstanceId,
              stepId: payload.stepId,
              message: payload.message,
              expiresAt: payload.expiresAt,
            };
            this.sendToRenderer?.({
              type: 'workflow.approval_required',
              payload: approval,
            });
          },
        });

        // Register N agents in the orchestrator. The core's
        // findAvailableAgent allocates one task per agent (status ===
        // 'idle' check), so to support parallel branches we need several
        // worker slots. They all share the same `CoworkToolAgent` logic.
        const WORKER_POOL_SIZE = 4;
        for (let i = 0; i < WORKER_POOL_SIZE; i++) {
          orchestrator.registerAgent({
            id: i === 0 ? COWORK_TOOL_AGENT_ID : `${COWORK_TOOL_AGENT_ID}-${i}`,
            name: `Cowork Tool Runner ${i}`,
            role: 'executor',
            description: 'Executes tool_invoke and approval_wait tasks for visual workflows',
            capabilities: {
              tools: [],
              maxConcurrency: 1,
              taskTypes: ['tool_invoke', 'approval_wait'],
            },
          });
        }

        // Listen for task assignments and execute them in the agent.
        // This is the substitute for a "task processor" hook that the
        // core Orchestrator does not expose directly.
        orchestrator.on('task_assigned', async (...args: unknown[]) => {
          const evt = args[0] as { taskId: string; agentId: string };
          if (!evt.agentId.startsWith(COWORK_TOOL_AGENT_ID)) return;
          const task = orchestrator.getTask(evt.taskId);
          if (!task) {
            logWarn('[WorkflowBridge] task_assigned for unknown task:', evt.taskId);
            return;
          }
          const visualNodeId = (task.definition.input.cowork_visual_node_id as
            | string
            | undefined) ?? null;

          // V1 = single concurrent workflow, so the active run holds the
          // mapping. If no run is active we fall back to empty strings —
          // shouldn't happen but defensive.
          const workflowInstanceId = this.currentRun?.instanceId ?? '';
          const workflowId = this.currentRun?.workflowId ?? '';

          if (visualNodeId) {
            this.emitWorkflowEvent({
              type: 'node_started',
              workflowId,
              instanceId: workflowInstanceId,
              nodeId: visualNodeId,
            });
          }

          try {
            let output: Record<string, unknown>;
            if (task.definition.type === 'tool_invoke') {
              output = await toolAgent.runToolInvoke(task.definition.input);
            } else if (task.definition.type === 'approval_wait') {
              output = await toolAgent.runApprovalWait(
                task.definition.input,
                workflowInstanceId
              );
            } else {
              throw new Error(`Unsupported task type '${task.definition.type}'`);
            }
            orchestrator.completeTask(evt.taskId, output);
            if (visualNodeId) {
              this.emitWorkflowEvent({
                type: 'node_completed',
                workflowId,
                instanceId: workflowInstanceId,
                nodeId: visualNodeId,
                output,
              });
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            orchestrator.failTask(evt.taskId, message);
            if (visualNodeId) {
              this.emitWorkflowEvent({
                type: 'node_failed',
                workflowId,
                instanceId: workflowInstanceId,
                nodeId: visualNodeId,
                error: message,
              });
            }
          }
        });

        orchestrator.on('workflow_started', (...args: unknown[]) => {
          const evt = args[0] as { instanceId: string };
          const wfId = this.workflowIdForInstance(evt.instanceId) ?? '';
          this.emitWorkflowEvent({
            type: 'started',
            workflowId: wfId,
            instanceId: evt.instanceId,
          });
        });

        // The core Orchestrator only triggers `processQueue()` from
        // start(), completeTask(), and failTask(). Without this hook the
        // very first task of a workflow would sit in the queue forever
        // (waitForTask polls but never sees it assigned). The microtask
        // defer ensures we run AFTER `queueTask()` has pushed into the
        // queue — `task_created` fires synchronously *before* `queueTask`
        // in the executeTaskStep code path.
        orchestrator.on('task_created', () => {
          queueMicrotask(() => orchestrator.processQueue());
        });

        orchestrator.start();
        this.orchestrator = orchestrator;
        this.toolAgent = toolAgent;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logError('[WorkflowBridge] orchestrator boot failed:', message);
        this.orchestratorBootError = message;
      } finally {
        this.orchestratorBootPromise = null;
      }
    })();

    return this.orchestratorBootPromise;
  }

  /**
   * Walks the compiled core definition to populate per-task input fields
   * (`cowork_workflow_instance_id` is added at run-time via mutation, so we
   * keep `cowork_visual_node_id` only here — the instance id is set by the
   * orchestrator before the task is queued, and we read it from the task
   * input in the assignment handler).
   *
   * We also build a small map task.id → visual node.id used to emit
   * lifecycle events, even though we currently read the node id directly
   * from `task.definition.input.cowork_visual_node_id`.
   */
  private indexTasksByVisualNode(coreDef: { steps: unknown[] }): void {
    this.taskToVisualNode.clear();
    const walk = (steps: unknown[]) => {
      for (const stepUnknown of steps) {
        const step = stepUnknown as {
          tasks?: Array<{ id: string; input: Record<string, unknown> }>;
          branches?: unknown[][];
          trueBranch?: unknown[];
          falseBranch?: unknown[];
          loopBody?: unknown[];
        };
        if (step.tasks) {
          for (const t of step.tasks) {
            const nodeId = t.input.cowork_visual_node_id;
            if (typeof nodeId === 'string') {
              this.taskToVisualNode.set(t.id, nodeId);
            }
          }
        }
        if (step.branches) {
          for (const branch of step.branches) walk(branch);
        }
        if (step.trueBranch) walk(step.trueBranch);
        if (step.falseBranch) walk(step.falseBranch);
        if (step.loopBody) walk(step.loopBody);
      }
    };
    walk(coreDef.steps);
  }

  /**
   * The orchestrator's instance id is opaque (`wf_<ts>_<rnd>`); we don't
   * keep a workflow.id ↔ instance.id map (one workflow can have many
   * instances). For now we just return null — the renderer reads the
   * `workflowId` field, which we set from the most recent run via the
   * compiled definition.id (which equals the persisted workflow id).
   */
  private workflowIdForInstance(instanceId: string): string | null {
    return this.instanceToWorkflowId.get(instanceId) ?? null;
  }

  private emitWorkflowEvent(payload: WorkflowEventPayload): void {
    if (!this.sendToRenderer) return;
    this.sendToRenderer({ type: 'workflow.event', payload });
  }

  private persist(workflows: WorkflowDefinition[]): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(workflows, null, 2), 'utf-8');
      this.cache = workflows;
    } catch (err) {
      logWarn('[WorkflowBridge] persist failed:', err);
    }
  }
}
