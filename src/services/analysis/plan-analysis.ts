import { ExecutionPlan, RiskLevel } from "../plan-types.js";

/**
 * Service for analyzing execution plans
 * Handles complexity calculation, cycle detection, critical path analysis, etc.
 */
export class PlanAnalyzer {
  /**
   * Update the analysis of a plan
   */
  static analyze(plan: ExecutionPlan): void {
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
    const criticalPath = this.calculateCriticalPath(plan);

    // Find parallelizable groups
    const parallelGroups = this.findParallelGroups(plan);

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
  static calculateCriticalPath(plan: ExecutionPlan): string[] {
    if (plan.steps.length === 0) {
      return [];
    }

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
  static findParallelGroups(plan: ExecutionPlan): string[][] {
    if (plan.steps.length === 0) {
      return [];
    }

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
   * Detect circular dependencies in the plan
   */
  static detectCycles(plan: ExecutionPlan): string[] {
    const issues: string[] = [];
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

      const step = plan.steps.find((s) => s.id === stepId);
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

    for (const step of plan.steps) {
        // Reset state for each component search to ensure full coverage
        // Wait, standard DFS for cycle detection usually iterates all nodes.
        // If a node is visited, we don't need to check it again.
        // The previous logic was "if (hasCycle(step.id))".
        // The issue is if we have disjoint graphs.
        // But visited set is shared, so if we visited it, it's fine.
        if (hasCycle(step.id)) {
          issues.push(`Circular dependency detected involving step: ${step.title}`);
        }
    }

    return issues;
  }
}
