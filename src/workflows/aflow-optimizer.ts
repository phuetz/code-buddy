/**
 * AFlow Optimizer for Lobster Workflows
 *
 * Uses Monte Carlo Tree Search (MCTS) to optimize workflow parameters:
 * - Step parallelism (which steps can run concurrently)
 * - Timeout values per step
 * - Model selection per step (for AI-driven steps)
 * - Step ordering within dependency constraints
 *
 * Inspired by Lisa's AFlowCore optimizer, adapted for Lobster DAG format.
 */

import { logger } from '../utils/logger.js';
import type { LobsterWorkflow, LobsterStep, StepResult } from './lobster-engine.js';

// ============================================================================
// Types
// ============================================================================

export interface OptimizationConfig {
  /** Number of MCTS iterations (default: 50) */
  iterations: number;
  /** Exploration constant for UCB1 (default: 1.414) */
  explorationConstant: number;
  /** Max parallel steps to consider (default: 4) */
  maxParallelism: number;
  /** Available models for AI steps */
  availableModels: string[];
  /** Evaluation function: higher is better */
  evaluator?: (result: WorkflowSimResult) => number;
}

export interface StepConfig {
  stepId: string;
  timeout: number;
  model?: string;
  parallelGroup?: number;
}

export interface WorkflowConfig {
  steps: StepConfig[];
  estimatedDuration: number;
  estimatedCost: number;
}

export interface WorkflowSimResult {
  config: WorkflowConfig;
  duration: number;
  cost: number;
  successRate: number;
}

interface MCTSNode {
  id: string;
  config: WorkflowConfig;
  visits: number;
  totalReward: number;
  children: MCTSNode[];
  parent: MCTSNode | null;
  /** Minimum reward seen (for MCTSr Q-value) */
  minReward: number;
  /** Sum of rewards (for mean calculation) */
  rewardSum: number;
  rewardCount: number;
}

export interface OptimizationResult {
  bestConfig: WorkflowConfig;
  score: number;
  iterations: number;
  improvements: string[];
  allConfigs: Array<{ config: WorkflowConfig; score: number }>;
}

const DEFAULT_OPTIMIZATION_CONFIG: OptimizationConfig = {
  iterations: 50,
  explorationConstant: 1.414,
  maxParallelism: 4,
  availableModels: ['grok-3', 'grok-3-mini', 'claude-sonnet-4-20250514'],
};

// ============================================================================
// AFlow Optimizer
// ============================================================================

export class AFlowOptimizer {
  private static instance: AFlowOptimizer | null = null;
  private config: OptimizationConfig;

  constructor(config?: Partial<OptimizationConfig>) {
    this.config = { ...DEFAULT_OPTIMIZATION_CONFIG, ...config };
  }

  static getInstance(): AFlowOptimizer {
    if (!AFlowOptimizer.instance) {
      AFlowOptimizer.instance = new AFlowOptimizer();
    }
    return AFlowOptimizer.instance;
  }

  static resetInstance(): void {
    AFlowOptimizer.instance = null;
  }

  /**
   * Optimize a workflow's execution parameters using MCTS.
   */
  async optimize(
    workflow: LobsterWorkflow,
    historicalResults?: StepResult[]
  ): Promise<OptimizationResult> {
    const root = this.createRootNode(workflow);
    const improvements: string[] = [];
    let bestNode = root;
    let bestScore = -Infinity;

    for (let i = 0; i < this.config.iterations; i++) {
      // 1. Selection — UCB1
      let node = this.select(root);

      // 2. Expansion — generate child configs
      if (node.visits > 0 && node.children.length === 0) {
        this.expand(node, workflow);
        if (node.children.length > 0) {
          node = node.children[Math.floor(Math.random() * node.children.length)];
        }
      }

      // 3. Simulation — estimate reward
      const simResult = this.simulate(node.config, workflow, historicalResults);
      const reward = this.evaluate(simResult);

      // 4. Backpropagation
      this.backpropagate(node, reward);

      // Track best
      if (reward > bestScore) {
        bestScore = reward;
        bestNode = node;
        improvements.push(
          `Iteration ${i + 1}: score ${reward.toFixed(3)} — ` +
          `duration ${simResult.duration}ms, cost $${simResult.cost.toFixed(4)}`
        );
      }
    }

    // Collect top configs
    const allConfigs = this.collectLeafConfigs(root)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    logger.debug(`AFlow optimization complete: ${this.config.iterations} iterations, best score: ${bestScore.toFixed(3)}`);

    return {
      bestConfig: bestNode.config,
      score: bestScore,
      iterations: this.config.iterations,
      improvements,
      allConfigs,
    };
  }

  /**
   * Analyze a workflow and suggest parallelism opportunities
   */
  analyzeParallelism(workflow: LobsterWorkflow): Array<{
    group: string[];
    reason: string;
  }> {
    const stepMap = new Map(workflow.steps.map(s => [s.id, s]));
    const groups: Array<{ group: string[]; reason: string }> = [];

    // Find steps with no mutual dependencies
    for (let i = 0; i < workflow.steps.length; i++) {
      for (let j = i + 1; j < workflow.steps.length; j++) {
        const a = workflow.steps[i];
        const b = workflow.steps[j];

        const aDepsOnB = a.dependsOn?.includes(b.id) ?? false;
        const bDepsOnA = b.dependsOn?.includes(a.id) ?? false;

        if (!aDepsOnB && !bDepsOnA) {
          // Check transitive deps
          if (!this.hasTransitiveDep(a.id, b.id, stepMap) && !this.hasTransitiveDep(b.id, a.id, stepMap)) {
            groups.push({
              group: [a.id, b.id],
              reason: `Steps "${a.name}" and "${b.name}" have no dependency relationship`,
            });
          }
        }
      }
    }

    return groups;
  }

  /**
   * Suggest timeout adjustments based on historical results
   */
  suggestTimeouts(
    workflow: LobsterWorkflow,
    historicalResults: StepResult[]
  ): Map<string, number> {
    const suggestions = new Map<string, number>();
    const resultsByStep = new Map<string, number[]>();

    // Group durations by step
    for (const result of historicalResults) {
      const durations = resultsByStep.get(result.stepId) || [];
      durations.push(result.duration);
      resultsByStep.set(result.stepId, durations);
    }

    // Suggest timeout = p95 duration * 2 (with min 5000ms)
    for (const step of workflow.steps) {
      const durations = resultsByStep.get(step.id);
      if (durations && durations.length >= 3) {
        const sorted = [...durations].sort((a, b) => a - b);
        const p95 = sorted[Math.floor(sorted.length * 0.95)];
        const suggested = Math.max(5000, Math.ceil(p95 * 2));
        suggestions.set(step.id, suggested);
      } else {
        // Default: keep existing or use 30s
        suggestions.set(step.id, step.timeout || 30000);
      }
    }

    return suggestions;
  }

  // --- MCTS internals ---

  private createRootNode(workflow: LobsterWorkflow): MCTSNode {
    const steps: StepConfig[] = workflow.steps.map(s => ({
      stepId: s.id,
      timeout: s.timeout || 30000,
      parallelGroup: 0,
    }));

    return {
      id: 'root',
      config: {
        steps,
        estimatedDuration: steps.reduce((sum, s) => sum + s.timeout, 0),
        estimatedCost: 0,
      },
      visits: 0,
      totalReward: 0,
      children: [],
      parent: null,
      minReward: Infinity,
      rewardSum: 0,
      rewardCount: 0,
    };
  }

  /**
   * UCB1 selection with MCTSr Q-value
   */
  private select(node: MCTSNode): MCTSNode {
    let current = node;
    while (current.children.length > 0) {
      let bestChild: MCTSNode | null = null;
      let bestUCB = -Infinity;

      for (const child of current.children) {
        if (child.visits === 0) return child;

        // MCTSr Q-value: Q(a) = 0.5 * (min(R) + mean(R))
        const meanReward = child.rewardSum / child.rewardCount;
        const qValue = 0.5 * (child.minReward + meanReward);
        const exploration = this.config.explorationConstant *
          Math.sqrt(Math.log(current.visits) / child.visits);
        const ucb = qValue + exploration;

        if (ucb > bestUCB) {
          bestUCB = ucb;
          bestChild = child;
        }
      }

      current = bestChild || current.children[0];
    }
    return current;
  }

  /**
   * Expand node with variant configurations
   */
  private expand(node: MCTSNode, workflow: LobsterWorkflow): void {
    const variants = this.generateVariants(node.config, workflow);
    for (const variant of variants) {
      const child: MCTSNode = {
        id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        config: variant,
        visits: 0,
        totalReward: 0,
        children: [],
        parent: node,
        minReward: Infinity,
        rewardSum: 0,
        rewardCount: 0,
      };
      node.children.push(child);
    }
  }

  /**
   * Generate config variants (mutations)
   */
  private generateVariants(config: WorkflowConfig, workflow: LobsterWorkflow): WorkflowConfig[] {
    const variants: WorkflowConfig[] = [];

    // Variant 1: Adjust timeouts (+-20%)
    const timeoutVariant: WorkflowConfig = {
      ...config,
      steps: config.steps.map(s => ({
        ...s,
        timeout: Math.max(5000, Math.round(s.timeout * (0.8 + Math.random() * 0.4))),
      })),
    };
    variants.push(timeoutVariant);

    // Variant 2: Change parallelism grouping
    const parallelGroups = this.analyzeParallelism(workflow);
    if (parallelGroups.length > 0) {
      const parallelVariant: WorkflowConfig = {
        ...config,
        steps: config.steps.map(s => {
          const group = parallelGroups.findIndex(g => g.group.includes(s.stepId));
          return { ...s, parallelGroup: group >= 0 ? group + 1 : 0 };
        }),
      };
      variants.push(parallelVariant);
    }

    // Variant 3: Model assignment for AI steps
    if (this.config.availableModels.length > 1) {
      const modelVariant: WorkflowConfig = {
        ...config,
        steps: config.steps.map(s => ({
          ...s,
          model: this.config.availableModels[
            Math.floor(Math.random() * this.config.availableModels.length)
          ],
        })),
      };
      variants.push(modelVariant);
    }

    return variants;
  }

  /**
   * Simulate workflow execution with given config
   */
  private simulate(
    config: WorkflowConfig,
    _workflow: LobsterWorkflow,
    historicalResults?: StepResult[]
  ): WorkflowSimResult {
    // Build duration estimates from historical data or defaults
    const durationMap = new Map<string, number>();
    if (historicalResults) {
      for (const r of historicalResults) {
        const existing = durationMap.get(r.stepId);
        if (!existing || r.duration > existing) {
          durationMap.set(r.stepId, r.duration);
        }
      }
    }

    // Simulate execution with parallelism
    const groups = new Map<number, StepConfig[]>();
    for (const step of config.steps) {
      const group = step.parallelGroup ?? 0;
      const existing = groups.get(group) || [];
      existing.push(step);
      groups.set(group, existing);
    }

    let totalDuration = 0;
    let totalCost = 0;
    let successCount = 0;
    const totalSteps = config.steps.length;

    for (const [, groupSteps] of groups) {
      // Parallel group: duration = max of group
      let groupDuration = 0;
      for (const step of groupSteps) {
        const baseDuration = durationMap.get(step.stepId) || step.timeout * 0.3;
        const jitter = baseDuration * (0.8 + Math.random() * 0.4);
        groupDuration = Math.max(groupDuration, jitter);

        // Cost estimate (simplified)
        const modelCostMultiplier = step.model?.includes('mini') ? 0.3 : 1.0;
        totalCost += modelCostMultiplier * 0.001;

        // Success probability (simplified)
        if (jitter < step.timeout) successCount++;
      }
      totalDuration += groupDuration;
    }

    return {
      config,
      duration: Math.round(totalDuration),
      cost: totalCost,
      successRate: totalSteps > 0 ? successCount / totalSteps : 1,
    };
  }

  /**
   * Evaluate simulation result (higher is better)
   */
  private evaluate(result: WorkflowSimResult): number {
    if (this.config.evaluator) {
      return this.config.evaluator(result);
    }

    // Default: balance speed, cost, and reliability
    const speedScore = 1 / (1 + result.duration / 10000);
    const costScore = 1 / (1 + result.cost * 100);
    const reliabilityScore = result.successRate;

    return 0.4 * speedScore + 0.2 * costScore + 0.4 * reliabilityScore;
  }

  /**
   * Backpropagate reward up the tree
   */
  private backpropagate(node: MCTSNode, reward: number): void {
    let current: MCTSNode | null = node;
    while (current) {
      current.visits++;
      current.totalReward += reward;
      current.rewardSum += reward;
      current.rewardCount++;
      current.minReward = Math.min(current.minReward, reward);
      current = current.parent;
    }
  }

  /**
   * Collect all leaf node configs with scores
   */
  private collectLeafConfigs(root: MCTSNode): Array<{ config: WorkflowConfig; score: number }> {
    const results: Array<{ config: WorkflowConfig; score: number }> = [];
    const stack = [root];

    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.children.length === 0 && node.visits > 0) {
        const meanReward = node.rewardSum / node.rewardCount;
        results.push({
          config: node.config,
          score: 0.5 * (node.minReward + meanReward),
        });
      }
      stack.push(...node.children);
    }

    return results;
  }

  /**
   * Check for transitive dependency between two steps
   */
  private hasTransitiveDep(
    fromId: string,
    toId: string,
    stepMap: Map<string, LobsterStep>
  ): boolean {
    const visited = new Set<string>();
    const queue = [fromId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const step = stepMap.get(current);
      if (step?.dependsOn) {
        for (const dep of step.dependsOn) {
          if (dep === toId) return true;
          queue.push(dep);
        }
      }
    }

    return false;
  }
}

/**
 * Convenience accessor
 */
export function getAFlowOptimizer(): AFlowOptimizer {
  return AFlowOptimizer.getInstance();
}
