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
}

/**
 * An event in the workflow timeline
 */
export interface WorkflowEvent {
  timestamp: Date;
  type: "task_started" | "task_completed" | "task_failed" | "agent_message" | "phase_started" | "phase_completed";
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
export type ToolExecutor = (toolCall: CodeBuddyToolCall) => Promise<ToolResult>;

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
