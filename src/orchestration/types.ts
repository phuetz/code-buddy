/**
 * Multi-Agent Orchestration Types
 *
 * Type definitions for coordinating multiple agents on complex tasks.
 */

// ============================================================================
// Agent Types
// ============================================================================

export type AgentRole =
  | 'coordinator'   // Coordinates other agents
  | 'researcher'    // Gathers information
  | 'coder'         // Writes code
  | 'reviewer'      // Reviews code/output
  | 'tester'        // Tests implementations
  | 'documenter'    // Creates documentation
  | 'planner'       // Creates plans
  | 'executor'      // Executes plans
  | 'custom';       // Custom role

export type AgentStatus =
  | 'idle'
  | 'busy'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'paused';

export interface AgentCapabilities {
  /** Available tools */
  tools: string[];
  /** Maximum concurrent tasks */
  maxConcurrency: number;
  /** Supported task types */
  taskTypes: string[];
  /** Model to use */
  model?: string;
  /** Custom system prompt */
  systemPrompt?: string;
}

export interface AgentDefinition {
  /** Unique agent ID */
  id: string;
  /** Display name */
  name: string;
  /** Agent role */
  role: AgentRole;
  /** Description */
  description: string;
  /** Capabilities */
  capabilities: AgentCapabilities;
  /** Dependencies on other agents */
  dependsOn?: string[];
  /** Priority (higher = more important) */
  priority?: number;
}

export interface AgentInstance {
  /** Definition */
  definition: AgentDefinition;
  /** Current status */
  status: AgentStatus;
  /** Current task */
  currentTask?: string;
  /** Completed tasks count */
  completedTasks: number;
  /** Failed tasks count */
  failedTasks: number;
  /** Creation time */
  createdAt: Date;
  /** Last activity */
  lastActivity: Date;
}

// ============================================================================
// Task Types
// ============================================================================

export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'assigned'
  | 'in_progress'
  | 'waiting_review'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export interface TaskDefinition {
  /** Unique task ID */
  id: string;
  /** Task type */
  type: string;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Input data */
  input: Record<string, unknown>;
  /** Required agent role */
  requiredRole?: AgentRole;
  /** Required capabilities */
  requiredCapabilities?: string[];
  /** Dependencies (other task IDs) */
  dependsOn?: string[];
  /** Priority */
  priority: TaskPriority;
  /** Timeout in ms */
  timeout?: number;
  /** Retry count */
  maxRetries?: number;
  /** Parent task (for subtasks) */
  parentId?: string;
  /**
   * Optional alias key under which the orchestrator additionally stores
   * `task.output` in the workflow context. Without it, the result is
   * only reachable as `context['task_<id>']`. With it, downstream
   * conditions and tool inputs can reference `$<aliasAs>` directly,
   * which is more readable for humans authoring visual workflows.
   */
  aliasAs?: string;
}

export interface TaskInstance {
  /** Definition */
  definition: TaskDefinition;
  /** Current status */
  status: TaskStatus;
  /** Assigned agent */
  assignedAgent?: string;
  /** Output data */
  output?: Record<string, unknown>;
  /** Error message */
  error?: string;
  /** Retry count */
  retries: number;
  /** Created timestamp */
  createdAt: Date;
  /** Started timestamp */
  startedAt?: Date;
  /** Completed timestamp */
  completedAt?: Date;
}

// ============================================================================
// Communication Types
// ============================================================================

export type MessageType =
  | 'task_request'
  | 'task_response'
  | 'status_update'
  | 'question'
  | 'answer'
  | 'broadcast'
  | 'handoff';

export interface AgentMessage {
  /** Message ID */
  id: string;
  /** Message type */
  type: MessageType;
  /** Sender agent ID */
  from: string;
  /** Recipient agent ID (null for broadcast) */
  to: string | null;
  /** Message content */
  content: unknown;
  /** Related task ID */
  taskId?: string;
  /** Timestamp */
  timestamp: Date;
  /** Requires acknowledgment */
  requiresAck?: boolean;
}

// ============================================================================
// Workflow Types
// ============================================================================

export type WorkflowStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface WorkflowStep {
  /** Step ID */
  id: string;
  /** Step name */
  name: string;
  /** Step type */
  type: 'task' | 'parallel' | 'conditional' | 'loop' | 'batch';
  /** Task definitions for this step */
  tasks?: TaskDefinition[];
  /** Parallel branches (for parallel type) */
  branches?: WorkflowStep[][];
  /** Condition (for conditional type) */
  condition?: string;
  /** True branch */
  trueBranch?: WorkflowStep[];
  /** False branch */
  falseBranch?: WorkflowStep[];
  /** Loop condition (for loop type) */
  loopCondition?: string;
  /** Loop body */
  loopBody?: WorkflowStep[];
  /** Per-loop iteration ceiling. Always clamped to the runtime hard cap (100). */
  maxIterations?: number;
  /** Batch items expression */
  batchItemsExpression?: string;
  /** Batch variable name */
  batchVariableName?: string;
  /** Batch concurrency limit */
  batchConcurrencyLimit?: number;
  /** Batch body */
  batchBody?: WorkflowStep[];
  /** Dependencies */
  dependsOn?: string[];
}

export interface WorkflowDefinition {
  /** Workflow ID */
  id: string;
  /** Workflow name */
  name: string;
  /** Description */
  description: string;
  /** Workflow steps */
  steps: WorkflowStep[];
  /** Input schema */
  inputSchema?: Record<string, unknown>;
  /** Output schema */
  outputSchema?: Record<string, unknown>;
  /** Maximum duration in ms */
  maxDuration?: number;
}

export interface WorkflowInstance {
  /** Definition */
  definition: WorkflowDefinition;
  /** Instance ID */
  instanceId: string;
  /** Current status */
  status: WorkflowStatus;
  /** Input data */
  input: Record<string, unknown>;
  /** Output data */
  output?: Record<string, unknown>;
  /** Current step */
  currentStep?: string;
  /** Completed steps */
  completedSteps: string[];
  /** Task instances */
  tasks: Map<string, TaskInstance>;
  /** Started timestamp */
  startedAt: Date;
  /** Completed timestamp */
  completedAt?: Date;
  /** Error */
  error?: string;
}

// ============================================================================
// Orchestrator Types
// ============================================================================

export interface OrchestratorConfig {
  /** Maximum concurrent agents */
  maxAgents: number;
  /** Maximum concurrent tasks */
  maxTasks: number;
  /** Task queue size */
  taskQueueSize: number;
  /** Default timeout */
  defaultTimeout: number;
  /** Enable auto-scaling */
  autoScale: boolean;
  /** Logging level */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface OrchestratorStats {
  /** Active agents */
  activeAgents: number;
  /** Idle agents */
  idleAgents: number;
  /** Pending tasks */
  pendingTasks: number;
  /** Running tasks */
  runningTasks: number;
  /** Completed tasks */
  completedTasks: number;
  /** Failed tasks */
  failedTasks: number;
  /** Average task duration */
  avgTaskDuration: number;
  /** Throughput (tasks/min) */
  throughput: number;
  /** Uptime */
  uptime: number;
}

// ============================================================================
// Event Types
// ============================================================================

export type OrchestratorEvent =
  | { type: 'agent_created'; agent: AgentInstance }
  | { type: 'agent_destroyed'; agentId: string }
  | { type: 'agent_status_changed'; agentId: string; status: AgentStatus }
  | { type: 'task_created'; task: TaskInstance }
  | { type: 'task_assigned'; taskId: string; agentId: string }
  | { type: 'task_completed'; taskId: string; output: unknown }
  | { type: 'task_failed'; taskId: string; error: string }
  | { type: 'workflow_started'; instanceId: string }
  | { type: 'workflow_step_completed'; instanceId: string; stepId: string }
  | { type: 'workflow_completed'; instanceId: string; output: unknown }
  | { type: 'workflow_failed'; instanceId: string; error: string }
  | { type: 'message_sent'; message: AgentMessage };

export type OrchestratorEventHandler = (event: OrchestratorEvent) => void;
