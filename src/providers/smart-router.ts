/**
 * Smart Model Router
 *
 * Enterprise-grade unified routing layer that integrates:
 * - Model tier selection (complexity-based)
 * - Provider fallback (health-based circuit breaker)
 * - Cost optimization (budget tracking)
 * - Auto-promotion and recovery
 *
 * Usage:
 * ```typescript
 * const router = getSmartRouter();
 *
 * // Configure providers and models
 * router.configureChain({
 *   providers: ['grok', 'openai', 'anthropic'],
 *   models: {
 *     grok: ['grok-3-mini', 'grok-3', 'grok-3-reasoning'],
 *     openai: ['gpt-4o-mini', 'gpt-4o'],
 *     anthropic: ['claude-3-haiku', 'claude-3-sonnet']
 *   }
 * });
 *
 * // Route a request
 * const route = await router.route({
 *   task: 'complex reasoning task',
 *   requiresVision: false,
 *   preferredProvider: 'grok'
 * });
 * ```
 */

import { EventEmitter } from 'events';
import { getModelPricing } from '../config/model-pricing.js';
import {
  ProviderFallbackChain,
  getFallbackChain,
  FallbackConfig,
  ProviderHealth,
} from './fallback-chain.js';
import type { ProviderType } from './types.js';
import {
  ModelRouter,
  classifyTaskComplexity,
  TaskClassification,
  RoutingDecision,
  ModelTier,
} from '../optimization/model-routing.js';

// ============================================================================
// Types
// ============================================================================

export interface ProviderModels {
  [provider: string]: string[];
}

export interface SmartRouterConfig {
  /** Providers in priority order (first = primary) */
  providers: ProviderType[];
  /** Models per provider (in tier order: mini → standard → reasoning) */
  models: ProviderModels;
  /** Fallback chain configuration */
  fallbackConfig?: Partial<FallbackConfig>;
  /** Cost budget per session in dollars */
  sessionBudget?: number;
  /** Whether to auto-downgrade on cost pressure */
  autoDowngrade?: boolean;
  /** Minimum confidence for tier selection */
  minTierConfidence?: number;
}

export interface RouteRequest {
  /** Task description or message */
  task: string;
  /** Whether task requires vision capabilities */
  requiresVision?: boolean;
  /** Explicitly request reasoning model */
  requiresReasoning?: boolean;
  /** Preferred provider (will try first if healthy) */
  preferredProvider?: ProviderType;
  /** Force specific model (bypasses routing) */
  forceModel?: string;
  /** Force specific tier */
  forceTier?: ModelTier;
  /** Estimated input tokens */
  estimatedTokens?: number;
}

export interface RouteResult {
  /** Selected provider */
  provider: ProviderType;
  /** Selected model */
  model: string;
  /** Model tier */
  tier: ModelTier;
  /** Why this route was chosen */
  reason: string;
  /** Provider health at selection time */
  providerHealth: ProviderHealth;
  /** Task classification used */
  classification?: TaskClassification;
  /** Cost estimate for this route */
  estimatedCost?: number;
  /** Whether this is a fallback route */
  isFallback: boolean;
  /** Alternatives if this fails */
  alternatives: Array<{ provider: ProviderType; model: string }>;
}

export interface SmartRouterEvents {
  /** Emitted when route is selected */
  'route:selected': (result: RouteResult) => void;
  /** Emitted when falling back to alternative */
  'route:fallback': (from: RouteResult, to: RouteResult, reason: string) => void;
  /** Emitted when budget threshold reached */
  'budget:warning': (current: number, limit: number) => void;
  /** Emitted when budget exceeded */
  'budget:exceeded': (current: number, limit: number) => void;
  /** Emitted when auto-downgrading tier */
  'tier:downgraded': (from: ModelTier, to: ModelTier, reason: string) => void;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: SmartRouterConfig = {
  providers: ['grok'],
  models: {
    grok: ['grok-3-mini', 'grok-3', 'grok-3-reasoning'],
  },
  sessionBudget: 10,
  autoDowngrade: true,
  minTierConfidence: 0.7,
};

// Model tiers mapping
const TIER_ORDER: ModelTier[] = ['mini', 'standard', 'reasoning', 'vision'];

// ============================================================================
// SmartModelRouter Class
// ============================================================================

export class SmartModelRouter extends EventEmitter {
  private config: SmartRouterConfig;
  private fallbackChain: ProviderFallbackChain;
  private modelRouter: ModelRouter;
  private currentCost: number = 0;
  private routeHistory: RouteResult[] = [];

  constructor(config: Partial<SmartRouterConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.fallbackChain = getFallbackChain();
    this.modelRouter = new ModelRouter();

    // Initialize fallback chain with providers
    if (this.config.providers.length > 0) {
      this.fallbackChain.setFallbackChain(this.config.providers);
    }

    // Configure fallback chain settings
    if (this.config.fallbackConfig) {
      this.fallbackChain.updateConfig(this.config.fallbackConfig);
    }
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Configure the routing chain
   */
  configureChain(config: Partial<SmartRouterConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.providers && config.providers.length > 0) {
      this.fallbackChain.setFallbackChain(config.providers);
    }

    if (config.fallbackConfig) {
      this.fallbackChain.updateConfig(config.fallbackConfig);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): SmartRouterConfig {
    return { ...this.config };
  }

  // ==========================================================================
  // Routing
  // ==========================================================================

  /**
   * Route a request to the best provider/model combination
   */
  async route(request: RouteRequest): Promise<RouteResult> {
    // Handle forced model
    if (request.forceModel) {
      return this.routeToForced(request);
    }

    // Classify the task
    const classification = classifyTaskComplexity(request.task);

    // Determine target tier
    let targetTier = request.forceTier || this.getTierForClassification(classification);

    // Auto-downgrade if budget pressure
    if (this.config.autoDowngrade && this.shouldDowngrade()) {
      const lowerTier = this.getLowerTier(targetTier);
      if (lowerTier) {
        this.emit('tier:downgraded', targetTier, lowerTier, 'budget_pressure');
        targetTier = lowerTier;
      }
    }

    // Get healthy provider
    const preferredProvider = request.preferredProvider;
    let provider: ProviderType | undefined =
      preferredProvider && this.isProviderHealthy(preferredProvider)
        ? preferredProvider
        : this.fallbackChain.getNextProvider() ?? undefined;

    if (!provider) {
      // All providers exhausted, try to recover
      provider = this.config.providers[0];
    }

    if (!provider) {
      // No providers configured at all — cannot route
      throw new Error('SmartModelRouter.route: no providers configured');
    }

    // Select model for provider and tier
    const model = this.selectModelForTier(provider, targetTier, request);
    const providerHealth = this.fallbackChain.getHealthStatus(provider);

    // Build alternatives list
    const alternatives = this.buildAlternatives(provider, model);

    const result: RouteResult = {
      provider,
      model,
      tier: targetTier,
      reason: this.buildReason(classification, targetTier, provider),
      providerHealth,
      classification,
      estimatedCost: this.estimateCost(model, request.estimatedTokens),
      isFallback: provider !== (preferredProvider ?? this.config.providers[0]),
      alternatives,
    };

    this.routeHistory.push(result);
    if (this.routeHistory.length > 500) {
      this.routeHistory = this.routeHistory.slice(-250);
    }
    this.emit('route:selected', result);

    return result;
  }

  /**
   * Route to a forced model
   */
  private routeToForced(request: RouteRequest): RouteResult {
    const model = request.forceModel!;
    const provider = this.findProviderForModel(model);
    const tier = this.getTierForModel(model);
    const providerHealth = this.fallbackChain.getHealthStatus(provider);

    return {
      provider,
      model,
      tier,
      reason: 'forced_model',
      providerHealth,
      isFallback: false,
      alternatives: [],
    };
  }

  /**
   * Get fallback route if current route fails
   */
  async getFallbackRoute(failedResult: RouteResult, error: string): Promise<RouteResult | null> {
    // Record failure
    this.fallbackChain.recordFailure(failedResult.provider, error);

    // Try alternatives
    for (const alt of failedResult.alternatives) {
      if (this.isProviderHealthy(alt.provider)) {
        const tier = this.getTierForModel(alt.model);
        const providerHealth = this.fallbackChain.getHealthStatus(alt.provider);

        const result: RouteResult = {
          provider: alt.provider,
          model: alt.model,
          tier,
          reason: `fallback_from_${failedResult.provider}_${error}`,
          providerHealth,
          isFallback: true,
          alternatives: this.buildAlternatives(alt.provider, alt.model),
        };

        this.emit('route:fallback', failedResult, result, error);
        return result;
      }
    }

    // Try next provider in chain
    const nextProvider = this.fallbackChain.getNextProvider(true);
    if (nextProvider) {
      const model = this.selectModelForTier(nextProvider, failedResult.tier);
      const providerHealth = this.fallbackChain.getHealthStatus(nextProvider);

      const result: RouteResult = {
        provider: nextProvider,
        model,
        tier: failedResult.tier,
        reason: `chain_fallback_${error}`,
        providerHealth,
        isFallback: true,
        alternatives: [],
      };

      this.emit('route:fallback', failedResult, result, error);
      return result;
    }

    return null;
  }

  // ==========================================================================
  // Health Tracking
  // ==========================================================================

  /**
   * Record successful route execution
   */
  recordSuccess(result: RouteResult, responseTimeMs: number, actualCost?: number): void {
    this.fallbackChain.recordSuccess(result.provider, responseTimeMs);

    if (actualCost !== undefined) {
      this.addCost(actualCost);
    }
  }

  /**
   * Record failed route execution
   */
  recordFailure(result: RouteResult, error: string): void {
    this.fallbackChain.recordFailure(result.provider, error);
  }

  /**
   * Check if provider is healthy
   */
  isProviderHealthy(provider: ProviderType): boolean {
    return this.fallbackChain.isProviderHealthy(provider);
  }

  /**
   * Get health status for all providers
   */
  getAllHealth(): ProviderHealth[] {
    return this.fallbackChain.getAllHealthStatus();
  }

  // ==========================================================================
  // Cost Management
  // ==========================================================================

  /**
   * Add to current session cost
   */
  addCost(cost: number): void {
    this.currentCost += cost;

    const budget = this.config.sessionBudget ?? DEFAULT_CONFIG.sessionBudget!;
    const warningThreshold = budget * 0.8;

    if (this.currentCost >= budget) {
      this.emit('budget:exceeded', this.currentCost, budget);
    } else if (this.currentCost >= warningThreshold) {
      this.emit('budget:warning', this.currentCost, budget);
    }
  }

  /**
   * Get current session cost
   */
  getCurrentCost(): number {
    return this.currentCost;
  }

  /**
   * Reset session cost
   */
  resetCost(): void {
    this.currentCost = 0;
  }

  /**
   * Check if we should downgrade tier due to budget
   */
  private shouldDowngrade(): boolean {
    const budget = this.config.sessionBudget ?? DEFAULT_CONFIG.sessionBudget!;
    return this.currentCost >= budget * 0.8;
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Get tier for task classification
   */
  private getTierForClassification(classification: TaskClassification): ModelTier {
    if (classification.requiresVision) {
      return 'vision';
    }
    if (classification.requiresReasoning || classification.complexity === 'reasoning_heavy') {
      return 'reasoning';
    }
    if (classification.complexity === 'complex') {
      return 'standard';
    }
    if (classification.complexity === 'moderate') {
      return 'standard';
    }
    return 'mini';
  }

  /**
   * Get lower tier for downgrading
   */
  private getLowerTier(tier: ModelTier): ModelTier | null {
    const index = TIER_ORDER.indexOf(tier);
    if (index > 0) {
      // safe: index > 0 and index < TIER_ORDER.length (from indexOf), so index - 1 is in bounds
      return TIER_ORDER[index - 1] ?? null;
    }
    return null;
  }

  /**
   * Select model for provider and tier
   */
  private selectModelForTier(
    provider: ProviderType,
    tier: ModelTier,
    request?: RouteRequest
  ): string {
    const models = this.config.models[provider] || [];

    // Find model matching tier
    // Models are expected to be ordered: mini, standard, reasoning
    const tierIndex = TIER_ORDER.indexOf(tier);

    if (models.length > 0) {
      // Try to get model at tier index, or closest lower
      const modelIndex = Math.min(tierIndex, models.length - 1);
      return models[modelIndex] ?? `${provider}-default`;
    }

    // Fallback to first model
    return models[0] || `${provider}-default`;
  }

  /**
   * Find provider that has the given model
   */
  private findProviderForModel(model: string): ProviderType {
    for (const [provider, models] of Object.entries(this.config.models)) {
      if (models.includes(model)) {
        return provider as ProviderType;
      }
    }
    const primary = this.config.providers[0];
    if (!primary) {
      throw new Error('SmartModelRouter.findProviderForModel: no providers configured');
    }
    return primary;
  }

  /**
   * Get tier for a specific model
   */
  private getTierForModel(model: string): ModelTier {
    const modelLower = model.toLowerCase();

    if (modelLower.includes('vision') || modelLower.includes('4o')) {
      return 'vision';
    }
    if (modelLower.includes('reasoning') || modelLower.includes('o1') || modelLower.includes('opus')) {
      return 'reasoning';
    }
    if (modelLower.includes('mini') || modelLower.includes('haiku') || modelLower.includes('flash')) {
      return 'mini';
    }
    return 'standard';
  }

  /**
   * Build alternatives list
   */
  private buildAlternatives(
    currentProvider: ProviderType,
    currentModel: string
  ): Array<{ provider: ProviderType; model: string }> {
    const alternatives: Array<{ provider: ProviderType; model: string }> = [];

    // Add other models from same provider
    const providerModels = this.config.models[currentProvider] || [];
    for (const model of providerModels) {
      if (model !== currentModel) {
        alternatives.push({ provider: currentProvider, model });
      }
    }

    // Add models from other providers
    for (const provider of this.config.providers) {
      if (provider !== currentProvider) {
        const models = this.config.models[provider] || [];
        const firstModel = models[0];
        if (firstModel !== undefined) {
          alternatives.push({ provider, model: firstModel });
        }
      }
    }

    return alternatives;
  }

  /**
   * Build reason string
   */
  private buildReason(
    classification: TaskClassification,
    tier: ModelTier,
    provider: ProviderType
  ): string {
    const parts = [
      `complexity=${classification.complexity}`,
      `tier=${tier}`,
      `confidence=${(classification.confidence * 100).toFixed(0)}%`,
    ];

    if (classification.requiresVision) {
      parts.push('requires_vision');
    }
    if (classification.requiresReasoning) {
      parts.push('requires_reasoning');
    }

    return parts.join(', ');
  }

  /**
   * Estimate cost for model and tokens
   */
  private estimateCost(model: string, estimatedTokens?: number): number | undefined {
    if (!estimatedTokens) {
      return undefined;
    }

    // EstimatedTokens has no input/output split; keep the input-rate estimate.
    const costPerMillion = getModelPricing(model).inputPerMillion;
    return (estimatedTokens / 1_000_000) * costPerMillion;
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get routing statistics
   */
  getStats(): {
    totalRoutes: number;
    fallbackRoutes: number;
    costToDate: number;
    routesByProvider: Record<string, number>;
    routesByTier: Record<string, number>;
    healthByProvider: ProviderHealth[];
  } {
    const routesByProvider: Record<string, number> = {};
    const routesByTier: Record<string, number> = {};
    let fallbackRoutes = 0;

    for (const route of this.routeHistory) {
      routesByProvider[route.provider] = (routesByProvider[route.provider] || 0) + 1;
      routesByTier[route.tier] = (routesByTier[route.tier] || 0) + 1;
      if (route.isFallback) {
        fallbackRoutes++;
      }
    }

    return {
      totalRoutes: this.routeHistory.length,
      fallbackRoutes,
      costToDate: this.currentCost,
      routesByProvider,
      routesByTier,
      healthByProvider: this.getAllHealth(),
    };
  }

  /**
   * Format statistics as string
   */
  formatStats(): string {
    const stats = this.getStats();
    const lines = [
      'Smart Router Statistics',
      '=' .repeat(40),
      `Total Routes: ${stats.totalRoutes}`,
      `Fallback Routes: ${stats.fallbackRoutes} (${((stats.fallbackRoutes / (stats.totalRoutes || 1)) * 100).toFixed(1)}%)`,
      `Session Cost: $${stats.costToDate.toFixed(4)}`,
      '',
      'Routes by Provider:',
      ...Object.entries(stats.routesByProvider).map(([p, c]) => `  ${p}: ${c}`),
      '',
      'Routes by Tier:',
      ...Object.entries(stats.routesByTier).map(([t, c]) => `  ${t}: ${c}`),
      '',
      'Provider Health:',
      ...stats.healthByProvider.map(h =>
        `  ${h.provider}: ${h.healthy ? '✓' : '✗'} (failures: ${h.failureCount}, avg: ${h.avgResponseTimeMs}ms)`
      ),
    ];

    return lines.join('\n');
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Reset router state
   */
  reset(): void {
    this.currentCost = 0;
    this.routeHistory = [];
    this.fallbackChain.reset();
  }

  /**
   * Dispose router
   */
  dispose(): void {
    this.reset();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let smartRouterInstance: SmartModelRouter | null = null;

/**
 * Get singleton SmartModelRouter instance
 */
export function getSmartRouter(config?: Partial<SmartRouterConfig>): SmartModelRouter {
  if (!smartRouterInstance) {
    smartRouterInstance = new SmartModelRouter(config);
  } else if (config) {
    smartRouterInstance.configureChain(config);
  }
  return smartRouterInstance;
}

/**
 * Reset singleton instance
 */
export function resetSmartRouter(): void {
  if (smartRouterInstance) {
    smartRouterInstance.dispose();
  }
  smartRouterInstance = null;
}

export default SmartModelRouter;
