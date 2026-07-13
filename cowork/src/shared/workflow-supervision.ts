import type {
  WorkflowEventPayload,
  WorkflowRunResult,
  WorkflowVisualDefinition,
} from './workflow-types';

export type WorkflowRunSource = 'manual' | 'replay';

export interface WorkflowDryRunStep {
  id: string;
  kind: 'task' | 'parallel' | 'conditional' | 'loop' | 'batch';
  label: string;
  depth: number;
  toolName?: string;
  requiresApproval: boolean;
  branches?: number;
}

export interface WorkflowDryRunResult {
  valid: boolean;
  workflowId: string;
  definitionHash?: string;
  generatedAt: number;
  totalExecutableSteps: number;
  approvalSteps: number;
  externalToolSteps: number;
  steps: WorkflowDryRunStep[];
  warnings: string[];
  error?: string;
}

export type WorkflowFailureCategory =
  | 'secret_input'
  | 'compilation'
  | 'approval'
  | 'permission'
  | 'authentication'
  | 'tool_missing'
  | 'timeout'
  | 'network'
  | 'runtime';

export interface WorkflowFailureDiagnostic {
  category: WorkflowFailureCategory;
  title: string;
  explanation: string;
  failedNodeId?: string;
  suggestedActions: Array<{
    id: string;
    label: string;
    description: string;
    safeAutomatic: false;
  }>;
}

export interface WorkflowRunRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  source: WorkflowRunSource;
  replayOf?: string;
  definitionHash: string;
  definition: WorkflowVisualDefinition;
  initialContext: Record<string, unknown>;
  startedAt: number;
  completedAt: number;
  result: WorkflowRunResult;
  events: WorkflowEventPayload[];
  diagnostic?: WorkflowFailureDiagnostic;
}

export interface WorkflowRunComparison {
  leftRunId: string;
  rightRunId: string;
  sameDefinition: boolean;
  statusChanged: boolean;
  durationDeltaMs: number;
  completedStepsDelta: number;
  changedError: boolean;
  summary: string[];
}
