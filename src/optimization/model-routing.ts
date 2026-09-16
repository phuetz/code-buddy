/**
 * Model Tier Routing
 *
 * Research-based implementation of tiered model selection.
 * Routes requests to appropriate model tiers based on task complexity.
 *
 * Expected Impact:
 * - 30-70% cost reduction
 * - Maintain quality for complex tasks
 *
 * Reference: FrugalGPT (Stanford), LLMProxy (arXiv 2024)
 */

import type { TaskType } from '../council/task-types.js';

/**
 * Model tier definitions
 */
export type ModelTier = "mini" | "standard" | "reasoning" | "vision";

/**
 * Task complexity levels
 */
export type TaskComplexity = "simple" | "moderate" | "complex" | "reasoning_heavy";

/**
 * Model configuration
 */
export interface ModelConfig {
  id: string;
  tier: ModelTier;
  costPerMillionTokens: number;
  maxTokens: number;
  supportsVision: boolean;
  supportsToolUse: boolean;
  reasoning: "basic" | "standard" | "extended";
}

/**
 * Available Grok models with their configurations
 */
export const GROK_MODELS: Record<string, ModelConfig> = {
  // Mini tier - fast and cheap
  "grok-3-mini": {
    id: "grok-3-mini",
    tier: "mini",
    costPerMillionTokens: 0.3,
    maxTokens: 8192,
    supportsVision: false,
    supportsToolUse: true,
    reasoning: "basic",
  },

  // Standard tier - balanced
  "grok-3": {
    id: "grok-3",
    tier: "standard",
    costPerMillionTokens: 3.0,
    maxTokens: 32768,
    supportsVision: false,
    supportsToolUse: true,
    reasoning: "standard",
  },

  // Reasoning tier - for complex tasks
  "grok-3-reasoning": {
    id: "grok-3-reasoning",
    tier: "reasoning",
    costPerMillionTokens: 5.0,
    maxTokens: 65536,
    supportsVision: false,
    supportsToolUse: true,
    reasoning: "extended",
  },

  // Vision tier - for image understanding
  "grok-2-vision": {
    id: "grok-2-vision",
    tier: "vision",
    costPerMillionTokens: 2.0,
    maxTokens: 8192,
    supportsVision: true,
    supportsToolUse: true,
    reasoning: "standard",
  },
};

/**
 * Task classification for routing
 */
export interface TaskClassification {
  /** Optional shared council/fleet category, when the caller already inferred it. */
  taskType?: TaskType;
  complexity: TaskComplexity;
  requiresVision: boolean;
  requiresReasoning: boolean;
  requiresLongContext: boolean;
  estimatedTokens: number;
  confidence: number;
}

/**
 * Routing decision
 */
export interface RoutingDecision {
  recommendedModel: string;
  tier: ModelTier;
  reason: string;
  estimatedCost: number;
  alternativeModel?: string;
  alternativeReason?: string;
}

/**
 * Classify task complexity from user message
 */
export function classifyTaskComplexity(
  message: string,
  conversationHistory?: string[],
  _currentFile?: string
): TaskClassification {
  const lowerMessage = message.toLowerCase();
  const totalContext = [message, ...(conversationHistory || [])].join(" ");

  let complexity: TaskComplexity = "simple";
  let requiresReasoning = false;
  let requiresVision = false;
  let confidence = 0.8;

  // Check for reasoning indicators
  const reasoningIndicators = [
    "think", "megathink", "ultrathink",
    "analyze", "explain why", "reason",
    "compare", "evaluate", "consider",
    "design", "architect", "plan",
    "debug complex", "refactor",
    "optimize", "improve performance",
  ];

  const simpleIndicators = [
    "show", "list", "display",
    "run", "execute",
    "read file", "write file",
    "simple", "quick", "just",
    "what is", "how to",
  ];

  // Count indicators
  const reasoningCount = reasoningIndicators.filter((i) =>
    lowerMessage.includes(i)
  ).length;
  const simpleCount = simpleIndicators.filter((i) =>
    lowerMessage.includes(i)
  ).length;

  // Check for vision requirements
  if (
    /\.(png|jpg|jpeg|gif|webp|svg|bmp)\b/i.test(message) ||
    /image|screenshot|picture|photo|diagram/i.test(message)
  ) {
    requiresVision = true;
  }

  // Classify complexity
  if (reasoningCount >= 2 || /think|megathink|ultrathink/i.test(message)) {
    complexity = "reasoning_heavy";
    requiresReasoning = true;
  } else if (reasoningCount >= 1 || message.length > 500) {
    complexity = "complex";
    requiresReasoning = true;
  } else if (simpleCount >= 2 || message.length < 100) {
    complexity = "simple";
  } else {
    complexity = "moderate";
  }

  // Estimate tokens
  const estimatedTokens = Math.ceil(totalContext.length / 4);

  // Adjust confidence based on clarity
  if (reasoningCount > 0 && simpleCount > 0) {
    confidence = 0.6; // Mixed signals
  }

  return {
    complexity,
    requiresVision,
    requiresReasoning,
    requiresLongContext: estimatedTokens > 16000,
    estimatedTokens,
    confidence,
  };
}

/**
 * Select optimal model based on task classification
 */
export function selectModel(
  classification: TaskClassification,
  preferredModel?: string,
  availableModels: string[] = Object.keys(GROK_MODELS)
): RoutingDecision {
  // If user explicitly requested a model, use it
  if (preferredModel && availableModels.includes(preferredModel)) {
    const config = GROK_MODELS[preferredModel];
    return {
      recommendedModel: preferredModel,
      tier: config?.tier || "standard",
      reason: "User preference",
      estimatedCost: calculateCost(classification.estimatedTokens, preferredModel),
    };
  }

  // Vision requirement takes priority
  if (classification.requiresVision) {
    const visionModel = "grok-2-vision";
    if (availableModels.includes(visionModel)) {
      return {
        recommendedModel: visionModel,
        tier: "vision",
        reason: "Task requires image understanding",
        estimatedCost: calculateCost(classification.estimatedTokens, visionModel),
      };
    }
  }

  // Route based on complexity
  let recommendedModel: string;
  let reason: string;
  let alternativeModel: string | undefined;
  let alternativeReason: string | undefined;

  switch (classification.complexity) {
    case "simple":
      recommendedModel = "grok-3-mini";
      reason = "Simple task - using cost-effective mini model";
      alternativeModel = "grok-3";
      alternativeReason = "Use standard model for better quality";
      break;

    case "moderate":
      recommendedModel = "grok-3";
      reason = "Moderate complexity - using balanced standard model";
      alternativeModel = "grok-3-mini";
      alternativeReason = "Use mini model to reduce costs";
      break;

    case "complex":
      recommendedModel = "grok-3";
      reason = "Complex task - using standard model with good reasoning";
      alternativeModel = "grok-3-reasoning";
      alternativeReason = "Use reasoning model for deeper analysis";
      break;

    case "reasoning_heavy":
      recommendedModel = "grok-3-reasoning";
      reason = "Reasoning-heavy task - using extended reasoning model";
      alternativeModel = "grok-3";
      alternativeReason = "Use standard model to reduce costs";
      break;

    default:
      recommendedModel = "grok-3";
      reason = "Default selection";
  }

  // Verify model is available
  if (!availableModels.includes(recommendedModel)) {
    // Fall back to first available model
    recommendedModel = availableModels[0] || "grok-3";
    reason = "Fallback - preferred model not available";
  }

  const config = GROK_MODELS[recommendedModel];

  return {
    recommendedModel,
    tier: config?.tier || "standard",
    reason,
    estimatedCost: calculateCost(classification.estimatedTokens, recommendedModel),
    alternativeModel,
    alternativeReason,
  };
}

/**
 * Calculate estimated cost for a request
 */
export function calculateCost(tokens: number, modelId: string): number {
  const config = GROK_MODELS[modelId];
  if (!config) return 0;

  // Rough estimate: input + output tokens
  const totalTokens = tokens * 1.5; // Assume 50% output ratio
  return (totalTokens / 1_000_000) * config.costPerMillionTokens;
}

/**
 * Get cost comparison between models
 */
export function getCostComparison(
  tokens: number
): Array<{ model: string; tier: ModelTier; cost: number; savings: string }> {
  const costs = Object.entries(GROK_MODELS).map(([id, config]) => ({
    model: id,
    tier: config.tier,
    cost: calculateCost(tokens, id),
  }));

  // Sort by cost
  costs.sort((a, b) => a.cost - b.cost);

  // Calculate savings vs most expensive
  const mostExpensive = costs[costs.length - 1];
  if (mostExpensive === undefined) return [];
  const maxCost = mostExpensive.cost;

  return costs.map((c) => ({
    ...c,
    savings:
      c.cost === maxCost
        ? "baseline"
        : `-${Math.round((1 - c.cost / maxCost) * 100)}%`,
  }));
}

/**
 * Routing configuration
 */
export interface RoutingConfig {
  /** Enable automatic model routing */
  enabled: boolean;

  /** Default model when routing is disabled */
  defaultModel: string;

  /** Minimum confidence to apply routing */
  minConfidence: number;

  /** Cost threshold to prefer cheaper models */
  costSensitivity: "low" | "medium" | "high";

  /** Allow falling back to cheaper models on rate limits */
  allowFallback: boolean;

  /** Models to exclude from routing */
  excludeModels: string[];
}

/**
 * Default routing configuration
 */
export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  enabled: true,
  defaultModel: "grok-3",
  minConfidence: 0.7,
  costSensitivity: "medium",
  allowFallback: true,
  excludeModels: [],
};

/**
 * Model router class for managing routing state
 */
export class ModelRouter {
  private config: RoutingConfig;
  private usageStats: Map<string, { calls: number; tokens: number; cost: number }>;

  constructor(config: Partial<RoutingConfig> = {}) {
    this.config = { ...DEFAULT_ROUTING_CONFIG, ...config };
    this.usageStats = new Map();
  }

  /**
   * Route a request to the optimal model
   */
  route(
    message: string,
    conversationHistory?: string[],
    preferredModel?: string
  ): RoutingDecision {
    if (!this.config.enabled) {
      return {
        recommendedModel: preferredModel || this.config.defaultModel,
        tier: "standard",
        reason: "Routing disabled",
        estimatedCost: 0,
      };
    }

    const classification = classifyTaskComplexity(message, conversationHistory);

    // If confidence is too low, use default
    if (classification.confidence < this.config.minConfidence) {
      return {
        recommendedModel: this.config.defaultModel,
        tier: "standard",
        reason: `Low confidence (${classification.confidence.toFixed(2)}) - using default`,
        estimatedCost: calculateCost(classification.estimatedTokens, this.config.defaultModel),
      };
    }

    // Apply cost sensitivity
    const availableModels = Object.keys(GROK_MODELS).filter(
      (m) => !this.config.excludeModels.includes(m)
    );

    const decision = selectModel(classification, preferredModel, availableModels);

    // Adjust for cost sensitivity
    if (this.config.costSensitivity === "high" && decision.alternativeModel) {
      const altConfig = GROK_MODELS[decision.alternativeModel];
      const currentConfig = GROK_MODELS[decision.recommendedModel];

      if (altConfig && currentConfig && altConfig.costPerMillionTokens < currentConfig.costPerMillionTokens) {
        // Prefer cheaper alternative
        return {
          recommendedModel: decision.alternativeModel,
          tier: altConfig.tier,
          reason: `Cost-optimized: ${decision.alternativeReason}`,
          estimatedCost: calculateCost(classification.estimatedTokens, decision.alternativeModel),
          alternativeModel: decision.recommendedModel,
          alternativeReason: decision.reason,
        };
      }
    }

    return decision;
  }

  /**
   * Record usage for a model
   */
  recordUsage(modelId: string, tokens: number, cost: number): void {
    const current = this.usageStats.get(modelId) || { calls: 0, tokens: 0, cost: 0 };
    this.usageStats.set(modelId, {
      calls: current.calls + 1,
      tokens: current.tokens + tokens,
      cost: current.cost + cost,
    });
  }

  /**
   * Get usage statistics
   */
  getUsageStats(): Map<string, { calls: number; tokens: number; cost: number }> {
    return new Map(this.usageStats);
  }

  /**
   * Get total cost
   */
  getTotalCost(): number {
    let total = 0;
    for (const stats of this.usageStats.values()) {
      total += stats.cost;
    }
    return total;
  }

  /**
   * Get cost savings estimate (vs always using most expensive)
   */
  getEstimatedSavings(): { saved: number; percentage: number } {
    const maxCostModel = Object.values(GROK_MODELS).reduce((max, m) =>
      m.costPerMillionTokens > max.costPerMillionTokens ? m : max
    );

    let actualCost = 0;
    let maxPossibleCost = 0;

    for (const [_modelId, stats] of this.usageStats) {
      actualCost += stats.cost;
      maxPossibleCost +=
        (stats.tokens / 1_000_000) * maxCostModel.costPerMillionTokens * 1.5;
    }

    const saved = maxPossibleCost - actualCost;
    const percentage = maxPossibleCost > 0 ? (saved / maxPossibleCost) * 100 : 0;

    return { saved, percentage };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RoutingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): RoutingConfig {
    return { ...this.config };
  }
}

// Singleton instance
let routerInstance: ModelRouter | null = null;

/**
 * Get the global model router
 */
export function getModelRouter(): ModelRouter {
  if (!routerInstance) {
    routerInstance = new ModelRouter();
  }
  return routerInstance;
}

/**
 * Initialize model router with custom config
 */
export function initializeModelRouter(config: Partial<RoutingConfig>): ModelRouter {
  routerInstance = new ModelRouter(config);
  return routerInstance;
}

export default {
  classifyTaskComplexity,
  selectModel,
  calculateCost,
  getCostComparison,
  ModelRouter,
  getModelRouter,
  initializeModelRouter,
  GROK_MODELS,
  DEFAULT_ROUTING_CONFIG,
};
