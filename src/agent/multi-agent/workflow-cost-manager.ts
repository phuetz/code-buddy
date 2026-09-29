import { getPricingPer1k } from '../../config/model-pricing.js';

/**
 * WorkflowCostManager — Phase L (V0.4 multi-agent).
 *
 * Per-workflow cost accumulator. Sits inside MultiAgentSystem.runWorkflow
 * as a short-lived helper:
 *   1. Pre-task: estimateTaskCost(role, rounds, model) — rough heuristic
 *      from a per-role token budget. Used to LOG WARNINGS at the
 *      configurable threshold (default 80% of cap). Does NOT skip the
 *      task on estimate alone (advisor recommendation: ±50% heuristic
 *      accuracy is too unreliable for skip-on-estimate).
 *   2. Post-task: recordExact(result) — if the AgentExecutionResult
 *      carries token counts, compute the exact cost via CostTracker
 *      and accumulate. Otherwise fall back to the same estimation as
 *      pre-task to keep the running total non-zero.
 *   3. Hard cap: only the EXACT cumulative cost is checked against the
 *      cap. If exceeded, MAS skips remaining tasks (graceful) and marks
 *      WorkflowResult.costExceeded = true.
 *   4. Reporting: getMetrics() returns total + per-role breakdown for
 *      WorkflowResult and /agents metrics.
 */

import type { AgentRole, AgentExecutionResult } from './types.js';

/** Per-role rough token budget per round, used by estimateTaskCost.
 *  Conservative numbers (intentionally on the high side — better to warn
 *  early than late). V0.5 will tune these based on real usage data.
 *  AgentRole has 8 values but only the 4 main MAS agents are tuned —
 *  others fall back to coder budget (sensible default for unknown). */
const ROLE_TOKEN_BUDGET: Partial<Record<AgentRole, { input: number; output: number }>> = {
  orchestrator: { input: 5000, output: 2000 },
  coder: { input: 8000, output: 4000 },
  reviewer: { input: 6000, output: 3000 },
  tester: { input: 4000, output: 2000 },
  // researcher / debugger / architect / documenter use coder fallback
};
const FALLBACK_BUDGET = { input: 8000, output: 4000 };

export interface WorkflowCostMetrics {
  totalUsd: number;
  perRole: Map<AgentRole, number>;
  taskCount: number;
  exceededCap: boolean;
}

export interface WorkflowCostManagerConfig {
  /** Hard cap in USD. 0 = disabled (no cap, only logs total at end). */
  maxWorkflowCostUsd: number;
  /** Warning threshold as fraction of cap (0..1). 0.8 = warn at 80%. */
  warningThresholdPercent: number;
  /** Soft skip remaining tasks when cap exceeded (graceful) vs throw. */
  gracefulOverflow: boolean;
}

const DEFAULT_CONFIG: WorkflowCostManagerConfig = {
  maxWorkflowCostUsd: 0,
  warningThresholdPercent: 0.8,
  gracefulOverflow: true,
};

export class WorkflowCostManager {
  private cfg: WorkflowCostManagerConfig;
  private totalUsd = 0;
  private perRole: Map<AgentRole, number> = new Map();
  private taskCount = 0;
  private exceededCap = false;
  private warnedAtThreshold = false;
  /** Lazy-loaded calculator from CostTracker. */
  private calculatorPromise: Promise<((input: number, output: number, model: string) => number)> | null = null;

  constructor(config: Partial<WorkflowCostManagerConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
  }

  /** Reset counters for a new workflow run. Reuses the same instance. */
  reset(): void {
    this.totalUsd = 0;
    this.perRole.clear();
    this.taskCount = 0;
    this.exceededCap = false;
    this.warnedAtThreshold = false;
  }

  /** Pre-task estimate (rough). Used for the warning trigger. */
  estimateTaskCost(role: AgentRole, rounds: number, model: string): number {
    const budget = ROLE_TOKEN_BUDGET[role] ?? FALLBACK_BUDGET;
    const estInput = budget.input * Math.max(1, rounds);
    const estOutput = budget.output * Math.max(1, rounds);
    return this.calculateCostSync(estInput, estOutput, model);
  }

  /** Synchronous cost calculation using a basic model pricing fallback.
   *  Used when the CostTracker async load isn't ready yet. The exact
   *  pricing matches CostTracker's default fallback rate. */
  private calculateCostSync(inputTokens: number, outputTokens: number, model: string): number {
    const rate = getPricingPer1k(model);
    return (inputTokens / 1000) * rate.inputPer1k + (outputTokens / 1000) * rate.outputPer1k;
  }

  /** Async accurate cost via CostTracker. Falls back to sync calc on failure. */
  private async calculateCost(inputTokens: number, outputTokens: number, model: string): Promise<number> {
    if (!this.calculatorPromise) {
      this.calculatorPromise = (async () => {
        try {
          const { getCostTracker } = await import('../../utils/cost-tracker.js');
          const tracker = getCostTracker();
          return (i: number, o: number, m: string) => tracker.calculateCost(i, o, m);
        } catch {
          return (i: number, o: number, m: string) => this.calculateCostSync(i, o, m);
        }
      })();
    }
    const calc = await this.calculatorPromise;
    return calc(inputTokens, outputTokens, model);
  }

  /** Record actual cost from a completed task's result. Returns the cost
   *  added (exact if token counts present, else estimation fallback). */
  async recordExact(result: AgentExecutionResult, model: string, fallbackRounds: number): Promise<number> {
    let cost: number;
    if (result.costUsd !== undefined) {
      cost = result.costUsd;
    } else if (result.inputTokens !== undefined && result.outputTokens !== undefined) {
      cost = await this.calculateCost(result.inputTokens, result.outputTokens, model);
    } else {
      // No token counts available — fall back to the same estimation as pre-task
      cost = this.estimateTaskCost(result.role, fallbackRounds || result.rounds, model);
    }
    this.totalUsd += cost;
    this.perRole.set(result.role, (this.perRole.get(result.role) ?? 0) + cost);
    this.taskCount++;
    if (this.cfg.maxWorkflowCostUsd > 0 && this.totalUsd > this.cfg.maxWorkflowCostUsd) {
      this.exceededCap = true;
    }
    return cost;
  }

  /** Should a warning be logged given the projected cost (current + estimate)?
   *  Returns the warning message if threshold crossed, else null. Idempotent —
   *  only fires once per workflow per crossing. */
  checkWarning(projectedAddCost: number): string | null {
    if (this.cfg.maxWorkflowCostUsd <= 0) return null;
    if (this.warnedAtThreshold) return null;
    const projected = this.totalUsd + projectedAddCost;
    const threshold = this.cfg.maxWorkflowCostUsd * this.cfg.warningThresholdPercent;
    if (projected >= threshold) {
      this.warnedAtThreshold = true;
      return `Workflow cost projected to reach $${projected.toFixed(4)} (warning threshold: $${threshold.toFixed(4)}, cap: $${this.cfg.maxWorkflowCostUsd.toFixed(2)})`;
    }
    return null;
  }

  /** Hard cap check on EXACT cumulative cost. Used by MAS to decide whether
   *  to gracefully skip remaining tasks. */
  isCapExceeded(): boolean {
    return this.exceededCap;
  }

  /** Final metrics for WorkflowResult.costUsdTotal + costBreakdown. */
  getMetrics(): WorkflowCostMetrics {
    return {
      totalUsd: this.totalUsd,
      perRole: new Map(this.perRole),
      taskCount: this.taskCount,
      exceededCap: this.exceededCap,
    };
  }
}
