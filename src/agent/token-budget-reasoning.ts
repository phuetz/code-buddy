/**
 * Token-Budget-Aware Reasoning System
 *
 * Based on TALE paper (arXiv 2412.18547):
 * - Assess task complexity before processing
 * - Allocate reasoning tokens dynamically
 * - Skip verbose reasoning for simple tasks
 * - Achieve 68.9% token reduction with <5% accuracy loss
 *
 * Key insight: Not all tasks require the same level of reasoning depth.
 * Simple tasks can use quick responses while complex tasks get full reasoning.
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export type TaskComplexity = 'trivial' | 'simple' | 'moderate' | 'complex' | 'expert';

export interface ComplexityAssessment {
  level: TaskComplexity;
  score: number;           // 0-1 complexity score
  factors: ComplexityFactor[];
  suggestedTokenBudget: number;
  suggestedThinkingDepth: ThinkingDepth;
}

export interface ComplexityFactor {
  name: string;
  weight: number;
  detected: boolean;
  contribution: number;
}

export type ThinkingDepth = 'none' | 'brief' | 'standard' | 'deep' | 'exhaustive';

export interface TokenBudgetConfig {
  // Base token budgets per complexity level
  budgets: Record<TaskComplexity, number>;
  // Thinking depth per complexity level
  thinkingDepths: Record<TaskComplexity, ThinkingDepth>;
  // Enable/disable adaptive budgeting
  adaptiveEnabled: boolean;
  // Maximum total tokens (hard limit)
  maxTotalTokens: number;
  // Minimum tokens for any response
  minTokens: number;
}

export interface ReasoningResult {
  response: string;
  tokensUsed: number;
  tokensSaved: number;
  complexityAssessment: ComplexityAssessment;
  thinkingDepth: ThinkingDepth;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: TokenBudgetConfig = {
  budgets: {
    trivial: 100,      // Simple acknowledgments, yes/no
    simple: 500,       // Direct answers, simple code changes
    moderate: 2000,    // Multi-step tasks, medium code changes
    complex: 8000,     // Complex analysis, large refactoring
    expert: 16000,     // Architecture decisions, complex debugging
  },
  thinkingDepths: {
    trivial: 'none',
    simple: 'brief',
    moderate: 'standard',
    complex: 'deep',
    expert: 'exhaustive',
  },
  adaptiveEnabled: true,
  maxTotalTokens: 32000,
  minTokens: 50,
};

// ============================================================================
// Complexity Factors
// ============================================================================

const COMPLEXITY_FACTORS: Array<{
  name: string;
  weight: number;
  detect: (task: string, context?: TaskContext) => boolean;
}> = [
  // Code complexity indicators
  {
    name: 'multiple_files',
    weight: 0.15,
    detect: (task) => /multiple\s+files?|several\s+files?|across\s+files?/i.test(task),
  },
  {
    name: 'architecture',
    weight: 0.2,
    detect: (task) => /architect|design|structure|refactor.*entire|reorganize/i.test(task),
  },
  {
    name: 'debugging',
    weight: 0.15,
    detect: (task) => /debug|fix.*bug|error|issue|broken|not working/i.test(task),
  },
  {
    name: 'performance',
    weight: 0.15,
    detect: (task) => /optimi[zs]e|performance|speed|slow|memory|efficient/i.test(task),
  },
  {
    name: 'security',
    weight: 0.2,
    detect: (task) => /security|vulnerabilit|auth|permission|access control|encrypt/i.test(task),
  },
  {
    name: 'api_integration',
    weight: 0.1,
    detect: (task) => /api|integrat|connect|external\s+service/i.test(task),
  },
  {
    name: 'testing',
    weight: 0.1,
    detect: (task) => /test|spec|coverage|mock|stub/i.test(task),
  },
  {
    name: 'documentation',
    weight: 0.05,
    detect: (task) => /document|readme|comment|explain/i.test(task),
  },

  // Task scope indicators
  {
    name: 'large_scope',
    weight: 0.15,
    detect: (task) => /all|entire|whole|every|complete|full/i.test(task),
  },
  {
    name: 'small_scope',
    weight: -0.1, // Negative = reduces complexity
    detect: (task) => /simple|quick|small|minor|just|only|single/i.test(task),
  },

  // Context indicators
  {
    name: 'code_provided',
    weight: -0.05,
    detect: (_, ctx) => ctx?.codeContext !== undefined && ctx.codeContext.length > 100,
  },
  {
    name: 'error_message',
    weight: 0.05,
    detect: (_, ctx) => ctx?.errorMessage !== undefined,
  },
  {
    name: 'previous_attempts',
    weight: 0.1,
    detect: (_, ctx) => ctx?.previousAttempts !== undefined && ctx.previousAttempts > 0,
  },

  // Question complexity
  {
    name: 'multiple_questions',
    weight: 0.1,
    detect: (task) => (task.match(/\?/g) || []).length > 1,
  },
  {
    name: 'comparison',
    weight: 0.1,
    detect: (task) => /compare|versus|vs\.?|difference|better|worse|pros.*cons/i.test(task),
  },
  {
    name: 'recommendation',
    weight: 0.1,
    detect: (task) => /recommend|suggest|should\s+i|best\s+way|approach/i.test(task),
  },
];

// ============================================================================
// Task Context
// ============================================================================

export interface TaskContext {
  codeContext?: string;
  errorMessage?: string;
  previousAttempts?: number;
  fileCount?: number;
  projectSize?: 'small' | 'medium' | 'large';
  urgency?: 'low' | 'normal' | 'high';
}

// ============================================================================
// Token Budget Reasoning System
// ============================================================================

export class TokenBudgetReasoning extends EventEmitter {
  private config: TokenBudgetConfig;
  private history: ComplexityAssessment[] = [];

  constructor(config: Partial<TokenBudgetConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Assess task complexity and determine token budget
   */
  assessComplexity(task: string, context?: TaskContext): ComplexityAssessment {
    const factors: ComplexityFactor[] = [];
    let totalScore = 0.3; // Base score

    // Evaluate each complexity factor
    for (const factor of COMPLEXITY_FACTORS) {
      const detected = factor.detect(task, context);
      const contribution = detected ? factor.weight : 0;

      factors.push({
        name: factor.name,
        weight: factor.weight,
        detected,
        contribution,
      });

      totalScore += contribution;
    }

    // Apply context multipliers
    if (context?.projectSize === 'large') totalScore *= 1.2;
    if (context?.urgency === 'high') totalScore *= 0.9; // Less time for deep thinking
    if (context?.fileCount && context.fileCount > 5) totalScore *= 1.1;

    // Clamp score to 0-1
    totalScore = Math.max(0, Math.min(1, totalScore));

    // Determine complexity level
    const level = this.scoreToLevel(totalScore);

    // Calculate suggested budget
    const suggestedTokenBudget = this.calculateBudget(level, totalScore);
    const suggestedThinkingDepth = this.config.thinkingDepths[level];

    const assessment: ComplexityAssessment = {
      level,
      score: totalScore,
      factors,
      suggestedTokenBudget,
      suggestedThinkingDepth,
    };

    // Track history for adaptive learning
    this.history.push(assessment);
    if (this.history.length > 100) {
      this.history.shift();
    }

    this.emit('complexity:assessed', assessment);

    return assessment;
  }

  /**
   * Get optimal token budget for a task
   */
  getTokenBudget(task: string, context?: TaskContext): number {
    const assessment = this.assessComplexity(task, context);
    return assessment.suggestedTokenBudget;
  }

  /**
   * Get thinking depth for a task
   */
  getThinkingDepth(task: string, context?: TaskContext): ThinkingDepth {
    const assessment = this.assessComplexity(task, context);
    return assessment.suggestedThinkingDepth;
  }

  /**
   * Generate system prompt modifier based on complexity
   */
  getSystemPromptModifier(assessment: ComplexityAssessment): string {
    switch (assessment.suggestedThinkingDepth) {
      case 'none':
        return 'Respond concisely and directly. No explanation needed.';

      case 'brief':
        return 'Provide a brief response with minimal explanation.';

      case 'standard':
        return 'Provide a clear response with appropriate explanation.';

      case 'deep':
        return 'Think through this carefully. Consider multiple approaches and explain your reasoning.';

      case 'exhaustive':
        return 'This is a complex task. Analyze thoroughly, consider edge cases, trade-offs, and provide detailed reasoning.';
    }
  }

  /**
   * Create a token-budget-aware prompt wrapper
   */
  createBudgetAwarePrompt(
    task: string,
    context?: TaskContext
  ): {
    systemModifier: string;
    maxTokens: number;
    assessment: ComplexityAssessment;
  } {
    const assessment = this.assessComplexity(task, context);

    return {
      systemModifier: this.getSystemPromptModifier(assessment),
      maxTokens: assessment.suggestedTokenBudget,
      assessment,
    };
  }

  /**
   * Estimate tokens saved compared to max budget
   */
  estimateSavings(assessment: ComplexityAssessment): {
    tokensSaved: number;
    percentageSaved: number;
  } {
    const maxBudget = this.config.maxTotalTokens;
    const actualBudget = assessment.suggestedTokenBudget;
    const tokensSaved = maxBudget - actualBudget;

    return {
      tokensSaved,
      percentageSaved: (tokensSaved / maxBudget) * 100,
    };
  }

  /**
   * Get average complexity from history
   */
  getAverageComplexity(): number {
    if (this.history.length === 0) return 0.5;
    return this.history.reduce((sum, a) => sum + a.score, 0) / this.history.length;
  }

  /**
   * Get complexity distribution from history
   */
  getComplexityDistribution(): Record<TaskComplexity, number> {
    const distribution: Record<TaskComplexity, number> = {
      trivial: 0,
      simple: 0,
      moderate: 0,
      complex: 0,
      expert: 0,
    };

    for (const assessment of this.history) {
      distribution[assessment.level]++;
    }

    return distribution;
  }

  /**
   * Convert score to complexity level
   */
  private scoreToLevel(score: number): TaskComplexity {
    if (score < 0.15) return 'trivial';
    if (score < 0.35) return 'simple';
    if (score < 0.55) return 'moderate';
    if (score < 0.75) return 'complex';
    return 'expert';
  }

  /**
   * Calculate token budget for a complexity level
   */
  private calculateBudget(level: TaskComplexity, score: number): number {
    const baseBudget = this.config.budgets[level];

    if (!this.config.adaptiveEnabled) {
      return baseBudget;
    }

    // Interpolate within the level
    const levels: TaskComplexity[] = ['trivial', 'simple', 'moderate', 'complex', 'expert'];
    const levelIndex = levels.indexOf(level);

    if (levelIndex === 0 || levelIndex === levels.length - 1) {
      return baseBudget;
    }

    // Adaptive adjustment based on exact score
    const levelThresholds = [0, 0.15, 0.35, 0.55, 0.75, 1.0];
    const lowerThreshold = levelThresholds[levelIndex];
    const upperThreshold = levelThresholds[levelIndex + 1];

    const positionInLevel = (score - lowerThreshold) / (upperThreshold - lowerThreshold);
    const nextLevelBudget = this.config.budgets[levels[levelIndex + 1]];

    const adaptiveBudget = baseBudget + (nextLevelBudget - baseBudget) * positionInLevel;

    return Math.round(
      Math.max(this.config.minTokens, Math.min(this.config.maxTotalTokens, adaptiveBudget))
    );
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TokenBudgetConfig>): void {
    this.config = { ...this.config, ...config };
    this.emit('config:updated', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): TokenBudgetConfig {
    return { ...this.config };
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.history = [];
  }
}

// ============================================================================
// Singleton
// ============================================================================

let tokenBudgetInstance: TokenBudgetReasoning | null = null;

export function getTokenBudgetReasoning(
  config?: Partial<TokenBudgetConfig>
): TokenBudgetReasoning {
  if (!tokenBudgetInstance) {
    tokenBudgetInstance = new TokenBudgetReasoning(config);
  }
  return tokenBudgetInstance;
}

export function resetTokenBudgetReasoning(): void {
  tokenBudgetInstance = null;
}
