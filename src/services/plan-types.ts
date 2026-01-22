/**
 * Plan phase types
 */
export type PlanPhase =
  | "analysis"      // Analyzing the task and codebase
  | "strategy"      // Developing the approach
  | "presentation"  // Presenting the plan to user
  | "approval"      // Waiting for user approval
  | "execution"     // Executing the plan
  | "completed"     // Plan fully executed
  | "cancelled";    // Plan cancelled by user

/**
 * Priority levels for plan items
 */
export type PriorityLevel = "critical" | "high" | "medium" | "low";

/**
 * Risk levels for plan items
 */
export type RiskLevel = "high" | "medium" | "low" | "none";

/**
 * Types of actions in a plan
 */
export type ActionType =
  | "create_file"
  | "modify_file"
  | "delete_file"
  | "rename_file"
  | "move_file"
  | "add_dependency"
  | "remove_dependency"
  | "run_command"
  | "run_tests"
  | "refactor"
  | "document"
  | "review";

/**
 * An action within a plan step
 */
export interface PlanAction {
  type: ActionType;
  target: string; // File path or identifier
  description: string;
  details?: Record<string, unknown>;
}

/**
 * A single step in the plan
 */
export interface PlanStep {
  id: string;
  title: string;
  description: string;
  priority: PriorityLevel;
  risk: RiskLevel;
  estimatedComplexity: 1 | 2 | 3 | 4 | 5; // Fibonacci-like
  dependencies: string[]; // Other step IDs
  affectedFiles: string[];
  actions: PlanAction[];
  status: "pending" | "in_progress" | "completed" | "skipped" | "failed";
  notes?: string;
}

/**
 * Analysis results for the plan
 */
export interface PlanAnalysis {
  totalSteps: number;
  totalFiles: number;
  estimatedComplexity: number;
  riskAssessment: RiskLevel;
  criticalPath: string[]; // Step IDs in order
  parallelizableGroups: string[][]; // Groups of steps that can run in parallel
  rollbackPoints: string[]; // Step IDs that are safe rollback points
}

/**
 * Plan metadata
 */
export interface PlanMetadata {
  version: number;
  author: string;
  tags: string[];
  context: Record<string, unknown>;
}

/**
 * Complete execution plan
 */
export interface ExecutionPlan {
  id: string;
  title: string;
  description: string;
  goal: string;
  phase: PlanPhase;
  steps: PlanStep[];
  metadata: PlanMetadata;
  analysis: PlanAnalysis;
  createdAt: Date;
  updatedAt: Date;
  approvedAt?: Date;
  completedAt?: Date;
}
