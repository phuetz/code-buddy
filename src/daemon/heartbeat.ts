/**
 * Heartbeat Engine
 *
 * OpenClaw-inspired periodic wake system that reads a HEARTBEAT.md checklist
 * and surfaces important items via agent review. Integrates with the existing
 * CronAgentBridge pattern to create agent instances for checklist evaluation.
 *
 * Features:
 * - Configurable interval (default 30 minutes)
 * - Active hours filtering (only fires during configured hours)
 * - Smart suppression (HEARTBEAT_OK skips with counter)
 * - Event-driven (heartbeat:wake, heartbeat:result, heartbeat:suppressed)
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface HeartbeatConfig {
  /** Interval between heartbeat checks (ms). Default: 30 minutes */
  intervalMs: number;
  /** Start of active hours (0-23). Default: 8 */
  activeHoursStart: number;
  /** End of active hours (0-23). Default: 22 */
  activeHoursEnd: number;
  /** IANA timezone string. Default: system timezone */
  timezone: string;
  /** Path to HEARTBEAT.md checklist. Default: .codebuddy/HEARTBEAT.md */
  heartbeatFilePath: string;
  /** Keyword in agent response that suppresses action. Default: HEARTBEAT_OK */
  suppressionKeyword: string;
  /** Max consecutive suppressions before forcing a full review. Default: 5 */
  maxConsecutiveSuppressions: number;
  /** Whether the heartbeat engine is enabled. Default: true */
  enabled: boolean;
  /** Optional override for agent review (used in tests). */
  agentReviewFn?: (checklistContent: string) => Promise<string>;
}

export interface HeartbeatStatus {
  running: boolean;
  enabled: boolean;
  lastRunTime: Date | null;
  nextRunTime: Date | null;
  consecutiveSuppressions: number;
  totalTicks: number;
  totalSuppressions: number;
  lastResult: string | null;
}

export interface HeartbeatTickResult {
  timestamp: Date;
  skipped: boolean;
  skipReason?: 'outside_active_hours' | 'disabled' | 'file_not_found';
  suppressed: boolean;
  agentResponse?: string;
  checklistContent?: string;
  duration: number;
}

const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  intervalMs: 30 * 60 * 1000, // 30 minutes
  activeHoursStart: 8,
  activeHoursEnd: 22,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  heartbeatFilePath: path.join(process.cwd(), '.codebuddy', 'HEARTBEAT.md'),
  suppressionKeyword: 'HEARTBEAT_OK',
  maxConsecutiveSuppressions: 5,
  enabled: true,
};

// ============================================================================
// Heartbeat Engine
// ============================================================================

export class HeartbeatEngine extends EventEmitter {
  private config: HeartbeatConfig;
  private timer: NodeJS.Timeout | null = null;
  private running: boolean = false;
  private lastRunTime: Date | null = null;
  private nextRunTime: Date | null = null;
  private consecutiveSuppressions: number = 0;
  private totalTicks: number = 0;
  private totalSuppressions: number = 0;
  private lastResult: string | null = null;

  constructor(config: Partial<HeartbeatConfig> = {}) {
    super();
    this.config = { ...DEFAULT_HEARTBEAT_CONFIG, ...config };
  }

  /**
   * Start the heartbeat engine
   */
  start(): void {
    if (this.running) {
      logger.warn('Heartbeat engine already running');
      return;
    }

    if (!this.config.enabled) {
      logger.info('Heartbeat engine is disabled');
      return;
    }

    this.running = true;
    this.scheduleNext();
    logger.info('Heartbeat engine started', {
      intervalMs: this.config.intervalMs,
      activeHours: `${this.config.activeHoursStart}-${this.config.activeHoursEnd}`,
      timezone: this.config.timezone,
    });
    this.emit('started');
  }

  /**
   * Stop the heartbeat engine
   */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.running = false;
    this.nextRunTime = null;
    logger.info('Heartbeat engine stopped');
    this.emit('stopped');
  }

  /**
   * Schedule the next tick
   */
  private scheduleNext(): void {
    if (!this.running) return;

    // Clear any existing timer to prevent orphaned timers
    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.nextRunTime = new Date(Date.now() + this.config.intervalMs);
    this.timer = setTimeout(async () => {
      try {
        await this.tick();
      } catch (error) {
        logger.error('Heartbeat tick error', { error: String(error) });
        this.emit('heartbeat:error', { error });
      }
      // Schedule next tick after completion
      this.scheduleNext();
    }, this.config.intervalMs);
  }

  /**
   * Execute a single heartbeat tick
   *
   * Reads HEARTBEAT.md, creates an agent to review the checklist,
   * and emits appropriate events based on the result.
   */
  async tick(): Promise<HeartbeatTickResult> {
    const startTime = Date.now();
    this.totalTicks++;

    // Check if enabled
    if (!this.config.enabled) {
      const result: HeartbeatTickResult = {
        timestamp: new Date(),
        skipped: true,
        skipReason: 'disabled',
        suppressed: false,
        duration: Date.now() - startTime,
      };
      logger.debug('Heartbeat tick skipped: disabled');
      return result;
    }

    // Check active hours
    if (!this.isWithinActiveHours()) {
      const result: HeartbeatTickResult = {
        timestamp: new Date(),
        skipped: true,
        skipReason: 'outside_active_hours',
        suppressed: false,
        duration: Date.now() - startTime,
      };
      logger.debug('Heartbeat tick skipped: outside active hours');
      this.emit('heartbeat:skipped', result);
      return result;
    }

    // Read the heartbeat checklist
    let checklistContent: string;
    try {
      checklistContent = await fs.readFile(this.config.heartbeatFilePath, 'utf-8');
    } catch {
      const result: HeartbeatTickResult = {
        timestamp: new Date(),
        skipped: true,
        skipReason: 'file_not_found',
        suppressed: false,
        duration: Date.now() - startTime,
      };
      logger.warn('Heartbeat file not found', { path: this.config.heartbeatFilePath });
      this.emit('heartbeat:skipped', result);
      return result;
    }

    this.lastRunTime = new Date();
    this.emit('heartbeat:wake', { timestamp: this.lastRunTime, checklistContent });

    // Create agent instance to review checklist (same pattern as CronAgentBridge)
    let agentResponse: string;
    try {
      agentResponse = await this.executeAgentReview(checklistContent);
    } catch (error) {
      logger.error('Heartbeat agent review failed', { error: String(error) });
      const result: HeartbeatTickResult = {
        timestamp: new Date(),
        skipped: false,
        suppressed: false,
        checklistContent,
        agentResponse: `Error: ${String(error)}`,
        duration: Date.now() - startTime,
      };
      this.emit('heartbeat:error', { error });
      return result;
    }

    this.lastResult = agentResponse;

    // Check for suppression keyword
    const isSuppressed = agentResponse.includes(this.config.suppressionKeyword);

    if (isSuppressed) {
      this.consecutiveSuppressions++;
      this.totalSuppressions++;

      // If max consecutive suppressions reached, force a full review next time
      if (this.consecutiveSuppressions >= this.config.maxConsecutiveSuppressions) {
        logger.info('Max consecutive suppressions reached, resetting counter', {
          count: this.consecutiveSuppressions,
        });
        this.consecutiveSuppressions = 0;
        this.emit('heartbeat:suppression-limit', {
          totalSuppressions: this.totalSuppressions,
        });
      }

      const result: HeartbeatTickResult = {
        timestamp: new Date(),
        skipped: false,
        suppressed: true,
        agentResponse,
        checklistContent,
        duration: Date.now() - startTime,
      };
      logger.debug('Heartbeat suppressed by agent', {
        consecutiveSuppressions: this.consecutiveSuppressions,
      });
      this.emit('heartbeat:suppressed', {
        consecutiveSuppressions: this.consecutiveSuppressions,
        agentResponse,
      });
      return result;
    }

    // Agent found something noteworthy - reset suppression counter
    this.consecutiveSuppressions = 0;

    const result: HeartbeatTickResult = {
      timestamp: new Date(),
      skipped: false,
      suppressed: false,
      agentResponse,
      checklistContent,
      duration: Date.now() - startTime,
    };

    this.emit('heartbeat:result', {
      agentResponse,
      checklistContent,
      duration: result.duration,
    });

    return result;
  }

  /**
   * Check if the current time is within configured active hours
   */
  isWithinActiveHours(now?: Date): boolean {
    const date = now || new Date();

    // Get the hour in the configured timezone
    let hour: number;
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hourCycle: 'h23',
        timeZone: this.config.timezone,
      });
      hour = parseInt(formatter.format(date), 10);
    } catch {
      // Fallback to local time if timezone is invalid
      hour = date.getHours();
    }

    const { activeHoursStart, activeHoursEnd } = this.config;

    // Handle wrap-around (e.g., activeHoursStart=22, activeHoursEnd=6)
    if (activeHoursStart <= activeHoursEnd) {
      return hour >= activeHoursStart && hour < activeHoursEnd;
    } else {
      return hour >= activeHoursStart || hour < activeHoursEnd;
    }
  }

  /**
   * Execute agent review of the heartbeat checklist
   *
   * Uses the same lazy-load agent pattern as CronAgentBridge.
   */
  private async executeAgentReview(checklistContent: string): Promise<string> {
    // Allow override for testing
    if (this.config.agentReviewFn) {
      return this.config.agentReviewFn(checklistContent);
    }

    const apiKey = process.env.GROK_API_KEY || '';
    const baseURL = process.env.GROK_BASE_URL;
    const model = process.env.GROK_MODEL;

    const forceReview = this.consecutiveSuppressions >= this.config.maxConsecutiveSuppressions - 1;
    const suppressionContext = forceReview
      ? `\n\nIMPORTANT: There have been ${this.consecutiveSuppressions} consecutive suppressions. Please do a thorough review even if everything looks fine.`
      : '';

    const prompt = [
      'You are a heartbeat monitor reviewing a project checklist.',
      'Review the following HEARTBEAT.md checklist and determine if any items need attention.',
      '',
      `If everything looks fine, respond with exactly: ${this.config.suppressionKeyword}`,
      'If any items need attention, describe what needs to be done.',
      suppressionContext,
      '',
      '---',
      checklistContent,
    ].join('\n');

    // Lazy load agent to avoid circular deps
    const { CodeBuddyAgent } = await import('../agent/codebuddy-agent.js');
    const agent = new CodeBuddyAgent(
      apiKey,
      baseURL,
      model,
      10, // limited tool rounds for heartbeat review
      false // no RAG for heartbeat
    );

    const entries = await agent.processUserMessage(prompt);
    const assistantEntries = entries.filter(e => e.type === 'assistant');
    return assistantEntries.map(e => e.content).join('\n') || 'No response';
  }

  /**
   * Get current heartbeat engine status
   */
  getStatus(): HeartbeatStatus {
    return {
      running: this.running,
      enabled: this.config.enabled,
      lastRunTime: this.lastRunTime,
      nextRunTime: this.nextRunTime,
      consecutiveSuppressions: this.consecutiveSuppressions,
      totalTicks: this.totalTicks,
      totalSuppressions: this.totalSuppressions,
      lastResult: this.lastResult,
    };
  }

  /**
   * Get the current configuration (copy)
   */
  getConfig(): HeartbeatConfig {
    return { ...this.config };
  }

  /**
   * Update configuration (requires restart to take effect for interval changes)
   */
  updateConfig(updates: Partial<HeartbeatConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.info('Heartbeat config updated', { updates: Object.keys(updates) });
  }

  /**
   * Check if the engine is currently running
   */
  isRunning(): boolean {
    return this.running;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let heartbeatInstance: HeartbeatEngine | null = null;

export function getHeartbeatEngine(config?: Partial<HeartbeatConfig>): HeartbeatEngine {
  if (!heartbeatInstance) {
    heartbeatInstance = new HeartbeatEngine(config);
  }
  return heartbeatInstance;
}

export function resetHeartbeatEngine(): void {
  if (heartbeatInstance) {
    heartbeatInstance.stop();
  }
  heartbeatInstance = null;
}
