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
  | 'approval';

export interface ToolNodeConfig {
  toolName: string;
  toolInput: Record<string, unknown>;
}

export interface ConditionNodeConfig {
  expression: string;
}

export interface ApprovalNodeConfig {
  message: string;
  timeoutMs?: number;
}

export type WorkflowNodeConfig =
  | ToolNodeConfig
  | ConditionNodeConfig
  | ApprovalNodeConfig
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
  /** Used by `condition` nodes to label which output edge is the true/false branch. */
  label?: 'true' | 'false';
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
  output?: Record<string, unknown>;
  error?: string;
}
