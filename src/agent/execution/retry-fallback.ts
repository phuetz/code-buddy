/**
 * OpenClaw-inspired Retry Loop with Provider Fallback
 *
 * Implements intelligent retry mechanism with:
 * - Error classification (context overflow, rate limit, auth failure)
 * - Automatic fallback to next provider/profile
 * - Auth profile rotation with cooldown
 * - Context auto-compaction on overflow
 * - Thinking level fallback for unsupported features
 */

import { EventEmitter } from 'events';
import { SmartCompactionEngine, CompactionConfig, type Message as CompactionMessage } from '../../context/smart-compaction.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface AuthProfile {
  id: string;
  name: string;
  provider: string;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  priority: number;
  /** Whether this profile is currently locked (rate limited) */
  locked?: boolean;
  /** Timestamp when profile can be used again */
  cooldownUntil?: number;
  /** Number of consecutive failures */
  failureCount?: number;
  /** Last successful usage timestamp */
  lastSuccess?: number;
}

export interface ExecutionConfig {
  /** Maximum retry attempts per profile */
  maxRetries: number;
  /** Base delay between retries in ms */
  baseDelayMs: number;
  /** Maximum delay between retries in ms */
  maxDelayMs: number;
  /** Cooldown duration after rate limit in ms */
  rateLimitCooldownMs: number;
  /** Whether to enable auto-compaction on overflow */
  autoCompact: boolean;
  /** Compaction configuration */
  compactionConfig?: Partial<CompactionConfig>;
  /** Thinking levels to try in order */
  thinkingLevels?: string[];
}

export type ErrorType =
  | 'CONTEXT_OVERFLOW'
  | 'RATE_LIMIT'
  | 'AUTH_FAILURE'
  | 'THINKING_LEVEL'
  | 'MODEL_UNAVAILABLE'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'UNKNOWN';

export interface ClassifiedError {
  type: ErrorType;
  message: string;
  retryable: boolean;
  requiresProfileRotation: boolean;
  requiresCompaction: boolean;
  originalError: Error;
}

export interface ExecutionAttempt<T> {
  profileId: string;
  attempt: number;
  thinkingLevel?: string;
  startTime: number;
  endTime?: number;
  success: boolean;
  result?: T;
  error?: ClassifiedError;
}

export interface ExecutionResult<T> {
  success: boolean;
  result?: T;
  attempts: ExecutionAttempt<T>[];
  finalProfile?: AuthProfile;
  totalDurationMs: number;
  error?: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: ExecutionConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  rateLimitCooldownMs: 60000,
  autoCompact: true,
  thinkingLevels: ['high', 'medium', 'low', 'none'],
};

// ============================================================================
// Error Classification
// ============================================================================

export function classifyError(error: Error): ClassifiedError {
  const message = error.message.toLowerCase();

  // Context overflow / token limit
  if (
    message.includes('context') ||
    message.includes('token') ||
    message.includes('too long') ||
    message.includes('maximum context length') ||
    message.includes('max_tokens')
  ) {
    return {
      type: 'CONTEXT_OVERFLOW',
      message: 'Context window exceeded',
      retryable: true,
      requiresProfileRotation: false,
      requiresCompaction: true,
      originalError: error,
    };
  }

  // Rate limiting
  if (
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('429') ||
    message.includes('quota')
  ) {
    return {
      type: 'RATE_LIMIT',
      message: 'Rate limit exceeded',
      retryable: true,
      requiresProfileRotation: true,
      requiresCompaction: false,
      originalError: error,
    };
  }

  // Authentication failure
  if (
    message.includes('unauthorized') ||
    message.includes('invalid api key') ||
    message.includes('401') ||
    message.includes('403') ||
    message.includes('authentication')
  ) {
    return {
      type: 'AUTH_FAILURE',
      message: 'Authentication failed',
      retryable: true,
      requiresProfileRotation: true,
      requiresCompaction: false,
      originalError: error,
    };
  }

  // Thinking level not supported
  if (
    message.includes('thinking') ||
    message.includes('reasoning') ||
    message.includes('extended thinking')
  ) {
    return {
      type: 'THINKING_LEVEL',
      message: 'Thinking level not supported',
      retryable: true,
      requiresProfileRotation: false,
      requiresCompaction: false,
      originalError: error,
    };
  }

  // Model unavailable
  if (
    message.includes('model not found') ||
    message.includes('model unavailable') ||
    message.includes('does not exist')
  ) {
    return {
      type: 'MODEL_UNAVAILABLE',
      message: 'Model not available',
      retryable: true,
      requiresProfileRotation: true,
      requiresCompaction: false,
      originalError: error,
    };
  }

  // Network errors
  if (
    message.includes('network') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('connection')
  ) {
    return {
      type: 'NETWORK_ERROR',
      message: 'Network error',
      retryable: true,
      requiresProfileRotation: false,
      requiresCompaction: false,
      originalError: error,
    };
  }

  // Timeout
  if (message.includes('timeout') || message.includes('timed out')) {
    return {
      type: 'TIMEOUT',
      message: 'Request timed out',
      retryable: true,
      requiresProfileRotation: false,
      requiresCompaction: false,
      originalError: error,
    };
  }

  // Unknown error
  return {
    type: 'UNKNOWN',
    message: error.message,
    retryable: false,
    requiresProfileRotation: false,
    requiresCompaction: false,
    originalError: error,
  };
}

// ============================================================================
// Retry Fallback Engine
// ============================================================================

export class RetryFallbackEngine extends EventEmitter {
  private profiles: Map<string, AuthProfile> = new Map();
  private config: ExecutionConfig;
  private compactionEngine: SmartCompactionEngine | null = null;
  private currentThinkingLevelIndex: number = 0;

  constructor(
    profiles: AuthProfile[],
    config: Partial<ExecutionConfig> = {}
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Sort profiles by priority (highest first)
    const sorted = [...profiles].sort((a, b) => b.priority - a.priority);
    for (const profile of sorted) {
      this.profiles.set(profile.id, {
        ...profile,
        locked: false,
        failureCount: 0,
      });
    }

    // Initialize compaction engine if auto-compact enabled
    if (this.config.autoCompact && this.config.compactionConfig) {
      this.compactionEngine = new SmartCompactionEngine(
        this.config.compactionConfig as CompactionConfig
      );
    }
  }

  /**
   * Execute a function with retry and fallback logic
   */
  async execute<T>(
    fn: (profile: AuthProfile, thinkingLevel?: string) => Promise<T>,
    options: {
      messages?: CompactionMessage[];
      onCompact?: (messages: CompactionMessage[]) => void;
    } = {}
  ): Promise<ExecutionResult<T>> {
    const startTime = Date.now();
    const attempts: ExecutionAttempt<T>[] = [];
    let messages = options.messages;

    // Get available profiles
    const availableProfiles = this.getAvailableProfiles();

    if (availableProfiles.length === 0) {
      return {
        success: false,
        attempts,
        totalDurationMs: Date.now() - startTime,
        error: 'No available auth profiles',
      };
    }

    for (const profile of availableProfiles) {
      let retryCount = 0;
      let thinkingLevelIndex = this.currentThinkingLevelIndex;

      while (retryCount < this.config.maxRetries) {
        const thinkingLevel = this.config.thinkingLevels?.[thinkingLevelIndex];
        const attemptStart = Date.now();

        const attempt: ExecutionAttempt<T> = {
          profileId: profile.id,
          attempt: retryCount + 1,
          thinkingLevel,
          startTime: attemptStart,
          success: false,
        };

        try {
          this.emit('attempt:start', { profile: profile.id, attempt: retryCount + 1, thinkingLevel });

          const result = await fn(profile, thinkingLevel);

          attempt.success = true;
          attempt.result = result;
          attempt.endTime = Date.now();
          attempts.push(attempt);

          // Mark profile as good
          this.markProfileSuccess(profile.id);

          this.emit('attempt:success', {
            profile: profile.id,
            durationMs: attempt.endTime - attemptStart,
          });

          return {
            success: true,
            result,
            attempts,
            finalProfile: profile,
            totalDurationMs: Date.now() - startTime,
          };

        } catch (error) {
          attempt.endTime = Date.now();
          const classified = classifyError(error as Error);
          attempt.error = classified;
          attempts.push(attempt);

          this.emit('attempt:error', {
            profile: profile.id,
            error: classified,
            attempt: retryCount + 1,
          });

          // Handle based on error type
          if (classified.requiresCompaction && this.compactionEngine && messages) {
            this.emit('compaction:start', { tokens: messages.length });

            const compacted = await this.compactionEngine.compact(messages);
            if (compacted.result.success) {
              messages = compacted.messages;
              if (messages) options.onCompact?.(messages);
              this.emit('compaction:complete', compacted.result);
              // Retry with compacted context
              continue;
            }
          }

          if (classified.type === 'THINKING_LEVEL') {
            // Try next thinking level
            thinkingLevelIndex++;
            if (thinkingLevelIndex < (this.config.thinkingLevels?.length || 0)) {
              this.emit('thinking:fallback', {
                from: thinkingLevel,
                to: this.config.thinkingLevels![thinkingLevelIndex],
              });
              continue;
            }
          }

          if (classified.requiresProfileRotation) {
            // Lock this profile and try next
            this.lockProfile(profile.id, classified.type === 'RATE_LIMIT');
            break;
          }

          if (classified.retryable) {
            retryCount++;
            const delay = this.calculateDelay(retryCount);
            this.emit('retry:delay', { profile: profile.id, delayMs: delay });
            await this.sleep(delay);
            continue;
          }

          // Non-retryable error
          break;
        }
      }
    }

    // All profiles exhausted
    return {
      success: false,
      attempts,
      totalDurationMs: Date.now() - startTime,
      error: 'All profiles exhausted',
    };
  }

  /**
   * Get profiles that are available (not locked or past cooldown)
   */
  private getAvailableProfiles(): AuthProfile[] {
    const now = Date.now();
    const available: AuthProfile[] = [];

    for (const profile of this.profiles.values()) {
      if (!profile.locked) {
        available.push(profile);
        continue;
      }

      // Check if cooldown has passed
      if (profile.cooldownUntil && profile.cooldownUntil <= now) {
        profile.locked = false;
        profile.cooldownUntil = undefined;
        profile.failureCount = 0;
        available.push(profile);
      }
    }

    // Sort by priority, then by failure count (fewer failures first)
    return available.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return (a.failureCount || 0) - (b.failureCount || 0);
    });
  }

  /**
   * Lock a profile after failure
   */
  private lockProfile(profileId: string, isRateLimit: boolean): void {
    const profile = this.profiles.get(profileId);
    if (!profile) return;

    profile.locked = true;
    profile.failureCount = (profile.failureCount || 0) + 1;

    if (isRateLimit) {
      profile.cooldownUntil = Date.now() + this.config.rateLimitCooldownMs;
    } else {
      // Exponential backoff for other failures
      const backoff = Math.min(
        this.config.maxDelayMs,
        this.config.baseDelayMs * Math.pow(2, profile.failureCount)
      );
      profile.cooldownUntil = Date.now() + backoff;
    }

    this.profiles.set(profileId, profile);
    this.emit('profile:locked', {
      profileId,
      until: profile.cooldownUntil,
      reason: isRateLimit ? 'rate_limit' : 'failure',
    });
  }

  /**
   * Mark a profile as successful
   */
  private markProfileSuccess(profileId: string): void {
    const profile = this.profiles.get(profileId);
    if (!profile) return;

    profile.locked = false;
    profile.cooldownUntil = undefined;
    profile.failureCount = 0;
    profile.lastSuccess = Date.now();

    this.profiles.set(profileId, profile);
    this.emit('profile:success', { profileId });
  }

  /**
   * Calculate delay with exponential backoff
   */
  private calculateDelay(attempt: number): number {
    const exponential = this.config.baseDelayMs * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 0.3 * exponential;
    return Math.min(exponential + jitter, this.config.maxDelayMs);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Add a new profile
   */
  addProfile(profile: AuthProfile): void {
    this.profiles.set(profile.id, {
      ...profile,
      locked: false,
      failureCount: 0,
    });
    this.emit('profile:added', { profileId: profile.id });
  }

  /**
   * Remove a profile
   */
  removeProfile(profileId: string): boolean {
    const removed = this.profiles.delete(profileId);
    if (removed) {
      this.emit('profile:removed', { profileId });
    }
    return removed;
  }

  /**
   * Unlock all profiles
   */
  unlockAllProfiles(): void {
    for (const profile of this.profiles.values()) {
      profile.locked = false;
      profile.cooldownUntil = undefined;
    }
    this.emit('profiles:unlocked');
  }

  /**
   * Get profile status
   */
  getProfileStatus(): Array<{
    id: string;
    name: string;
    provider: string;
    available: boolean;
    locked: boolean;
    cooldownRemaining?: number;
    failureCount: number;
  }> {
    const now = Date.now();
    return Array.from(this.profiles.values()).map(p => ({
      id: p.id,
      name: p.name,
      provider: p.provider,
      available: !p.locked || (p.cooldownUntil ? p.cooldownUntil <= now : true),
      locked: p.locked || false,
      cooldownRemaining: p.cooldownUntil ? Math.max(0, p.cooldownUntil - now) : undefined,
      failureCount: p.failureCount || 0,
    }));
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ExecutionConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// ============================================================================
// Singleton & Convenience Functions
// ============================================================================

let retryEngineInstance: RetryFallbackEngine | null = null;

export function getRetryFallbackEngine(
  profiles?: AuthProfile[],
  config?: Partial<ExecutionConfig>
): RetryFallbackEngine {
  if (!retryEngineInstance && profiles) {
    retryEngineInstance = new RetryFallbackEngine(profiles, config);
  }
  return retryEngineInstance!;
}

export function resetRetryFallbackEngine(): void {
  retryEngineInstance = null;
}

/**
 * Create a simple retry wrapper for a function
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    onRetry?: (attempt: number, error: Error) => void;
  } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1000, onRetry } = options;
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      onRetry?.(attempt, lastError);

      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError!;
}
