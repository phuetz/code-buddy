/**
 * `CoworkToolAgent` — registers itself with the core `Orchestrator` and
 * fulfils the two task types emitted by the visual DAG compiler:
 *  - `tool_invoke` → delegates to `FormalToolRegistry.execute(toolName, toolInput)`
 *  - `approval_wait` → suspends until the renderer signals approval/rejection
 *    via the `workflow.approve` IPC channel.
 *
 * The agent does not hold the orchestrator instance directly — it is wired
 * by `WorkflowBridge` which subscribes to `task_assigned` events and routes
 * those targeting `cowork-tool-runner` to this class.
 */
import { logWarn } from '../utils/logger';

export const COWORK_TOOL_AGENT_ID = 'cowork-tool-runner';

export interface ToolInvokeOutput {
  success: boolean;
  output?: unknown;
  error?: string;
  toolName: string;
  duration: number;
}

export interface FormalToolRegistryLike {
  execute(
    name: string,
    input: Record<string, unknown>,
    context?: unknown
  ): Promise<{
    success: boolean;
    output?: unknown;
    error?: string;
    toolName: string;
    duration: number;
  }>;
}

export interface ApprovalRequestPayload {
  workflowInstanceId: string;
  stepId: string;
  message: string;
  expiresAt?: number;
}

export interface CoworkToolAgentOptions {
  registry: FormalToolRegistryLike;
  /** Called when an approval is required so the bridge can forward it to the renderer. */
  onApprovalRequired: (payload: ApprovalRequestPayload) => void;
}

interface PendingApproval {
  resolve: (approved: boolean) => void;
  reject: (err: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  workflowInstanceId: string;
}

export class CoworkToolAgent {
  private pending = new Map<string, PendingApproval>();
  constructor(private readonly options: CoworkToolAgentOptions) {}

  /**
   * Run a `tool_invoke` task: extract toolName/toolInput from `input`,
   * invoke the FormalToolRegistry, and shape the response so the
   * orchestrator stores it in the workflow context.
   */
  async runToolInvoke(taskInput: Record<string, unknown>): Promise<Record<string, unknown>> {
    const toolName = taskInput.toolName;
    if (typeof toolName !== 'string' || toolName.length === 0) {
      throw new Error('tool_invoke task missing string toolName');
    }
    const toolInput = (taskInput.toolInput as Record<string, unknown>) ?? {};
    const result = await this.options.registry.execute(toolName, toolInput);
    if (!result.success) {
      throw new Error(result.error ?? `Tool '${toolName}' failed without error message`);
    }
    return {
      success: true,
      output: result.output,
      toolName: result.toolName,
      duration: result.duration,
    };
  }

  /**
   * Run an `approval_wait` task: emit an approval request to the renderer
   * (via the bridge), then await `resolveApproval(stepId, approved)`.
   * Auto-rejects after `timeoutMs` (default 60 s) if no answer arrives.
   */
  async runApprovalWait(
    taskInput: Record<string, unknown>,
    workflowInstanceId: string
  ): Promise<Record<string, unknown>> {
    const stepId = taskInput.stepId;
    if (typeof stepId !== 'string' || stepId.length === 0) {
      throw new Error('approval_wait task missing stepId');
    }
    const message =
      typeof taskInput.message === 'string' ? taskInput.message : 'Approval required';
    const timeoutMs =
      typeof taskInput.timeoutMs === 'number' && taskInput.timeoutMs > 0
        ? taskInput.timeoutMs
        : 60000;

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      // Reject any prior pending approval for the same stepId — should not
      // happen in practice, but keeps the map sane.
      const prior = this.pending.get(stepId);
      if (prior) {
        clearTimeout(prior.timeoutHandle);
        prior.reject(new Error('Approval superseded by a new request'));
      }

      const timeoutHandle = setTimeout(() => {
        const entry = this.pending.get(stepId);
        if (!entry) return;
        this.pending.delete(stepId);
        reject(new Error(`Approval for step '${stepId}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(stepId, {
        resolve: (approved: boolean) => {
          clearTimeout(timeoutHandle);
          this.pending.delete(stepId);
          if (approved) {
            resolve({ approved: true, stepId });
          } else {
            reject(new Error(`Approval for step '${stepId}' was rejected`));
          }
        },
        reject: (err: Error) => {
          clearTimeout(timeoutHandle);
          this.pending.delete(stepId);
          reject(err);
        },
        timeoutHandle,
        workflowInstanceId,
      });

      try {
        this.options.onApprovalRequired({
          workflowInstanceId,
          stepId,
          message,
          expiresAt: Date.now() + timeoutMs,
        });
      } catch (err) {
        // Failing to surface the request is fatal for this task — the user
        // can never answer, so we reject early.
        const entry = this.pending.get(stepId);
        if (entry) {
          clearTimeout(entry.timeoutHandle);
          this.pending.delete(stepId);
        }
        logWarn('[CoworkToolAgent] onApprovalRequired threw:', err);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Called by the bridge when the renderer answers the approval IPC.
   * Returns true if a pending approval matched.
   */
  resolveApproval(stepId: string, approved: boolean): boolean {
    const entry = this.pending.get(stepId);
    if (!entry) return false;
    entry.resolve(approved);
    return true;
  }

  /**
   * Cancel all pending approvals (e.g. when shutting down or the workflow
   * was aborted). Optionally scoped to a single workflow instance.
   */
  cancelPending(workflowInstanceId?: string, reason = 'cancelled'): void {
    for (const [stepId, entry] of this.pending.entries()) {
      if (workflowInstanceId && entry.workflowInstanceId !== workflowInstanceId) continue;
      this.pending.delete(stepId);
      clearTimeout(entry.timeoutHandle);
      entry.reject(new Error(reason));
    }
  }

  /** Number of approvals waiting for a renderer answer. Used in tests. */
  pendingCount(): number {
    return this.pending.size;
  }
}
