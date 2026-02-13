/**
 * Cost Predictor
 *
 * Estimates the cost of a request BEFORE execution based on:
 * - Input token count from messages
 * - Historical average output tokens (from CostTracker stats)
 * - Model-specific pricing
 *
 * @module analytics
 */

import type { CostTracker, ModelPricing } from '../utils/cost-tracker.js';

export interface CostPrediction {
  /** Estimated number of input tokens */
  estimatedInputTokens: number;
  /** Estimated number of output tokens */
  estimatedOutputTokens: number;
  /** Estimated cost in USD */
  estimatedCost: number;
  /** Model used for the prediction */
  model: string;
  /** Confidence level of the prediction */
  confidence: 'low' | 'medium' | 'high';
}

// Model pricing lookup (mirrors cost-tracker.ts)
const MODEL_PRICING: Record<string, ModelPricing> = {
  'grok-3-latest': { inputPer1k: 0.005, outputPer1k: 0.015 },
  'grok-3-fast': { inputPer1k: 0.003, outputPer1k: 0.009 },
  'grok-code-fast-1': { inputPer1k: 0.002, outputPer1k: 0.006 },
  'grok-2-latest': { inputPer1k: 0.002, outputPer1k: 0.010 },
  'default': { inputPer1k: 0.003, outputPer1k: 0.010 },
};

/** Average characters per token (rough heuristic) */
const CHARS_PER_TOKEN = 4;

/** Default output token estimate when no history is available */
const DEFAULT_OUTPUT_TOKENS = 500;

/**
 * Cost Predictor - Estimates request cost before execution
 */
export class CostPredictor {
  private costTracker: CostTracker;

  constructor(costTracker: CostTracker) {
    this.costTracker = costTracker;
  }

  /**
   * Estimate cost based on message history length and model.
   *
   * @param messages - The messages array to be sent to the LLM
   * @param model - The model identifier
   * @returns A cost prediction with estimated tokens, cost, and confidence
   */
  predict(
    messages: Array<{ role: string; content: string }>,
    model: string
  ): CostPrediction {
    const estimatedInputTokens = this.estimateInputTokens(messages);
    const estimatedOutputTokens = this.estimateOutputTokens();
    const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];

    const estimatedCost =
      (estimatedInputTokens / 1000) * pricing.inputPer1k +
      (estimatedOutputTokens / 1000) * pricing.outputPer1k;

    const confidence = this.determineConfidence(messages);

    return {
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedCost,
      model,
      confidence,
    };
  }

  /**
   * Get average cost per request from recorded history.
   *
   * @returns Average cost in USD, or 0 if no history exists
   */
  getAverageCostPerRequest(): number {
    const report = this.costTracker.getReport();
    const recentUsage = report.recentUsage;

    if (recentUsage.length === 0) {
      return 0;
    }

    const totalCost = recentUsage.reduce((sum, u) => sum + u.cost, 0);
    return totalCost / recentUsage.length;
  }

  /**
   * Get cost trend based on recent usage history.
   *
   * Compares the average cost of the first half of recent usage
   * to the second half. A >20% change in either direction is
   * considered increasing or decreasing.
   *
   * @returns 'increasing', 'decreasing', or 'stable'
   */
  getCostTrend(): 'increasing' | 'decreasing' | 'stable' {
    const report = this.costTracker.getReport();
    const recentUsage = report.recentUsage;

    if (recentUsage.length < 4) {
      return 'stable';
    }

    const midpoint = Math.floor(recentUsage.length / 2);
    const firstHalf = recentUsage.slice(0, midpoint);
    const secondHalf = recentUsage.slice(midpoint);

    const firstAvg = firstHalf.reduce((sum, u) => sum + u.cost, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, u) => sum + u.cost, 0) / secondHalf.length;

    if (firstAvg === 0) {
      return secondAvg > 0 ? 'increasing' : 'stable';
    }

    const changeRatio = (secondAvg - firstAvg) / firstAvg;

    if (changeRatio > 0.2) {
      return 'increasing';
    } else if (changeRatio < -0.2) {
      return 'decreasing';
    }

    return 'stable';
  }

  /**
   * Estimate input token count from messages.
   *
   * Uses a character-based heuristic (approximately 4 characters per token)
   * as a fast approximation without requiring tiktoken.
   */
  private estimateInputTokens(
    messages: Array<{ role: string; content: string }>
  ): number {
    let totalChars = 0;

    for (const message of messages) {
      // Account for role overhead (~4 tokens per message for role + framing)
      totalChars += 16;
      if (message.content) {
        totalChars += message.content.length;
      }
    }

    return Math.ceil(totalChars / CHARS_PER_TOKEN);
  }

  /**
   * Estimate output tokens based on historical average.
   *
   * If the cost tracker has recorded usage, uses the average
   * output token count. Otherwise falls back to a default estimate.
   */
  private estimateOutputTokens(): number {
    const report = this.costTracker.getReport();
    const recentUsage = report.recentUsage;

    if (recentUsage.length === 0) {
      return DEFAULT_OUTPUT_TOKENS;
    }

    const totalOutputTokens = recentUsage.reduce(
      (sum, u) => sum + u.outputTokens,
      0
    );
    return Math.ceil(totalOutputTokens / recentUsage.length);
  }

  /**
   * Determine prediction confidence based on available data.
   *
   * - high: 5+ recent usage entries (good historical data)
   * - medium: 1-4 recent entries (some data)
   * - low: no recent usage (pure estimation)
   */
  private determineConfidence(
    messages: Array<{ role: string; content: string }>
  ): 'low' | 'medium' | 'high' {
    const report = this.costTracker.getReport();
    const recentCount = report.recentUsage.length;

    if (recentCount >= 5) {
      return 'high';
    } else if (recentCount >= 1) {
      return 'medium';
    }

    return 'low';
  }
}
