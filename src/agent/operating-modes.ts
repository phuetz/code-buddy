/**
 * Operating Modes System
 *
 * Based on Amp's Smart/Rush modes:
 * - Quality: Best model, thorough analysis, higher cost
 * - Balanced: Default mode, good trade-off
 * - Fast: Speed optimized, lower cost, simple tasks
 *
 * Allows users to control the quality/cost/speed tradeoff.
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export type OperatingMode = 'quality' | 'balanced' | 'fast' | 'plan' | 'ask' | 'custom';

export interface ModeConfig {
  name: string;
  description: string;

  // Model selection
  preferredModel: string;
  fallbackModel?: string;

  // Token budgets
  maxInputTokens: number;
  maxOutputTokens: number;
  maxContextTokens: number;

  // Reasoning settings
  enableExtendedThinking: boolean;
  thinkingBudget: number;

  // Tool settings
  maxToolRounds: number;
  parallelToolCalls: boolean;
  allowedTools: string[] | 'all' | 'none';

  // Quality settings
  enableSelfReview: boolean;
  enableIterativeRefinement: boolean;
  maxRefinementRounds: number;

  // Context settings
  enableRAG: boolean;
  ragTopK: number;
  enableRepoMap: boolean;

  // Cost controls
  maxCostPerRequest: number;  // in dollars
  warnAtCost: number;

  // Speed settings
  streamResponse: boolean;
  eagerExecution: boolean;  // Start executing before full plan

  // Prompt settings
  systemPromptAddition?: string;
}

// ============================================================================
// Mode Configurations
// ============================================================================

const QUALITY_MODE: ModeConfig = {
  name: 'Quality',
  description: 'Best quality, thorough analysis, higher cost',

  preferredModel: 'grok-3',
  fallbackModel: 'grok-2-latest',

  maxInputTokens: 128000,
  maxOutputTokens: 16000,
  maxContextTokens: 200000,

  enableExtendedThinking: true,
  thinkingBudget: 32000,

  maxToolRounds: 30,
  parallelToolCalls: false, // Sequential for accuracy
  allowedTools: 'all',

  enableSelfReview: true,
  enableIterativeRefinement: true,
  maxRefinementRounds: 3,

  enableRAG: true,
  ragTopK: 20,
  enableRepoMap: true,

  maxCostPerRequest: 5.0,
  warnAtCost: 2.0,

  streamResponse: true,
  eagerExecution: false,
};

const BALANCED_MODE: ModeConfig = {
  name: 'Balanced',
  description: 'Good balance of quality, speed, and cost',

  preferredModel: 'grok-2-latest',
  fallbackModel: 'grok-2-mini',

  maxInputTokens: 64000,
  maxOutputTokens: 8000,
  maxContextTokens: 100000,

  enableExtendedThinking: true,
  thinkingBudget: 8000,

  maxToolRounds: 20,
  parallelToolCalls: true,
  allowedTools: 'all',

  enableSelfReview: false,
  enableIterativeRefinement: true,
  maxRefinementRounds: 2,

  enableRAG: true,
  ragTopK: 10,
  enableRepoMap: true,

  maxCostPerRequest: 2.0,
  warnAtCost: 1.0,

  streamResponse: true,
  eagerExecution: false,
};

const FAST_MODE: ModeConfig = {
  name: 'Fast',
  description: 'Speed optimized, lower cost, for simple tasks',

  preferredModel: 'grok-2-mini',
  fallbackModel: undefined,

  maxInputTokens: 32000,
  maxOutputTokens: 4000,
  maxContextTokens: 50000,

  enableExtendedThinking: false,
  thinkingBudget: 0,

  maxToolRounds: 10,
  parallelToolCalls: true,
  allowedTools: 'all',

  enableSelfReview: false,
  enableIterativeRefinement: false,
  maxRefinementRounds: 0,

  enableRAG: false,
  ragTopK: 5,
  enableRepoMap: false,

  maxCostPerRequest: 0.5,
  warnAtCost: 0.25,

  streamResponse: true,
  eagerExecution: true,
};

const PLAN_MODE: ModeConfig = {
  ...BALANCED_MODE,
  name: 'Plan',
  description: 'Planning mode - AI explains approach without making changes',
  allowedTools: ['view_file', 'search', 'web_search', 'web_fetch'],
  systemPromptAddition: `
CURRENT MODE: PLANNING MODE
In this mode, you should:
- Analyze the request and create a detailed plan
- Explain your approach step by step
- List all files that would need to be modified
- Describe the changes you would make
- DO NOT execute any file modifications or bash commands
- Only use view_file and search to understand the codebase
- When ready to implement, tell the user to switch to /code mode`
};

const ASK_MODE: ModeConfig = {
  ...BALANCED_MODE,
  name: 'Ask',
  description: 'Ask mode - AI only answers questions, no tool usage',
  allowedTools: 'none',
  systemPromptAddition: `
CURRENT MODE: ASK MODE
In this mode, you should:
- Only answer questions based on your knowledge
- DO NOT use any tools
- If the user asks to make changes, tell them to switch to /code mode
- Provide explanations, suggestions, and guidance without executing actions`
};

const MODE_CONFIGS: Record<OperatingMode, ModeConfig> = {
  quality: QUALITY_MODE,
  balanced: BALANCED_MODE,
  fast: FAST_MODE,
  plan: PLAN_MODE,
  ask: ASK_MODE,
  custom: BALANCED_MODE, // Default for custom, will be overridden
};

// ============================================================================
// Operating Mode Manager
// ============================================================================

export class OperatingModeManager extends EventEmitter {
  private currentMode: OperatingMode = 'balanced';
  private customConfig: Partial<ModeConfig> = {};
  private modeHistory: Array<{ mode: OperatingMode; timestamp: number; reason?: string }> = [];

  constructor(initialMode: OperatingMode = 'balanced') {
    super();
    this.currentMode = initialMode;
  }

  /**
   * Get current mode
   */
  getMode(): OperatingMode {
    return this.currentMode;
  }

  /**
   * Get current mode configuration
   */
  getModeConfig(): ModeConfig {
    if (this.currentMode === 'custom') {
      return { ...MODE_CONFIGS.balanced, ...this.customConfig } as ModeConfig;
    }
    return MODE_CONFIGS[this.currentMode];
  }

  /**
   * Set operating mode
   */
  setMode(mode: OperatingMode, reason?: string): void {
    const previousMode = this.currentMode;
    this.currentMode = mode;

    this.modeHistory.push({
      mode,
      timestamp: Date.now(),
      reason,
    });

    // Keep history limited
    if (this.modeHistory.length > 100) {
      this.modeHistory.shift();
    }

    this.emit('mode:changed', {
      previousMode,
      newMode: mode,
      config: this.getModeConfig(),
      reason,
    });
  }

  /**
   * Set custom configuration
   */
  setCustomConfig(config: Partial<ModeConfig>): void {
    this.customConfig = { ...this.customConfig, ...config };
    if (this.currentMode === 'custom') {
      this.emit('config:updated', this.getModeConfig());
    }
  }

  /**
   * Check if a tool is allowed in the current mode
   */
  isToolAllowed(toolName: string): boolean {
    const config = this.getModeConfig();

    if (config.allowedTools === 'all') return true;
    if (config.allowedTools === 'none') return false;

    return config.allowedTools.includes(toolName);
  }

  /**
   * Get system prompt addition for the current mode
   */
  getSystemPromptAddition(): string {
    return this.getModeConfig().systemPromptAddition || '';
  }

  /**
   * Auto-select mode based on task characteristics
   */
  autoSelectMode(task: {
    estimatedComplexity: 'low' | 'medium' | 'high';
    urgency?: 'low' | 'normal' | 'high';
    costSensitive?: boolean;
    requiresAccuracy?: boolean;
  }): OperatingMode {
    // High urgency or cost sensitive -> fast mode
    if (task.urgency === 'high' || task.costSensitive) {
      return 'fast';
    }

    // Requires accuracy or high complexity -> quality mode
    if (task.requiresAccuracy || task.estimatedComplexity === 'high') {
      return 'quality';
    }

    // Default to balanced
    return 'balanced';
  }

  /**
   * Get recommended model for current mode
   */
  getRecommendedModel(): string {
    return this.getModeConfig().preferredModel;
  }

  /**
   * Check if a feature is enabled in current mode
   */
  isFeatureEnabled(feature: keyof ModeConfig): boolean {
    const config = this.getModeConfig();
    const value = config[feature];
    return typeof value === 'boolean' ? value : true;
  }

  /**
   * Get token budget for current mode
   */
  getTokenBudget(): {
    input: number;
    output: number;
    context: number;
    thinking: number;
  } {
    const config = this.getModeConfig();
    return {
      input: config.maxInputTokens,
      output: config.maxOutputTokens,
      context: config.maxContextTokens,
      thinking: config.thinkingBudget,
    };
  }

  /**
   * Get cost limits for current mode
   */
  getCostLimits(): { max: number; warn: number } {
    const config = this.getModeConfig();
    return {
      max: config.maxCostPerRequest,
      warn: config.warnAtCost,
    };
  }

  /**
   * Get all available modes
   */
  getAvailableModes(): Array<{
    mode: OperatingMode;
    name: string;
    description: string;
  }> {
    return [
      { mode: 'quality' as OperatingMode, name: MODE_CONFIGS.quality.name, description: MODE_CONFIGS.quality.description },
      { mode: 'balanced' as OperatingMode, name: MODE_CONFIGS.balanced.name, description: MODE_CONFIGS.balanced.description },
      { mode: 'fast' as OperatingMode, name: MODE_CONFIGS.fast.name, description: MODE_CONFIGS.fast.description },
      { mode: 'plan' as OperatingMode, name: MODE_CONFIGS.plan.name, description: MODE_CONFIGS.plan.description },
      { mode: 'ask' as OperatingMode, name: MODE_CONFIGS.ask.name, description: MODE_CONFIGS.ask.description },
      { mode: 'custom' as OperatingMode, name: 'Custom', description: 'User-defined configuration' },
    ];
  }

  /**
   * Get mode history
   */
  getModeHistory(): Array<{ mode: OperatingMode; timestamp: number; reason?: string }> {
    return [...this.modeHistory];
  }

  /**
   * Get mode statistics
   */
  getModeStats(): Record<OperatingMode, number> {
    const stats: Record<OperatingMode, number> = {
      quality: 0,
      balanced: 0,
      fast: 0,
      plan: 0,
      ask: 0,
      custom: 0,
    };

    for (const entry of this.modeHistory) {
      stats[entry.mode]++;
    }

    return stats;
  }

  /**
   * Format mode status for display
   */
  formatModeStatus(): string {
    const config = this.getModeConfig();
    const modeEmojis: Record<OperatingMode, string> = {
      quality: '💎',
      balanced: '⚖️',
      fast: '⚡',
      plan: '📋',
      ask: '❓',
      custom: '⚙️'
    };
    return `${modeEmojis[this.currentMode] || '🔄'} Mode: ${this.currentMode} - ${config.description}`;
  }

  /**
   * Get help text for modes
   */
  static getModeHelp(): string {
    return [
      '  /quality - Best quality, thorough analysis',
      '  /balanced - Good balance of quality/speed/cost',
      '  /fast - Speed optimized for simple tasks',
      '  /plan - Planning mode (no changes)',
      '  /ask - Chat only mode (no tools)',
    ].join('\n');
  }

  /**
   * Temporarily use a different mode for one operation
   */
  withMode<T>(mode: OperatingMode, fn: () => T): T {
    const previousMode = this.currentMode;
    this.currentMode = mode;

    try {
      return fn();
    } finally {
      this.currentMode = previousMode;
    }
  }

  /**
   * Async version of withMode
   */
  async withModeAsync<T>(mode: OperatingMode, fn: () => Promise<T>): Promise<T> {
    const previousMode = this.currentMode;
    this.currentMode = mode;

    try {
      return await fn();
    } finally {
      this.currentMode = previousMode;
    }
  }

  /**
   * Dispose and clean up resources
   */
  dispose(): void {
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let operatingModeInstance: OperatingModeManager | null = null;

export function getOperatingModeManager(
  initialMode?: OperatingMode
): OperatingModeManager {
  if (!operatingModeInstance) {
    operatingModeInstance = new OperatingModeManager(initialMode);
  }
  return operatingModeInstance;
}

export function resetOperatingModeManager(): void {
  if (operatingModeInstance) {
    operatingModeInstance.dispose();
  }
  operatingModeInstance = null;
}
