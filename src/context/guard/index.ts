/**
 * Context Window Guard
 *
 * Inspired by OpenClaw's context-window-guard.ts
 * Provides token limit management with warnings and hard limits.
 */

import { EventEmitter } from 'events';

// ============================================================================
// Constants (from OpenClaw)
// ============================================================================

/** Minimum tokens below which execution is blocked */
export const CONTEXT_WINDOW_HARD_MIN_TOKENS = 16_000;

/** Warning threshold - below this, user is warned */
export const CONTEXT_WINDOW_WARN_BELOW_TOKENS = 32_000;

/** Default context window if not specified */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;

/** Safety margin for token estimation (1.2 = 20% buffer) */
export const TOKEN_ESTIMATION_SAFETY_MARGIN = 1.2;

// ============================================================================
// Types
// ============================================================================

/** Source of context window value */
export type ContextWindowSource =
  | 'model'           // From model metadata
  | 'modelsConfig'    // From models configuration file
  | 'agentConfig'     // From agent configuration
  | 'sessionConfig'   // From session configuration
  | 'default';        // Fallback default

/** Context window information */
export interface ContextWindowInfo {
  /** Token count for context window */
  tokens: number;
  /** Source of this value */
  source: ContextWindowSource;
  /** Model ID if applicable */
  modelId?: string;
}

/** Result of guard evaluation */
export interface ContextWindowGuardResult extends ContextWindowInfo {
  /** Whether to show a warning to user */
  shouldWarn: boolean;
  /** Whether to block execution */
  shouldBlock: boolean;
  /** Current usage tokens */
  currentUsage: number;
  /** Remaining tokens */
  remaining: number;
  /** Usage percentage */
  usagePercent: number;
  /** Warning message if applicable */
  warningMessage?: string;
  /** Block message if applicable */
  blockMessage?: string;
}

/** Guard configuration */
export interface ContextWindowGuardConfig {
  /** Hard minimum tokens (blocks below this) */
  hardMinTokens: number;
  /** Warning threshold */
  warnBelowTokens: number;
  /** Default context window */
  defaultTokens: number;
  /** Safety margin for estimates */
  safetyMargin: number;
  /** Enable warnings */
  enableWarnings: boolean;
  /** Enable blocking */
  enableBlocking: boolean;
}

/** Events emitted by guard */
export interface ContextWindowGuardEvents {
  'warning': (result: ContextWindowGuardResult) => void;
  'blocked': (result: ContextWindowGuardResult) => void;
  'threshold-crossed': (result: ContextWindowGuardResult) => void;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_GUARD_CONFIG: ContextWindowGuardConfig = {
  hardMinTokens: CONTEXT_WINDOW_HARD_MIN_TOKENS,
  warnBelowTokens: CONTEXT_WINDOW_WARN_BELOW_TOKENS,
  defaultTokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
  safetyMargin: TOKEN_ESTIMATION_SAFETY_MARGIN,
  enableWarnings: true,
  enableBlocking: true,
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Normalize value to positive integer
 */
export function normalizePositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

/**
 * Resolve context window info from multiple sources
 */
export function resolveContextWindowInfo(options: {
  modelTokens?: number;
  configTokens?: number;
  agentTokens?: number;
  sessionTokens?: number;
  defaultTokens?: number;
  modelId?: string;
}): ContextWindowInfo {
  const {
    modelTokens,
    configTokens,
    agentTokens,
    sessionTokens,
    defaultTokens = DEFAULT_CONTEXT_WINDOW_TOKENS,
    modelId,
  } = options;

  // Priority: session > agent > config > model > default
  const sessionVal = normalizePositiveInt(sessionTokens);
  if (sessionVal !== null) {
    return { tokens: sessionVal, source: 'sessionConfig', modelId };
  }

  const agentVal = normalizePositiveInt(agentTokens);
  if (agentVal !== null) {
    return { tokens: agentVal, source: 'agentConfig', modelId };
  }

  const configVal = normalizePositiveInt(configTokens);
  if (configVal !== null) {
    return { tokens: configVal, source: 'modelsConfig', modelId };
  }

  const modelVal = normalizePositiveInt(modelTokens);
  if (modelVal !== null) {
    return { tokens: modelVal, source: 'model', modelId };
  }

  return { tokens: defaultTokens, source: 'default', modelId };
}

/**
 * Evaluate context window guard
 */
export function evaluateContextWindowGuard(
  info: ContextWindowInfo,
  currentUsage: number,
  config: Partial<ContextWindowGuardConfig> = {}
): ContextWindowGuardResult {
  const {
    hardMinTokens = CONTEXT_WINDOW_HARD_MIN_TOKENS,
    warnBelowTokens = CONTEXT_WINDOW_WARN_BELOW_TOKENS,
    enableWarnings = true,
    enableBlocking = true,
  } = config;

  // Ensure minimum of 1 token for thresholds
  const effectiveHardMin = Math.max(1, hardMinTokens);
  const effectiveWarnBelow = Math.max(1, warnBelowTokens);

  const remaining = info.tokens - currentUsage;
  const usagePercent = info.tokens > 0 ? (currentUsage / info.tokens) * 100 : 100;

  const shouldBlock = enableBlocking && remaining < effectiveHardMin;
  const shouldWarn = enableWarnings && !shouldBlock && remaining < effectiveWarnBelow;

  let warningMessage: string | undefined;
  let blockMessage: string | undefined;

  if (shouldBlock) {
    blockMessage = `Context window nearly exhausted: ${remaining.toLocaleString()} tokens remaining (minimum: ${effectiveHardMin.toLocaleString()}). ` +
      `Consider starting a new session or compacting the conversation.`;
  } else if (shouldWarn) {
    warningMessage = `Context window running low: ${remaining.toLocaleString()} tokens remaining (${usagePercent.toFixed(1)}% used). ` +
      `Consider compacting soon.`;
  }

  return {
    ...info,
    shouldWarn,
    shouldBlock,
    currentUsage,
    remaining,
    usagePercent,
    warningMessage,
    blockMessage,
  };
}

// ============================================================================
// Context Window Guard Class
// ============================================================================

export class ContextWindowGuard extends EventEmitter {
  private config: ContextWindowGuardConfig;
  private lastResult: ContextWindowGuardResult | null = null;
  private warningEmitted = false;
  private contextInfo: ContextWindowInfo | null = null;

  constructor(config: Partial<ContextWindowGuardConfig> = {}) {
    super();
    this.config = { ...DEFAULT_GUARD_CONFIG, ...config };
  }

  /**
   * Set context window info
   */
  setContextWindow(info: ContextWindowInfo): void {
    this.contextInfo = info;
    this.warningEmitted = false;
  }

  /**
   * Set context window from multiple sources
   */
  resolveContextWindow(options: Parameters<typeof resolveContextWindowInfo>[0]): ContextWindowInfo {
    const info = resolveContextWindowInfo({
      ...options,
      defaultTokens: this.config.defaultTokens,
    });
    this.setContextWindow(info);
    return info;
  }

  /**
   * Check current usage against limits
   */
  check(currentUsage: number): ContextWindowGuardResult {
    if (!this.contextInfo) {
      this.contextInfo = {
        tokens: this.config.defaultTokens,
        source: 'default',
      };
    }

    const result = evaluateContextWindowGuard(
      this.contextInfo,
      currentUsage,
      this.config
    );

    // Track threshold crossing
    if (this.lastResult) {
      const wasAboveWarn = this.lastResult.remaining >= this.config.warnBelowTokens;
      const nowBelowWarn = result.remaining < this.config.warnBelowTokens;

      if (wasAboveWarn && nowBelowWarn) {
        this.emit('threshold-crossed', result);
      }
    }

    // Emit events
    if (result.shouldBlock) {
      this.emit('blocked', result);
    } else if (result.shouldWarn && !this.warningEmitted) {
      this.emit('warning', result);
      this.warningEmitted = true;
    }

    this.lastResult = result;
    return result;
  }

  /**
   * Get last check result
   */
  getLastResult(): ContextWindowGuardResult | null {
    return this.lastResult;
  }

  /**
   * Get current context info
   */
  getContextInfo(): ContextWindowInfo | null {
    return this.contextInfo;
  }

  /**
   * Reset warning state (e.g., after compaction)
   */
  resetWarning(): void {
    this.warningEmitted = false;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ContextWindowGuardConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get configuration
   */
  getConfig(): ContextWindowGuardConfig {
    return { ...this.config };
  }

  /**
   * Calculate safe token budget with margin
   */
  getSafeTokenBudget(): number {
    if (!this.contextInfo) {
      return Math.floor(this.config.defaultTokens / this.config.safetyMargin);
    }
    return Math.floor(this.contextInfo.tokens / this.config.safetyMargin);
  }

  /**
   * Check if compaction is recommended
   */
  shouldCompact(currentUsage: number, compactionThreshold = 0.7): boolean {
    if (!this.contextInfo) return false;

    const usagePercent = currentUsage / this.contextInfo.tokens;
    return usagePercent >= compactionThreshold;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let guardInstance: ContextWindowGuard | null = null;

export function getContextWindowGuard(
  config?: Partial<ContextWindowGuardConfig>
): ContextWindowGuard {
  if (!guardInstance) {
    guardInstance = new ContextWindowGuard(config);
  }
  return guardInstance;
}

export function resetContextWindowGuard(): void {
  guardInstance = null;
}
