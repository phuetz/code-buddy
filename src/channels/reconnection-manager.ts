/**
 * Reconnection Manager
 *
 * A shared reconnection utility with exponential backoff for channel adapters.
 * Provides consistent reconnection behavior across all channel implementations.
 *
 * Features:
 * - Exponential backoff with configurable multiplier
 * - Random jitter to prevent thundering herd
 * - Maximum retry limit with exhaustion detection
 * - Event-based notification of state changes
 * - Cancellation support for pending reconnections
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for reconnection behavior
 */
export interface ReconnectionConfig {
  /** Maximum number of retry attempts before giving up (default: 10) */
  maxRetries: number;
  /** Initial delay in milliseconds before the first retry (default: 1000) */
  initialDelayMs: number;
  /** Maximum delay in milliseconds between retries (default: 60000) */
  maxDelayMs: number;
  /** Multiplier applied to delay after each retry (default: 2) */
  backoffMultiplier: number;
  /** Random jitter in milliseconds added to delay (default: 500) */
  jitterMs: number;
}

/**
 * Events emitted by the ReconnectionManager
 */
export interface ReconnectionEvents {
  /** Emitted when a reconnection attempt is about to start */
  reconnecting: (attempt: number, delayMs: number) => void;
  /** Emitted when a reconnection attempt succeeds */
  reconnected: (attempt: number) => void;
  /** Emitted when all retry attempts are exhausted */
  exhausted: (totalAttempts: number) => void;
  /** Emitted when a reconnection attempt fails */
  error: (error: Error, attempt: number) => void;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: ReconnectionConfig = {
  maxRetries: 10,
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  jitterMs: 500,
};

// ============================================================================
// Implementation
// ============================================================================

/**
 * Manages reconnection attempts with exponential backoff for a named channel.
 *
 * Usage:
 * ```typescript
 * const reconnector = new ReconnectionManager('discord');
 *
 * // On connection loss
 * reconnector.scheduleReconnect(async () => {
 *   await channel.connect();
 * });
 *
 * // On successful connection
 * reconnector.onConnected();
 *
 * // On shutdown
 * reconnector.cancel();
 * ```
 */
export class ReconnectionManager extends EventEmitter {
  private readonly config: ReconnectionConfig;
  private retryCount = 0;
  private pendingTimer: NodeJS.Timeout | null = null;
  private active = false;

  constructor(
    private readonly name: string,
    config?: Partial<ReconnectionConfig>,
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Schedule a reconnection attempt.
   *
   * Calculates the appropriate delay using exponential backoff with jitter
   * and schedules the provided connect function. If max retries have been
   * exceeded, emits the 'exhausted' event instead.
   *
   * @param connectFn - Async function that performs the connection attempt
   */
  scheduleReconnect(connectFn: () => Promise<void>): void {
    // Prevent concurrent reconnection schedules
    if (this.active) return;

    if (this.isExhausted()) {
      logger.debug(`${this.name}: reconnection exhausted after ${this.retryCount} attempts`);
      this.emit('exhausted', this.retryCount);
      return;
    }

    this.retryCount++;
    const delay = this.getCurrentDelay();
    this.active = true;

    logger.debug(`${this.name}: scheduling reconnect attempt ${this.retryCount}/${this.config.maxRetries} in ${delay}ms`);
    this.emit('reconnecting', this.retryCount, delay);

    this.pendingTimer = setTimeout(async () => {
      this.pendingTimer = null;
      try {
        await connectFn();
        // If connectFn succeeds without throwing, emit reconnected
        this.emit('reconnected', this.retryCount);
        // Note: caller should call onConnected() to reset the state
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.debug(`${this.name}: reconnect attempt ${this.retryCount} failed`, {
          error: error.message,
        });
        this.emit('error', error, this.retryCount);
      } finally {
        this.active = false;
      }
    }, delay);
  }

  /**
   * Reset retry counter on successful connection.
   *
   * Call this when the channel has successfully connected
   * (whether from an initial connect or a reconnection attempt).
   */
  onConnected(): void {
    this.retryCount = 0;
    this.active = false;
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  /**
   * Check if maximum retries have been exceeded.
   */
  isExhausted(): boolean {
    return this.retryCount >= this.config.maxRetries;
  }

  /**
   * Get current retry count.
   */
  getRetryCount(): number {
    return this.retryCount;
  }

  /**
   * Cancel any pending reconnection attempt.
   */
  cancel(): void {
    this.active = false;
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  /**
   * Get the delay for the next retry attempt.
   *
   * Uses exponential backoff: initialDelay * multiplier^(retryCount-1)
   * Capped at maxDelayMs. Adds random jitter.
   */
  getCurrentDelay(): number {
    const exponentialDelay =
      this.config.initialDelayMs *
      Math.pow(this.config.backoffMultiplier, Math.max(0, this.retryCount - 1));

    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelayMs);

    // Add random jitter: [0, jitterMs)
    const jitter = Math.floor(Math.random() * this.config.jitterMs);

    return cappedDelay + jitter;
  }

  /**
   * Check if a reconnection is currently pending.
   */
  isPending(): boolean {
    return this.active || this.pendingTimer !== null;
  }

  /**
   * Get the channel name this manager is for.
   */
  getName(): string {
    return this.name;
  }

  /**
   * Get the current configuration.
   */
  getConfig(): Readonly<ReconnectionConfig> {
    return { ...this.config };
  }
}
