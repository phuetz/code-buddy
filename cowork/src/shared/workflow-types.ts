/**
 * Workflow type definitions shared between the main process, the renderer,
 * and the preload. The visual DAG editor (`WorkflowEditor.tsx`) writes these
 * shapes; the bridge compiler (`workflow-bridge.ts` + `dag-compiler.ts`)
 * reads them and converts to the core `WorkflowDefinition` understood by the
 * `Orchestrator`.
 */

export type WorkflowNodeType =
  | 'start'
  | 'end'
  | 'tool'
  | 'condition'
  | 'parallel'
  | 'approval'
  | 'loop'
  | 'batch'
  | 'setVariable';

export interface BatchNodeConfig {
  itemsExpression: string;
  variableName: string;
  concurrencyLimit?: number;
}

export interface ToolNodeConfig {
  toolName: string;
  toolInput: Record<string, unknown>;
  /**
   * If set, the core orchestrator will re-queue the task on failure up
   * to `maxRetries` times before marking the workflow failed
   * (cf. `Orchestrator.failTask` in `src/orchestration/orchestrator.ts`).
   */
  maxRetries?: number;
  /**
   * Optional alias under which the tool result is stored in the
   * workflow context. Without it, the result is reachable as
   * `task_<nodeId>`. With it, downstream condition expressions /
   * tool inputs can reference `$<outputAs>` for readability.
   */
  outputAs?: string;
}

export interface SetVariableNodeConfig {
  /** Variable name (e.g. "myList"). Will be available as `$myList` later. */
  name: string;
  /**
   * JSON-literal value or a JS expression evaluated in the workflow
   * context. The compiler does NOT eval here — the runtime agent
   * does (via the same safeEvalCondition path, narrow to a single
   * expression).
   */
  valueExpression: string;
}

export interface ConditionNodeConfig {
  expression: string;
}

export interface ApprovalNodeConfig {
  message: string;
  timeoutMs?: number;
}

export interface LoopNodeConfig {
  /** Condition string, evaluated by the core safeEvalCondition. */
  condition: string;
  /** Hard cap to prevent infinite loops. Defaults to 100 (core engine limit). */
  maxIterations?: number;
}

export type WorkflowNodeConfig =
  | ToolNodeConfig
  | ConditionNodeConfig
  | ApprovalNodeConfig
  | LoopNodeConfig
  | BatchNodeConfig
  | Record<string, never>;

export interface WorkflowVisualNode {
  id: string;
  type: WorkflowNodeType;
  name: string;
  position: { x: number; y: number };
  config?: WorkflowNodeConfig;
}

export interface WorkflowVisualEdge {
  id: string;
  source: string;
  target: string;
  /**
   * Edge label used by structural nodes :
   * - `condition` outgoing edges: `'true'` / `'false'`.
   * - `loop` outgoing edges: `'body'` / `'exit'`.
   */
  label?: 'true' | 'false' | 'body' | 'exit';
}

export interface WorkflowVisualDefinition {
  id?: string;
  name: string;
  description?: string;
  nodes: WorkflowVisualNode[];
  edges: WorkflowVisualEdge[];
}

/** Lifecycle state of a node during a single execution. */
export type WorkflowNodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface WorkflowExecutionState {
  workflowId: string;
  instanceId: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  /** Per-node status keyed by visual node id. */
  nodeStatuses: Record<string, WorkflowNodeStatus>;
  /** Error message when status === 'failed'. */
  error?: string;
}

export interface PendingApproval {
  /** Stable id derived from the visual node id, used to match the IPC reply. */
  stepId: string;
  workflowInstanceId: string;
  message: string;
  /** Absolute timestamp in ms when the approval will auto-reject. */
  expiresAt?: number;
  /**
   * Optional preview of the imminent action the approval guards. When
   * present, the ApprovalDialog renders a JSON preview + a destructive
   * warning if the tool/input matches a known-risky pattern.
   */
  payload?: {
    toolName?: string;
    toolInput?: Record<string, unknown>;
  };
}

export type WorkflowEventPayload =
  | {
      type: 'started';
      workflowId: string;
      instanceId: string;
    }
  | {
      type: 'node_started';
      workflowId: string;
      instanceId: string;
      nodeId: string;
    }
  | {
      type: 'node_completed';
      workflowId: string;
      instanceId: string;
      nodeId: string;
      output?: Record<string, unknown>;
    }
  | {
      type: 'node_failed';
      workflowId: string;
      instanceId: string;
      nodeId: string;
      error: string;
    }
  | {
      type: 'completed';
      workflowId: string;
      instanceId: string;
      output?: Record<string, unknown>;
    }
  | {
      type: 'failed';
      workflowId: string;
      instanceId: string;
      error: string;
    };

export interface WorkflowRunResult {
  success: boolean;
  status: 'completed' | 'failed';
  duration: number;
  completedSteps: number;
  totalSteps: number;
  instanceId?: string;
  /** Persistent supervision record id for history, comparison and replay. */
  runId?: string;
  output?: Record<string, unknown>;
  error?: string;
}
