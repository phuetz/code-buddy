/**
 * Plan Mode Service
 *
 * Provides structured planning capabilities for complex tasks.
 * Implements a phased workflow: analysis → strategy → presentation → approval
 *
 * Based on hurry-mode's plan mode feature for Claude Code parity.
 */

import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";
import { 
  ExecutionPlan, 
  PlanStep, 
  PlanPhase
} from "./plan-types.js";
import { PlanAnalyzer } from "./analysis/plan-analysis.js";

// Re-export types
export * from "./plan-types.js";

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
        author: "code-buddy",
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
    issues.push(...PlanAnalyzer.detectCycles(this.currentPlan));

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
    const plan: ExecutionPlan = {
      ...data,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
      approvedAt: data.approvedAt ? new Date(data.approvedAt) : undefined,
      completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
    };
    this.currentPlan = plan;
    return plan;
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
  async savePlan(filePath: string): Promise<void> {
    if (!this.currentPlan) {
      throw new Error("No active plan to save");
    }

    const dir = path.dirname(filePath);
    try {
      await fsPromises.access(dir);
    } catch {
      await fsPromises.mkdir(dir, { recursive: true });
    }

    await fsPromises.writeFile(filePath, this.exportPlan());
  }

  /**
   * Load a plan from a file
   */
  async loadPlanFromFile(filePath: string): Promise<ExecutionPlan> {
    const content = await fsPromises.readFile(filePath, "utf-8");
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
    PlanAnalyzer.analyze(this.currentPlan);
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
