/**
 * Reasoning Facade
 *
 * Unified entry point for all reasoning engines:
 * - Chain-of-Thought (single-pass, cheap)
 * - Tree-of-Thought with BFS (moderate complexity)
 * - MCTS with Rethink (high complexity)
 * - Progressive deepening (auto-escalation)
 *
 * Handles engine selection, token budget management, and result formatting.
 */

import {
  ThinkingMode,
  THINKING_MODE_CONFIG,
  Problem,
  ReasoningResult,
  CoTResult,
  MCTSConfig,
  DEFAULT_MCTS_CONFIG,
} from './types.js';
import {
  TreeOfThoughtReasoner,
  ToTConfig,
} from './tree-of-thought.js';

// ── Types ───────────────────────────────────────────────────────────────

/**
 * Options for a single `solve()` invocation.
 */
export interface ReasoningOptions {
  /** Explicit thinking mode. When omitted the facade auto-selects. */
  mode?: ThinkingMode;
  /** Preferred search algorithm for ToT/MCTS. */
  searchAlgorithm?: 'bfs' | 'mcts';
  /** Whether to auto-escalate if initial attempt scores below threshold. */
  autoEscalate?: boolean;
  /** Approximate token budget for reasoning (soft cap). */
  tokenBudget?: number;
}

/**
 * Cumulative usage statistics tracked across all calls.
 */
export interface CumulativeUsage {
  totalCalls: number;
  cotCalls: number;
  totCalls: number;
  mctsCalls: number;
  totalTimeMs: number;
  estimatedTokens: number;
}

// ── Constants ───────────────────────────────────────────────────────────

/** Score threshold below which auto-escalation kicks in. */
const AUTO_ESCALATE_THRESHOLD = 0.4;

/** Default token budget when none is specified. */
const DEFAULT_TOKEN_BUDGET = 16_000;

/**
 * Ordered escalation ladder. `solve()` may walk up this ladder when
 * `autoEscalate` is true and the result score is below threshold.
 */
const ESCALATION_ORDER: readonly ThinkingMode[] = [
  'shallow',
  'medium',
  'deep',
  'exhaustive',
];

// ── Facade class ────────────────────────────────────────────────────────

/**
 * Unified facade that bridges all reasoning engines.
 *
 * Usage:
 * ```ts
 * const facade = getReasoningFacade(apiKey);
 * const result = await facade.solve({ description: 'How to ...' });
 * ```
 */
export class ReasoningFacade {
  private apiKey: string;
  private baseURL: string | undefined;
  private reasoner: TreeOfThoughtReasoner;
  private usage: CumulativeUsage;

  constructor(apiKey: string, baseURL?: string) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.reasoner = new TreeOfThoughtReasoner(apiKey, baseURL, {
      mode: 'medium',
    });
    this.usage = {
      totalCalls: 0,
      cotCalls: 0,
      totCalls: 0,
      mctsCalls: 0,
      totalTimeMs: 0,
      estimatedTokens: 0,
    };
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Solve a problem, auto-selecting or explicitly using a reasoning engine.
   *
   * Engine selection logic:
   *   1. If `options.mode` is provided, use that directly.
   *   2. Otherwise pick based on problem length / complexity heuristic.
   *   3. If `autoEscalate` is true and the first attempt scores poorly,
   *      walk up the escalation ladder and retry.
   */
  async solve(
    problem: Problem,
    options: ReasoningOptions = {},
  ): Promise<ReasoningResult | CoTResult> {
    const startTime = Date.now();
    const mode = options.mode ?? this.autoSelectMode(problem);
    const autoEscalate = options.autoEscalate ?? false;
    const tokenBudget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET;

    // Configure the underlying reasoner
    this.applyMode(mode, options.searchAlgorithm, tokenBudget);

    let result: ReasoningResult | CoTResult;

    if (mode === 'shallow') {
      result = await this.runChainOfThought(problem);
    } else {
      result = await this.runTreeOfThought(problem);
    }

    // Auto-escalate when enabled and score is below threshold
    if (autoEscalate && this.shouldEscalate(result, mode)) {
      const escalated = await this.escalate(problem, mode, options);
      if (escalated !== null) {
        result = escalated;
      }
    }

    // Track usage
    const elapsed = Date.now() - startTime;
    this.trackUsage(mode, elapsed, tokenBudget);

    return result;
  }

  /**
   * Get cumulative usage statistics.
   */
  getUsage(): Readonly<CumulativeUsage> {
    return { ...this.usage };
  }

  /**
   * Reset cumulative usage counters.
   */
  resetUsage(): void {
    this.usage = {
      totalCalls: 0,
      cotCalls: 0,
      totCalls: 0,
      mctsCalls: 0,
      totalTimeMs: 0,
      estimatedTokens: 0,
    };
  }

  /**
   * Format any result (CoT or full reasoning) for display.
   */
  formatResult(result: ReasoningResult | CoTResult): string {
    if (this.isCoTResult(result)) {
      return this.formatCoTResult(result);
    }
    return this.reasoner.formatResult(result);
  }

  // ── Engine execution ────────────────────────────────────────────────

  private async runChainOfThought(problem: Problem): Promise<CoTResult> {
    return this.reasoner.chainOfThought(problem);
  }

  private async runTreeOfThought(
    problem: Problem,
  ): Promise<ReasoningResult> {
    return this.reasoner.solve(problem);
  }

  // ── Mode & config management ────────────────────────────────────────

  /**
   * Heuristic auto-selection of thinking mode based on problem attributes.
   */
  private autoSelectMode(problem: Problem): ThinkingMode {
    const descLen = problem.description.length;
    const hasConstraints =
      (problem.constraints?.length ?? 0) > 0;
    const hasExamples = (problem.examples?.length ?? 0) > 0;

    // Very short / simple problems → shallow CoT
    if (descLen < 100 && !hasConstraints && !hasExamples) {
      return 'shallow';
    }

    // Moderate complexity
    if (descLen < 500 && !hasExamples) {
      return hasConstraints ? 'medium' : 'shallow';
    }

    // Longer problems with constraints → deep
    if (hasConstraints && hasExamples) {
      return 'deep';
    }

    // Default mid-range
    return 'medium';
  }

  /**
   * Apply the selected mode to the underlying reasoner.
   */
  private applyMode(
    mode: ThinkingMode,
    searchAlgorithm?: 'bfs' | 'mcts',
    tokenBudget?: number,
  ): void {
    // Build MCTS overrides from caller preferences
    const mctsOverrides: Partial<MCTSConfig> = {};

    if (tokenBudget !== undefined) {
      mctsOverrides.tokenBudget = tokenBudget;
    }

    if (searchAlgorithm === 'bfs') {
      mctsOverrides.searchAlgorithm = 'bfs';
    } else if (searchAlgorithm === 'mcts') {
      mctsOverrides.searchAlgorithm = 'mcts';
      mctsOverrides.useRethink = true;
      mctsOverrides.rethinkThreshold = DEFAULT_MCTS_CONFIG.rethinkThreshold;
    }

    this.reasoner.setMode(mode, Object.keys(mctsOverrides).length > 0 ? mctsOverrides : undefined);
  }

  // ── Auto-escalation ─────────────────────────────────────────────────

  /**
   * Determine whether we should escalate to a deeper reasoning mode.
   */
  private shouldEscalate(
    result: ReasoningResult | CoTResult,
    currentMode: ThinkingMode,
  ): boolean {
    // Cannot escalate beyond exhaustive
    if (currentMode === 'exhaustive') return false;

    if (this.isCoTResult(result)) {
      return result.confidence < AUTO_ESCALATE_THRESHOLD;
    }

    return !result.success || result.stats.bestScore < AUTO_ESCALATE_THRESHOLD;
  }

  /**
   * Walk up the escalation ladder and retry.
   */
  private async escalate(
    problem: Problem,
    currentMode: ThinkingMode,
    options: ReasoningOptions,
  ): Promise<ReasoningResult | CoTResult | null> {
    const currentIndex = ESCALATION_ORDER.indexOf(currentMode);

    for (let i = currentIndex + 1; i < ESCALATION_ORDER.length; i++) {
      const nextMode = ESCALATION_ORDER[i];
      this.applyMode(
        nextMode,
        options.searchAlgorithm,
        options.tokenBudget,
      );

      const result: ReasoningResult | CoTResult =
        nextMode === 'shallow'
          ? await this.runChainOfThought(problem)
          : await this.runTreeOfThought(problem);

      // If this level is good enough, return it
      if (!this.shouldEscalate(result, nextMode)) {
        return result;
      }
    }

    // Exhausted all levels without satisfactory result
    return null;
  }

  // ── Usage tracking ──────────────────────────────────────────────────

  private trackUsage(
    mode: ThinkingMode,
    elapsedMs: number,
    tokenBudget: number,
  ): void {
    this.usage.totalCalls++;
    this.usage.totalTimeMs += elapsedMs;

    // Rough token estimate: budget is a soft cap, actual usage varies
    this.usage.estimatedTokens += Math.round(tokenBudget * 0.6);

    switch (mode) {
      case 'shallow':
        this.usage.cotCalls++;
        break;
      case 'medium':
        this.usage.totCalls++;
        break;
      case 'deep':
      case 'exhaustive':
        this.usage.mctsCalls++;
        break;
    }
  }

  // ── Formatting helpers ──────────────────────────────────────────────

  private isCoTResult(
    result: ReasoningResult | CoTResult,
  ): result is CoTResult {
    return 'steps' in result && 'finalAnswer' in result;
  }

  private formatCoTResult(result: CoTResult): string {
    const lines: string[] = [];
    lines.push('');
    lines.push('='.repeat(60));
    lines.push('CHAIN-OF-THOUGHT REASONING RESULT');
    lines.push('='.repeat(60));
    lines.push('');

    for (const step of result.steps) {
      lines.push(`Step ${step.step}: ${step.thought}`);
      if (step.action) {
        lines.push(`  Action: ${step.action}`);
      }
      if (step.observation) {
        lines.push(`  Observation: ${step.observation}`);
      }
      lines.push('');
    }

    lines.push('-'.repeat(40));
    lines.push(`Final Answer: ${result.finalAnswer}`);
    lines.push(`Confidence: ${(result.confidence * 100).toFixed(0)}%`);
    lines.push('');
    lines.push('='.repeat(60));

    return lines.join('\n');
  }
}

// ── Singleton management ────────────────────────────────────────────────

let facadeInstance: ReasoningFacade | null = null;

/**
 * Get or create the singleton ReasoningFacade.
 *
 * @param apiKey - API key for LLM provider
 * @param baseURL - Optional custom API base URL
 */
export function getReasoningFacade(
  apiKey: string,
  baseURL?: string,
): ReasoningFacade {
  if (!facadeInstance) {
    facadeInstance = new ReasoningFacade(apiKey, baseURL);
  }
  return facadeInstance;
}

/**
 * Destroy the singleton instance (useful for testing).
 */
export function resetReasoningFacade(): void {
  facadeInstance = null;
}
