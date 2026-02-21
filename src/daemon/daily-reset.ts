/**
 * Daily Session Reset — OpenClaw-inspired context boundary
 *
 * Automatically resets the conversation context at a configurable time
 * each day (default: 04:00 local time). This prevents unbounded context
 * growth in long-running daemon sessions and mirrors the daily boundary
 * reset pattern in OpenClaw.
 *
 * What is reset:
 * - In-memory conversation history (messages array)
 * - Cached tool selection results
 *
 * What is PRESERVED:
 * - MEMORY.md (durable facts)
 * - HEARTBEAT.md (task checklist)
 * - Session metadata (model, cost counters)
 * - All files on disk (todo.md, PLAN.md, etc.)
 *
 * After reset the agent posts a summary message noting the daily boundary
 * so the conversation log remains intelligible.
 *
 * Ref: OpenClaw session management compaction docs
 * https://docs.openclaw.ai/reference/session-management-compaction
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface DailyResetConfig {
  /** Hour of the day for the reset (0-23). Default: 4 */
  resetHour: number;
  /** Minute of the reset (0-59). Default: 0 */
  resetMinute: number;
  /** IANA timezone identifier. Default: system local */
  timezone?: string;
  /** Whether the daily reset is enabled. Default: true */
  enabled: boolean;
  /** Post a summary message after reset. Default: true */
  postSummary: boolean;
}

export interface ResetResult {
  triggeredAt: Date;
  /** Number of messages cleared */
  messagesCleared: number;
  /** Summary message posted to conversation (or null if postSummary is false) */
  summaryMessage: string | null;
}

// ============================================================================
// DailyResetManager
// ============================================================================

export class DailyResetManager extends EventEmitter {
  private config: DailyResetConfig;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastResetDate: string | null = null; // 'YYYY-MM-DD'

  constructor(config: Partial<DailyResetConfig> = {}) {
    super();
    this.config = {
      resetHour: config.resetHour ?? 4,
      resetMinute: config.resetMinute ?? 0,
      timezone: config.timezone,
      enabled: config.enabled ?? true,
      postSummary: config.postSummary ?? true,
    };
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Start the daily reset scheduler.
   * Call this once when the daemon starts.
   */
  start(): void {
    if (!this.config.enabled) return;
    this.scheduleNext();
    logger.debug('DailyResetManager started', {
      resetHour: this.config.resetHour,
      resetMinute: this.config.resetMinute,
    });
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  // --------------------------------------------------------------------------
  // Scheduling
  // --------------------------------------------------------------------------

  /** Returns milliseconds until the next reset window. */
  msUntilNextReset(): number {
    const now = new Date();
    const next = new Date(now);
    next.setHours(this.config.resetHour, this.config.resetMinute, 0, 0);

    if (next <= now) {
      // Already past today's reset time — schedule for tomorrow
      next.setDate(next.getDate() + 1);
    }

    return next.getTime() - now.getTime();
  }

  private scheduleNext(): void {
    const ms = this.msUntilNextReset();
    logger.debug('DailyResetManager: next reset in', {
      minutes: Math.round(ms / 60_000),
    });

    this.timer = setTimeout(() => {
      this.runReset([]).catch(err => {
        logger.error('DailyResetManager: reset failed', { err });
      });
      this.scheduleNext(); // reschedule for tomorrow
    }, ms);

    // Allow Node to exit if this is the only pending timer
    if (this.timer.unref) this.timer.unref();
  }

  // --------------------------------------------------------------------------
  // Reset logic
  // --------------------------------------------------------------------------

  /**
   * Perform the daily reset on the provided messages array (modified in-place).
   *
   * @param messages - The agent's LLM messages array to clear
   * @param systemMessage - Optional system message to keep at position [0]
   */
  async runReset(
    messages: Array<{ role: string; content: string | null }>,
    systemMessage?: { role: string; content: string }
  ): Promise<ResetResult> {
    const today = new Date().toISOString().split('T')[0];

    // Avoid duplicate resets on the same day
    if (this.lastResetDate === today) {
      return {
        triggeredAt: new Date(),
        messagesCleared: 0,
        summaryMessage: null,
      };
    }
    this.lastResetDate = today;

    const messagesCleared = messages.length;

    // Clear messages (in-place)
    messages.splice(0, messages.length);

    // Re-inject system message if provided
    if (systemMessage) {
      messages.push(systemMessage);
    }

    const summaryMessage = this.config.postSummary
      ? this.buildSummaryMessage(today, messagesCleared)
      : null;

    if (summaryMessage && messages.length > 0) {
      // Append the summary as an assistant message so it appears in the log
      messages.push({ role: 'assistant', content: summaryMessage });
    }

    const result: ResetResult = {
      triggeredAt: new Date(),
      messagesCleared,
      summaryMessage,
    };

    this.emit('reset', result);
    logger.info('DailyResetManager: daily reset completed', {
      date: today,
      messagesCleared,
    });

    return result;
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private buildSummaryMessage(date: string, cleared: number): string {
    return [
      `---`,
      `**[Daily context boundary — ${date}]**`,
      `Conversation history was automatically cleared at ${String(this.config.resetHour).padStart(2, '0')}:${String(this.config.resetMinute).padStart(2, '0')} to maintain a fresh context window.`,
      `${cleared} messages from the previous session were cleared.`,
      `MEMORY.md, HEARTBEAT.md, todo.md, and all project files are preserved.`,
      `---`,
    ].join('\n');
  }

  getConfig(): Readonly<DailyResetConfig> {
    return { ...this.config };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: DailyResetManager | null = null;

export function getDailyResetManager(config?: Partial<DailyResetConfig>): DailyResetManager {
  if (!_instance) {
    _instance = new DailyResetManager(config);
  }
  return _instance;
}

export function resetDailyResetManager(): void {
  _instance?.stop();
  _instance = null;
}
