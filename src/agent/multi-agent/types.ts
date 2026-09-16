/**
 * Multi-Agent System Types
 *
 * Defines the core types and interfaces for the multi-agent collaborative system.
 * Based on research from:
 * - ComplexAgents (EMNLP 2024)
 * - Paper2Code (arXiv 2504.17192)
 * - AgentCoder (Huang et al., 2023)
 */

import { CodeBuddyToolCall } from "../../codebuddy/client.js";
import { ToolResult } from "../../types/index.js";
import type {
  ThreadDelegationEvent,
  ThreadParentBudget,
} from "../delegation/thread-delegation.js";

/**
 * Agent roles in the multi-agent system
 */
export type AgentRole =
  | "orchestrator"   // Coordinates and plans high-level tasks
  | "coder"          // Generates and modifies code
  | "reviewer"       // Reviews code for quality and issues
  | "tester"         // Runs and analyzes tests
  | "researcher"     // Searches documentation and codebase
  | "debugger"       // Diagnoses and fixes bugs
  | "architect"      // Designs system architecture
  | "documenter";    // Writes documentation

/**
 * Task status in the workflow
 */
export type TaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "blocked"
  | "review_required";

/**
 * Priority levels for tasks
 */
export type TaskPriority = "critical" | "high" | "medium" | "low";

/**
 * A single task in the multi-agent workflow
 */
export interface AgentTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignedTo: AgentRole;
  dependencies: string[];  // Task IDs this depends on
  subtasks: AgentTask[];
  artifacts: TaskArtifact[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  error?: string;
}

/**
 * An artifact produced by a task (code, document, etc.)
 */
export interface TaskArtifact {
  id: string;
  type: "code" | "document" | "test" | "diagram" | "analysis" | "diff";
  name: string;
  content: string;
  filePath?: string;
  language?: string;
  metadata: Record<string, unknown>;
}

/**
 * A plan created by the orchestrator
 */
export interface ExecutionPlan {
  id: string;
  goal: string;
  summary: string;
  phases: PlanPhase[];
  estimatedComplexity: "simple" | "moderate" | "complex" | "very_complex";
  requiredAgents: AgentRole[];
  createdAt: Date;
  status: "draft" | "approved" | "executing" | "completed" | "failed";
}

/**
 * A phase within an execution plan
 */
export interface PlanPhase {
  id: string;
  name: string;
  description: string;
  tasks: AgentTask[];
  parallelizable: boolean;
  order: number;
}

/**
 * Message passed between agents
 */
export interface AgentMessage {
  id: string;
  from: AgentRole;
  to: AgentRole | "all";
  type: "request" | "response" | "feedback" | "delegation" | "status_update";
  content: string;
  data?: unknown;
  timestamp: Date;
  inReplyTo?: string;
}

/**
 * Feedback from one agent to another
 */
export interface AgentFeedback {
  id: string;
  from: AgentRole;
  to: AgentRole;
  taskId: string;
  type: "approval" | "rejection" | "revision_request" | "suggestion";
  severity: "critical" | "major" | "minor" | "info";
  message: string;
  suggestions: string[];
  codeLocations?: CodeLocation[];
}

/**
 * A location in code for feedback
 */
export interface CodeLocation {
  file: string;
  startLine: number;
  endLine: number;
  snippet?: string;
}

/**
 * Configuration for an agent
 */
export interface AgentConfig {
  role: AgentRole;
  name: string;
  description: string;
  systemPrompt: string;
  model?: string;
  temperature?: number;
  maxRounds?: number;
  timeout?: number;
  allowedTools?: string[];
  capabilities: AgentCapability[];
  /**
   * Per-agent provider override (Fleet P1). Lets a single
   * MultiAgentSystem run heterogeneous providers in parallel — e.g.,
   * orchestrator on Anthropic Claude (reasoning), coder on OpenAI
   * Codex, reviewer on Gemini (vision/long-context), tester on local
   * Ollama (cheap parallel). When unset, the agent inherits the
   * system-wide `(apiKey, baseURL)` passed to `MultiAgentSystem`.
   *
   * Each field is independently overridable: e.g., point a coder at
   * a separate Ollama endpoint without touching its API key.
   */
  providerOverride?: {
    apiKey?: string;
    baseURL?: string;
    /** Model id, e.g., 'claude-opus-4', 'qwen3.6:35b'. Falls back to `model`. */
    model?: string;
  };
}

/**
 * Capabilities an agent can have
 */
export type AgentCapability =
  | "code_generation"
  | "code_review"
  | "code_editing"
  | "testing"
  | "debugging"
  | "documentation"
  | "architecture"
  | "search"
  | "planning"
  | "file_operations"
  | "git_operations"
  | "web_search";

/**
 * Result from an agent's execution
 */
export interface AgentExecutionResult {
  success: boolean;
  role: AgentRole;
  taskId: string;
  output: string;
  artifacts: TaskArtifact[];
  toolsUsed: string[];
  rounds: number;
  duration: number;
  feedback?: AgentFeedback[];
  error?: string;
  /** Phase L (V0.4) — token counts if the agent execute path captured them.
   *  V0.4 baseline: usually undefined → falls back to estimation. V0.5 will
   *  thread these from BaseAgent.execute via the LLM client response. */
  inputTokens?: number;
  outputTokens?: number;
  /** Phase L — exact cost in USD if both token counts present. Otherwise
   *  the WorkflowCostManager uses an estimation heuristic. */
  costUsd?: number;
}

/**
 * The overall result of a multi-agent workflow
 */
export interface WorkflowResult {
  success: boolean;
  plan: ExecutionPlan;
  results: Map<string, AgentExecutionResult>;
  artifacts: TaskArtifact[];
  timeline: WorkflowEvent[];
  totalDuration: number;
  summary: string;
  errors: string[];
  /** Phase L (V0.4) — total cost across all agents/tasks for this workflow.
   *  Aggregated by WorkflowCostManager. 0 if cost tracking disabled in TOML. */
  costUsdTotal?: number;
  /** Phase L — per-agent breakdown ([agent role, cost]) for /agents metrics. */
  costBreakdown?: Array<[AgentRole, number]>;
  /** Phase L — true if max_workflow_cost_usd cap was reached and remaining
   *  tasks were skipped gracefully. */
  costExceeded?: boolean;
}

/**
 * An event in the workflow timeline
 */
export interface WorkflowEvent {
  timestamp: Date;
  type: "task_started" | "task_completed" | "task_failed" | "agent_message" | "phase_started" | "phase_completed" | "conflict_detected";
  agent?: AgentRole;
  taskId?: string;
  message: string;
  data?: unknown;
}

/**
 * Collaboration strategy for the multi-agent system
 */
export type CollaborationStrategy =
  | "sequential"      // Agents work one after another
  | "parallel"        // Multiple agents work simultaneously
  | "hierarchical"    // Orchestrator delegates to specialists
  | "peer_review"     // Agents review each other's work
  | "iterative";      // Feedback loop until consensus

/** Opt-in worker transport used by `/swarm`; ordinary `/agents` stays unchanged. */
export interface WorkflowThreadDelegationOptions {
  concurrency?: number;
  parentBudget: ThreadParentBudget;
  parentSignal?: AbortSignal;
  onEvent?: (event: ThreadDelegationEvent<AgentExecutionResult>) => void;
}

/**
 * Options for running a multi-agent workflow
 */
export interface WorkflowOptions {
  strategy: CollaborationStrategy;
  maxIterations?: number;
  requireConsensus?: boolean;
  parallelAgents?: number;
  timeout?: number;
  verbose?: boolean;
  dryRun?: boolean;
  autoApprove?: boolean;
  onProgress?: (event: WorkflowEvent) => void;
  onAgentMessage?: (message: AgentMessage) => void;
  threadDelegation?: WorkflowThreadDelegationOptions;
  /** Phase J (V0.3) — resume from a previously persisted workflow.
   *  When set, MAS pre-populates the in-memory `results` Map and marks
   *  the matching `plan.phases[*].tasks[*]` as `completed`, so the 5
   *  strategy executors skip them. Optional — back-compat with V0.2 callers. */
  resumeFrom?: {
    completedTaskIds: string[];
    results: Array<[string, AgentExecutionResult]>;
  };
}

/**
 * Context shared between agents
 */
export interface SharedContext {
  goal: string;
  codebaseInfo?: CodebaseInfo;
  relevantFiles: string[];
  conversationHistory: AgentMessage[];
  artifacts: Map<string, TaskArtifact>;
  decisions: Decision[];
  constraints: string[];
}

/**
 * Information about the codebase
 */
export interface CodebaseInfo {
  rootPath: string;
  language: string;
  framework?: string;
  structure: DirectoryNode;
  dependencies: string[];
  entryPoints: string[];
}

/**
 * A node in the directory structure
 */
export interface DirectoryNode {
  name: string;
  type: "file" | "directory";
  path: string;
  children?: DirectoryNode[];
  language?: string;
  summary?: string;
}

/**
 * A decision made during the workflow
 */
export interface Decision {
  id: string;
  description: string;
  madeBy: AgentRole;
  rationale: string;
  alternatives: string[];
  timestamp: Date;
}

/**
 * Tool executor function type
 */
export type ToolExecutor = (
  toolCall: CodeBuddyToolCall,
  executionExtra?: Record<string, unknown>,
) => Promise<ToolResult>;

/**
 * Event emitter types for the multi-agent system
 */
export interface MultiAgentEvents {
  "workflow:start": { plan: ExecutionPlan };
  "workflow:complete": { result: WorkflowResult };
  "workflow:error": { error: Error; plan: ExecutionPlan };
  "phase:start": { phase: PlanPhase };
  "phase:complete": { phase: PlanPhase };
  "task:start": { task: AgentTask };
  "task:complete": { task: AgentTask; result: AgentExecutionResult };
  "task:failed": { task: AgentTask; error: string };
  "agent:message": { message: AgentMessage };
  "agent:feedback": { feedback: AgentFeedback };
}
