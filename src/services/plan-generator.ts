/**
 * Plan Mode Service
 *
 * Provides structured planning capabilities for complex tasks.
 * Implements a phased workflow: analysis → strategy → presentation → approval
 *
 * Based on hurry-mode's plan mode feature for Claude Code parity.
 */

import * as fs from "fs";
import * as path from "path";

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
 * An action within a plan step
 */
export interface PlanAction {
  type: ActionType;
  target: string; // File path or identifier
  description: string;
  details?: Record<string, unknown>;
}

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
 * Plan generation options
 */
export interface PlanGeneratorOptions {
  maxSteps?: number;
  minComplexity?: number;
  maxComplexity?: number;
  includeTests?: boolean;
  includeDocumentation?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

/**
 * Default options
 */
const DEFAULT_OPTIONS: PlanGeneratorOptions = {
  maxSteps: 50,
  minComplexity: 1,
  maxComplexity: 5,
  includeTests: true,
  includeDocumentation: true,
  dryRun: false,
  verbose: false,
};

/**
 * Plan Generator Service
 */
export class PlanGenerator {
  private options: PlanGeneratorOptions;
  private currentPlan: ExecutionPlan | null = null;

  constructor(options: Partial<PlanGeneratorOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Create a new execution plan
   */
  createPlan(
    title: string,
    goal: string,
    description: string
  ): ExecutionPlan {
    const plan: ExecutionPlan = {
      id: this.generateId("plan"),
      title,
      description,
      goal,
      phase: "analysis",
      steps: [],
      metadata: {
        version: 1,
        author: "grok-cli",
        tags: [],
        context: {},
      },
      analysis: {
        totalSteps: 0,
        totalFiles: 0,
        estimatedComplexity: 0,
        riskAssessment: "none",
        criticalPath: [],
        parallelizableGroups: [],
        rollbackPoints: [],
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.currentPlan = plan;
    return plan;
  }

  /**
   * Add a step to the current plan
   */
  addStep(step: Omit<PlanStep, "id" | "status">): PlanStep {
    if (!this.currentPlan) {
      throw new Error("No active plan. Call createPlan first.");
    }

    const newStep: PlanStep = {
      ...step,
      id: this.generateId("step"),
      status: "pending",
    };

    this.currentPlan.steps.push(newStep);
    this.updateAnalysis();
    this.currentPlan.updatedAt = new Date();

    return newStep;
  }

  /**
   * Add multiple steps at once
   */
  addSteps(steps: Omit<PlanStep, "id" | "status">[]): PlanStep[] {
    return steps.map((step) => this.addStep(step));
  }

  /**
   * Remove a step from the plan
   */
  removeStep(stepId: string): boolean {
    if (!this.currentPlan) {
      return false;
    }

    const index = this.currentPlan.steps.findIndex((s) => s.id === stepId);
    if (index === -1) {
      return false;
    }

    // Remove dependencies on this step
    for (const step of this.currentPlan.steps) {
      step.dependencies = step.dependencies.filter((d) => d !== stepId);
    }

    this.currentPlan.steps.splice(index, 1);
    this.updateAnalysis();
    this.currentPlan.updatedAt = new Date();

    return true;
  }

  /**
   * Reorder steps in the plan
   */
  reorderSteps(stepIds: string[]): boolean {
    if (!this.currentPlan) {
      return false;
    }

    const newSteps: PlanStep[] = [];
    for (const id of stepIds) {
      const step = this.currentPlan.steps.find((s) => s.id === id);
      if (step) {
        newSteps.push(step);
      }
    }

    // Add any steps not in the new order at the end
    for (const step of this.currentPlan.steps) {
      if (!stepIds.includes(step.id)) {
        newSteps.push(step);
      }
    }

    this.currentPlan.steps = newSteps;
    this.updateAnalysis();
    this.currentPlan.updatedAt = new Date();

    return true;
  }

  /**
   * Transition the plan to a new phase
   */
  transitionPhase(newPhase: PlanPhase): boolean {
    if (!this.currentPlan) {
      return false;
    }

    const validTransitions: Record<PlanPhase, PlanPhase[]> = {
      analysis: ["strategy", "cancelled"],
      strategy: ["presentation", "analysis", "cancelled"],
      presentation: ["approval", "strategy", "cancelled"],
      approval: ["execution", "strategy", "cancelled"],
      execution: ["completed", "cancelled"],
      completed: [],
      cancelled: [],
    };

    if (!validTransitions[this.currentPlan.phase].includes(newPhase)) {
      return false;
    }

    this.currentPlan.phase = newPhase;
    this.currentPlan.updatedAt = new Date();

    if (newPhase === "approval") {
      this.currentPlan.approvedAt = new Date();
    } else if (newPhase === "completed") {
      this.currentPlan.completedAt = new Date();
    }

    return true;
  }

  /**
   * Update step status
   */
  updateStepStatus(
    stepId: string,
    status: PlanStep["status"],
    notes?: string
  ): boolean {
    if (!this.currentPlan) {
      return false;
    }

    const step = this.currentPlan.steps.find((s) => s.id === stepId);
    if (!step) {
      return false;
    }

    step.status = status;
    if (notes) {
      step.notes = notes;
    }

    this.currentPlan.updatedAt = new Date();
    return true;
  }

  /**
   * Get the next executable step
   */
  getNextStep(): PlanStep | null {
    if (!this.currentPlan) {
      return null;
    }

    for (const step of this.currentPlan.steps) {
      if (step.status !== "pending") {
        continue;
      }

      // Check if all dependencies are completed
      const depsCompleted = step.dependencies.every((depId) => {
        const dep = this.currentPlan!.steps.find((s) => s.id === depId);
        return dep && dep.status === "completed";
      });

      if (depsCompleted) {
        return step;
      }
    }

    return null;
  }

  /**
   * Get all steps that can be executed in parallel
   */
  getParallelSteps(): PlanStep[] {
    if (!this.currentPlan) {
      return [];
    }

    const parallelSteps: PlanStep[] = [];

    for (const step of this.currentPlan.steps) {
      if (step.status !== "pending") {
        continue;
      }

      // Check if all dependencies are completed
      const depsCompleted = step.dependencies.every((depId) => {
        const dep = this.currentPlan!.steps.find((s) => s.id === depId);
        return dep && dep.status === "completed";
      });

      if (depsCompleted) {
        parallelSteps.push(step);
      }
    }

    return parallelSteps;
  }

  /**
   * Validate the plan for issues
   */
  validate(): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    if (!this.currentPlan) {
      return { valid: false, issues: ["No active plan"] };
    }

    // Check for circular dependencies
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (stepId: string): boolean => {
      if (recursionStack.has(stepId)) {
        return true;
      }
      if (visited.has(stepId)) {
        return false;
      }

      visited.add(stepId);
      recursionStack.add(stepId);

      const step = this.currentPlan!.steps.find((s) => s.id === stepId);
      if (step) {
        for (const depId of step.dependencies) {
          if (hasCycle(depId)) {
            return true;
          }
        }
      }

      recursionStack.delete(stepId);
      return false;
    };

    for (const step of this.currentPlan.steps) {
      if (hasCycle(step.id)) {
        issues.push(`Circular dependency detected involving step: ${step.title}`);
      }
    }

    // Check for missing dependencies
    const stepIds = new Set(this.currentPlan.steps.map((s) => s.id));
    for (const step of this.currentPlan.steps) {
      for (const depId of step.dependencies) {
        if (!stepIds.has(depId)) {
          issues.push(
            `Step "${step.title}" has missing dependency: ${depId}`
          );
        }
      }
    }

    // Check for empty plan
    if (this.currentPlan.steps.length === 0) {
      issues.push("Plan has no steps");
    }

    // Check for high-risk items without rollback points
    const highRiskSteps = this.currentPlan.steps.filter(
      (s) => s.risk === "high"
    );
    if (highRiskSteps.length > 0 && this.currentPlan.analysis.rollbackPoints.length === 0) {
      issues.push(
        "Plan contains high-risk steps but no rollback points are defined"
      );
    }

    return { valid: issues.length === 0, issues };
  }

  /**
   * Get the current plan
   */
  getPlan(): ExecutionPlan | null {
    return this.currentPlan;
  }

  /**
   * Load a plan from JSON
   */
  loadPlan(json: string): ExecutionPlan {
    const data = JSON.parse(json);
    this.currentPlan = {
      ...data,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
      approvedAt: data.approvedAt ? new Date(data.approvedAt) : undefined,
      completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
    };
    return this.currentPlan;
  }

  /**
   * Export the plan to JSON
   */
  exportPlan(): string {
    if (!this.currentPlan) {
      throw new Error("No active plan to export");
    }
    return JSON.stringify(this.currentPlan, null, 2);
  }

  /**
   * Save the plan to a file
   */
  savePlan(filePath: string): void {
    if (!this.currentPlan) {
      throw new Error("No active plan to save");
    }

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, this.exportPlan());
  }

  /**
   * Load a plan from a file
   */
  loadPlanFromFile(filePath: string): ExecutionPlan {
    const content = fs.readFileSync(filePath, "utf-8");
    return this.loadPlan(content);
  }

  /**
   * Generate a summary of the plan
   */
  generateSummary(): string {
    if (!this.currentPlan) {
      return "No active plan";
    }

    const lines: string[] = [];
    const plan = this.currentPlan;

    lines.push("═".repeat(60));
    lines.push(`📋 EXECUTION PLAN: ${plan.title}`);
    lines.push("═".repeat(60));
    lines.push("");
    lines.push(`Goal: ${plan.goal}`);
    lines.push(`Phase: ${plan.phase.toUpperCase()}`);
    lines.push(`Created: ${plan.createdAt.toLocaleString()}`);
    lines.push("");

    lines.push("─".repeat(40));
    lines.push("ANALYSIS");
    lines.push("─".repeat(40));
    lines.push(`Total Steps: ${plan.analysis.totalSteps}`);
    lines.push(`Total Files Affected: ${plan.analysis.totalFiles}`);
    lines.push(`Estimated Complexity: ${plan.analysis.estimatedComplexity}`);
    lines.push(`Risk Assessment: ${plan.analysis.riskAssessment.toUpperCase()}`);
    lines.push("");

    lines.push("─".repeat(40));
    lines.push("STEPS");
    lines.push("─".repeat(40));

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const statusIcon = this.getStatusIcon(step.status);
      const riskBadge = step.risk !== "none" ? ` [${step.risk.toUpperCase()} RISK]` : "";

      lines.push(`${i + 1}. ${statusIcon} ${step.title}${riskBadge}`);
      lines.push(`   Priority: ${step.priority} | Complexity: ${step.estimatedComplexity}`);
      lines.push(`   ${step.description}`);

      if (step.affectedFiles.length > 0) {
        lines.push(`   Files: ${step.affectedFiles.join(", ")}`);
      }

      if (step.dependencies.length > 0) {
        const depNames = step.dependencies
          .map((depId) => {
            const dep = plan.steps.find((s) => s.id === depId);
            return dep ? dep.title : depId;
          })
          .join(", ");
        lines.push(`   Depends on: ${depNames}`);
      }

      lines.push("");
    }

    if (plan.analysis.criticalPath.length > 0) {
      lines.push("─".repeat(40));
      lines.push("CRITICAL PATH");
      lines.push("─".repeat(40));
      const pathNames = plan.analysis.criticalPath.map((id) => {
        const step = plan.steps.find((s) => s.id === id);
        return step ? step.title : id;
      });
      lines.push(pathNames.join(" → "));
      lines.push("");
    }

    lines.push("═".repeat(60));

    return lines.join("\n");
  }

  /**
   * Generate a Markdown representation of the plan
   */
  generateMarkdown(): string {
    if (!this.currentPlan) {
      return "No active plan";
    }

    const plan = this.currentPlan;
    const lines: string[] = [];

    lines.push(`# ${plan.title}`);
    lines.push("");
    lines.push(`> ${plan.description}`);
    lines.push("");
    lines.push(`**Goal:** ${plan.goal}`);
    lines.push(`**Phase:** ${plan.phase}`);
    lines.push(`**Created:** ${plan.createdAt.toISOString()}`);
    lines.push("");

    lines.push("## Analysis");
    lines.push("");
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total Steps | ${plan.analysis.totalSteps} |`);
    lines.push(`| Files Affected | ${plan.analysis.totalFiles} |`);
    lines.push(`| Complexity | ${plan.analysis.estimatedComplexity} |`);
    lines.push(`| Risk | ${plan.analysis.riskAssessment} |`);
    lines.push("");

    lines.push("## Steps");
    lines.push("");

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const checkbox = step.status === "completed" ? "[x]" : "[ ]";

      lines.push(`### ${i + 1}. ${checkbox} ${step.title}`);
      lines.push("");
      lines.push(step.description);
      lines.push("");
      lines.push(`- **Priority:** ${step.priority}`);
      lines.push(`- **Complexity:** ${step.estimatedComplexity}/5`);
      lines.push(`- **Risk:** ${step.risk}`);

      if (step.affectedFiles.length > 0) {
        lines.push(`- **Files:** \`${step.affectedFiles.join("`, `")}\``);
      }

      if (step.actions.length > 0) {
        lines.push("");
        lines.push("**Actions:**");
        for (const action of step.actions) {
          lines.push(`- ${action.type}: ${action.target} - ${action.description}`);
        }
      }

      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Update the analysis after plan changes
   */
  private updateAnalysis(): void {
    if (!this.currentPlan) {
      return;
    }

    const plan = this.currentPlan;
    const allFiles = new Set<string>();
    let totalComplexity = 0;
    let maxRisk: RiskLevel = "none";

    for (const step of plan.steps) {
      for (const file of step.affectedFiles) {
        allFiles.add(file);
      }
      totalComplexity += step.estimatedComplexity;

      // Update max risk
      const riskOrder: RiskLevel[] = ["none", "low", "medium", "high"];
      if (riskOrder.indexOf(step.risk) > riskOrder.indexOf(maxRisk)) {
        maxRisk = step.risk;
      }
    }

    // Calculate critical path (simplified - longest dependency chain)
    const criticalPath = this.calculateCriticalPath();

    // Find parallelizable groups
    const parallelGroups = this.findParallelGroups();

    // Identify rollback points (steps with no dependents that are low risk)
    const rollbackPoints = plan.steps
      .filter((step) => {
        const hasDependents = plan.steps.some((s) =>
          s.dependencies.includes(step.id)
        );
        return !hasDependents && step.risk !== "high";
      })
      .map((s) => s.id);

    plan.analysis = {
      totalSteps: plan.steps.length,
      totalFiles: allFiles.size,
      estimatedComplexity: totalComplexity,
      riskAssessment: maxRisk,
      criticalPath,
      parallelizableGroups: parallelGroups,
      rollbackPoints,
    };
  }

  /**
   * Calculate the critical path through the plan
   */
  private calculateCriticalPath(): string[] {
    if (!this.currentPlan || this.currentPlan.steps.length === 0) {
      return [];
    }

    const plan = this.currentPlan;
    const memo = new Map<string, string[]>();

    const getLongestPath = (stepId: string): string[] => {
      if (memo.has(stepId)) {
        return memo.get(stepId)!;
      }

      const step = plan.steps.find((s) => s.id === stepId);
      if (!step || step.dependencies.length === 0) {
        const path = [stepId];
        memo.set(stepId, path);
        return path;
      }

      let longestDepPath: string[] = [];
      for (const depId of step.dependencies) {
        const depPath = getLongestPath(depId);
        if (depPath.length > longestDepPath.length) {
          longestDepPath = depPath;
        }
      }

      const path = [...longestDepPath, stepId];
      memo.set(stepId, path);
      return path;
    };

    // Find the longest path from any leaf node
    let criticalPath: string[] = [];
    for (const step of plan.steps) {
      const path = getLongestPath(step.id);
      if (path.length > criticalPath.length) {
        criticalPath = path;
      }
    }

    return criticalPath;
  }

  /**
   * Find groups of steps that can run in parallel
   */
  private findParallelGroups(): string[][] {
    if (!this.currentPlan || this.currentPlan.steps.length === 0) {
      return [];
    }

    const plan = this.currentPlan;
    const groups: string[][] = [];
    const assigned = new Set<string>();

    // Group by depth level
    const depths = new Map<string, number>();

    const calculateDepth = (stepId: string): number => {
      if (depths.has(stepId)) {
        return depths.get(stepId)!;
      }

      const step = plan.steps.find((s) => s.id === stepId);
      if (!step || step.dependencies.length === 0) {
        depths.set(stepId, 0);
        return 0;
      }

      let maxDepDepth = 0;
      for (const depId of step.dependencies) {
        maxDepDepth = Math.max(maxDepDepth, calculateDepth(depId));
      }

      const depth = maxDepDepth + 1;
      depths.set(stepId, depth);
      return depth;
    };

    for (const step of plan.steps) {
      calculateDepth(step.id);
    }

    // Group by depth
    const maxDepth = Math.max(...Array.from(depths.values()));
    for (let d = 0; d <= maxDepth; d++) {
      const group: string[] = [];
      for (const step of plan.steps) {
        if (depths.get(step.id) === d && !assigned.has(step.id)) {
          group.push(step.id);
          assigned.add(step.id);
        }
      }
      if (group.length > 1) {
        groups.push(group);
      }
    }

    return groups;
  }

  /**
   * Get status icon for a step
   */
  private getStatusIcon(status: PlanStep["status"]): string {
    const icons: Record<PlanStep["status"], string> = {
      pending: "○",
      in_progress: "◐",
      completed: "●",
      skipped: "◌",
      failed: "✗",
    };
    return icons[status];
  }

  /**
   * Generate a unique ID
   */
  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }
}

/**
 * Create a plan generator instance
 */
export function createPlanGenerator(
  options?: Partial<PlanGeneratorOptions>
): PlanGenerator {
  return new PlanGenerator(options);
}

// Singleton instance
let planGeneratorInstance: PlanGenerator | null = null;

export function getPlanGenerator(): PlanGenerator {
  if (!planGeneratorInstance) {
    planGeneratorInstance = createPlanGenerator();
  }
  return planGeneratorInstance;
}

export function resetPlanGenerator(): void {
  planGeneratorInstance = null;
}
