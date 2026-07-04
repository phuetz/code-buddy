/**
 * Model Routing Facade
 *
 * Encapsulates model routing and cost tracking operations.
 * This facade handles:
 * - Model selection and routing decisions
 * - Cost tracking and limits
 * - Routing statistics and savings calculation
 */

import type { ModelRouter, RoutingDecision } from '../../optimization/model-routing.js';
import { classifyTaskComplexity, selectModel, GROK_MODELS } from '../../optimization/model-routing.js';
import type { CostTracker } from '../../utils/cost-tracker.js';
import type { ModelPairsConfig } from '../../config/toml-config.js';
import { getModelScoreboard, type ModelScoreboard } from '../../fleet/model-scoreboard.js';
import { inferTaskType } from '../../fleet/model-capability-heuristics.js';
import { logger } from '../../utils/logger.js';

/**
 * Task intent classification used for architect/editor model pair routing.
 */
export type TaskIntent = 'planning' | 'reasoning' | 'editing' | 'general';

/**
 * Statistics about model routing usage
 */
export interface ModelRoutingStats {
  enabled: boolean;
  totalCost: number;
  savings: {
    saved: number;
    percentage: number;
  };
  usageByModel: Record<string, unknown>;
  lastDecision: RoutingDecision | null;
}

/**
 * Dependencies required by ModelRoutingFacade
 */
export interface ModelRoutingFacadeDeps {
  modelRouter: ModelRouter;
  costTracker: CostTracker;
}

/**
 * Optional injection seams for {@link ModelRoutingFacade.autoRouteIfEnabled}.
 * Used by tests to supply a deterministic scoreboard / env without touching the
 * real `~/.codebuddy/fleet-model-performance.jsonl` ledger or `process.env`.
 */
export interface AutoRouteOptions {
  /** Inject a ModelScoreboard (tests). Production uses the singleton. */
  scoreboard?: ModelScoreboard;
  /** Inject env (tests). Production reads `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Facade for model routing and cost management in agents.
 *
 * Responsibilities:
 * - Enabling/disabling model routing
 * - Tracking routing decisions
 * - Calculating costs and savings
 * - Providing routing statistics
 */
export class ModelRoutingFacade {
  private readonly modelRouter: ModelRouter;
  private readonly costTracker: CostTracker;

  private useModelRouting: boolean = false;
  private autoRoutingEnabled: boolean = false;
  private lastRoutingDecision: RoutingDecision | null = null;
  private sessionCostLimit: number = 10;
  private sessionCost: number = 0;

  /** Architect/editor model pair config */
  private modelPairs: ModelPairsConfig | null = null;

  /** Mid-conversation model override (set by /switch) */
  private switchedModel: string | null = null;

  constructor(deps: ModelRoutingFacadeDeps) {
    this.modelRouter = deps.modelRouter;
    this.costTracker = deps.costTracker;
  }

  // ============================================================================
  // Model Routing
  // ============================================================================

  /**
   * Enable or disable model routing
   */
  setModelRouting(enabled: boolean): void {
    this.useModelRouting = enabled;
  }

  /**
   * Check if model routing is enabled
   */
  isModelRoutingEnabled(): boolean {
    return this.useModelRouting;
  }

  /**
   * Enable or disable automatic model routing by task complexity.
   * When enabled, each user message is classified and routed to the
   * optimal model before the LLM call.
   */
  setAutoRouting(enabled: boolean): void {
    this.autoRoutingEnabled = enabled;
    // Also enable/disable the underlying model routing engine
    this.useModelRouting = enabled;
    this.modelRouter.updateConfig({ enabled });
  }

  /**
   * Check if automatic model routing is enabled
   */
  isAutoRoutingEnabled(): boolean {
    return this.autoRoutingEnabled;
  }

  /**
   * Route a user message to the optimal model if auto-routing is enabled.
   *
   * @param userMessage - The user's message to classify
   * @param availableModels - Optional list of available model IDs (defaults to GROK_MODELS keys)
   * @param opts - Optional test injection seams (scoreboard / env)
   * @returns The recommended model name, or null if auto-routing is disabled
   *          or fewer than 2 models are available
   */
  autoRouteIfEnabled(
    userMessage: string,
    availableModels?: string[],
    opts?: AutoRouteOptions,
  ): string | null {
    if (!this.autoRoutingEnabled) {
      return null;
    }

    const models = availableModels ?? Object.keys(GROK_MODELS);
    if (models.length < 2) {
      return null;
    }

    const classification = classifyTaskComplexity(userMessage);
    let decision = selectModel(classification, undefined, models);

    // Opt-in council-learned tie-break (CODEBUDDY_COUNCIL_ROUTING). Default OFF
    // is a STRICT no-op: the branch is skipped entirely, so no ModelScoreboard
    // is constructed, no ledger file is read, and no latency is added.
    const env = opts?.env ?? process.env;
    if (env.CODEBUDDY_COUNCIL_ROUTING === 'true') {
      decision = this.applyScoreboardTieBreak(decision, userMessage, models, opts?.scoreboard);
    }

    this.lastRoutingDecision = decision;

    return decision.recommendedModel;
  }

  /**
   * Council-learned tie-break for auto-routing — opt-in via
   * `CODEBUDDY_COUNCIL_ROUTING=true`. This is the only place the council's
   * `ModelScoreboard` (trained by `buddy council` runs) feeds the MAIN chat
   * model choice; without it the scoreboard only steered the voice loop and the
   * diff reviewer.
   *
   * CONSERVATIVE by design — it never overrides a hard constraint (cost,
   * capacity, a pinned or `/switch`-ed model, the vision requirement all live
   * upstream). It only arbitrates between the complexity-based
   * `recommendedModel` and the `alternativeModel` that `selectModel` itself
   * already surfaced as viable, and only departs from the recommendation when
   * the scoreboard has ACTUAL run history showing the alternative is the better
   * AI for this task category. An empty / unseen scoreboard leaves the decision
   * untouched (silent fallback). Never throws.
   */
  private applyScoreboardTieBreak(
    decision: RoutingDecision,
    userMessage: string,
    models: string[],
    scoreboardOverride?: ModelScoreboard,
  ): RoutingDecision {
    try {
      const alt = decision.alternativeModel;
      // Only a genuine {recommended, alternative} ambiguity is a tie to break.
      if (!alt || alt === decision.recommendedModel || !models.includes(alt)) {
        return decision;
      }

      const sb = scoreboardOverride ?? getModelScoreboard();
      const taskType = inferTaskType(userMessage);
      const rec = decision.recommendedModel;
      const recBias = sb.selectionBias(taskType, rec);
      const altBias = sb.selectionBias(taskType, alt);

      // Depart from the recommendation only on real evidence: the alternative
      // must both out-score the recommendation AND have observed runs. Selection
      // bias is a neutral 0 for unseen models, so an empty scoreboard can never
      // satisfy `altBias > recBias` with `runCount > 0` → guaranteed fallback.
      if (altBias > recBias && sb.runCount(taskType, alt) > 0) {
        logger.debug(
          `[council-routing] scoreboard prefers ${alt} over ${rec} for ${taskType} ` +
            `(bias ${altBias.toFixed(2)} > ${recBias.toFixed(2)})`,
        );
        return {
          ...decision,
          recommendedModel: alt,
          tier: GROK_MODELS[alt]?.tier ?? decision.tier,
          reason: `${decision.reason} | council-routing: ${alt} historically stronger for ${taskType} tasks`,
          alternativeModel: rec,
          alternativeReason: decision.reason,
        };
      }

      return decision;
    } catch (err) {
      logger.debug(
        `[council-routing] tie-break skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
      return decision;
    }
  }

  /**
   * Get the model router instance (for advanced operations)
   */
  getModelRouter(): ModelRouter {
    return this.modelRouter;
  }

  /**
   * Get the last routing decision
   */
  getLastRoutingDecision(): RoutingDecision | null {
    return this.lastRoutingDecision;
  }

  /**
   * Set the last routing decision (called after routing)
   */
  setLastRoutingDecision(decision: RoutingDecision): void {
    this.lastRoutingDecision = decision;
  }

  /**
   * Get comprehensive model routing statistics
   */
  getStats(): ModelRoutingStats {
    return {
      enabled: this.useModelRouting,
      totalCost: this.modelRouter.getTotalCost(),
      savings: this.modelRouter.getEstimatedSavings(),
      usageByModel: Object.fromEntries(this.modelRouter.getUsageStats()),
      lastDecision: this.lastRoutingDecision,
    };
  }

  /**
   * Format routing statistics as a human-readable string
   */
  formatStats(): string {
    const stats = this.getStats();
    const lines = [
      'Model Routing Statistics',
      `|- Enabled: ${stats.enabled ? 'Yes' : 'No'}`,
      `|- Total Cost: $${stats.totalCost.toFixed(4)}`,
      `|- Savings: $${stats.savings.saved.toFixed(4)} (${stats.savings.percentage.toFixed(1)}%)`,
    ];

    if (stats.lastDecision) {
      lines.push(`|- Last Model: ${stats.lastDecision.recommendedModel}`);
      lines.push(`|- Reason: ${stats.lastDecision.reason}`);
    } else {
      lines.push('|- No routing decisions yet');
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Architect / Editor Model Pairs
  // ============================================================================

  /**
   * Configure architect/editor model pairs.
   * When set, the facade routes planning/reasoning tasks to the architect model
   * and editing/tool-execution tasks to the editor model.
   */
  setModelPairs(pairs: ModelPairsConfig | null): void {
    this.modelPairs = pairs;
  }

  /**
   * Get the current model pairs config.
   */
  getModelPairs(): ModelPairsConfig | null {
    return this.modelPairs;
  }

  /**
   * Resolve which model to use based on task intent and model pair configuration.
   *
   * Priority:
   * 1. Mid-conversation /switch override (if set)
   * 2. Architect/editor pair routing (if configured and intent is classifiable)
   * 3. Auto-routing by complexity (if enabled)
   * 4. Default model (null — caller uses their default)
   */
  resolveModelForIntent(intent: TaskIntent, userMessage?: string): string | null {
    // Priority 1: explicit /switch override
    if (this.switchedModel) {
      return this.switchedModel;
    }

    // Priority 2: architect/editor pair
    if (this.modelPairs) {
      if ((intent === 'planning' || intent === 'reasoning') && this.modelPairs.architect) {
        return this.modelPairs.architect;
      }
      if (intent === 'editing' && this.modelPairs.editor) {
        return this.modelPairs.editor;
      }
      // 'general' falls through to auto-routing or default
    }

    // Priority 3: auto-routing
    if (userMessage && this.autoRoutingEnabled) {
      return this.autoRouteIfEnabled(userMessage);
    }

    // Priority 4: no override
    return null;
  }

  /**
   * Classify user message intent for model pair routing.
   * Returns 'planning' for architecture/design questions,
   * 'editing' for code changes, and 'general' otherwise.
   */
  classifyIntent(userMessage: string): TaskIntent {
    const lower = userMessage.toLowerCase();

    const planningPatterns = [
      'plan', 'design', 'architect', 'how should', 'what approach',
      'strategy', 'outline', 'think about', 'consider', 'evaluate',
      'compare', 'pros and cons', 'trade-off', 'tradeoff',
    ];

    const reasoningPatterns = [
      'why', 'explain', 'reason', 'analyze', 'debug',
      'understand', 'investigate', 'diagnose', 'figure out',
    ];

    const editingPatterns = [
      'fix', 'edit', 'change', 'update', 'modify', 'refactor',
      'implement', 'create', 'add', 'remove', 'delete', 'rename',
      'write', 'build', 'code', 'make',
    ];

    for (const p of planningPatterns) {
      if (lower.includes(p)) return 'planning';
    }
    for (const p of reasoningPatterns) {
      if (lower.includes(p)) return 'reasoning';
    }
    for (const p of editingPatterns) {
      if (lower.includes(p)) return 'editing';
    }

    return 'general';
  }

  // ============================================================================
  // Mid-Conversation Model Switching
  // ============================================================================

  /**
   * Switch the model for subsequent messages (set by /switch command).
   * Pass null to return to auto-routing / default behavior.
   */
  setSwitchedModel(model: string | null): void {
    this.switchedModel = model;
  }

  /**
   * Get the currently switched model (if any).
   */
  getSwitchedModel(): string | null {
    return this.switchedModel;
  }

  // ============================================================================
  // Cost Management
  // ============================================================================

  /**
   * Get current session cost
   */
  getSessionCost(): number {
    return this.sessionCost;
  }

  /**
   * Add to session cost
   */
  addSessionCost(cost: number): void {
    if (!isFinite(cost) || cost < 0) return;
    this.sessionCost += cost;
  }

  /**
   * Set session cost directly
   */
  setSessionCost(cost: number): void {
    if (!isFinite(cost) || cost < 0) return;
    this.sessionCost = cost;
  }

  /**
   * Get session cost limit
   */
  getSessionCostLimit(): number {
    return this.sessionCostLimit;
  }

  /**
   * Set session cost limit
   */
  setSessionCostLimit(limit: number): void {
    this.sessionCostLimit = limit;
  }

  /**
   * Check if session cost limit has been reached
   */
  isSessionCostLimitReached(): boolean {
    return this.sessionCost >= this.sessionCostLimit;
  }

  /**
   * Get the cost tracker instance (for advanced operations)
   */
  getCostTracker(): CostTracker {
    return this.costTracker;
  }
}
