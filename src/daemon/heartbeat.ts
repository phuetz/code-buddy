/**
 * Heartbeat Engine
 *
 * Periodic wake that reads HEARTBEAT.md and surfaces items via agent review.
 * Local `.codebuddy/HEARTBEAT.md` is merged with an OpenClaw workspace file
 * when `CODEBUDDY_OPENCLAW_WORKSPACE_IMPORT=true`.
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { mergeHeartbeatChecklists, readHeartbeatSources } from './heartbeat-sources.js';

export interface HeartbeatConfig {
  intervalMs: number;
  activeHoursStart: number;
  activeHoursEnd: number;
  timezone: string;
  heartbeatFilePath: string;
  suppressionKeyword: string;
  maxConsecutiveSuppressions: number;
  enabled: boolean;
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
  intervalMs: 30 * 60 * 1000,
  activeHoursStart: 8,
  activeHoursEnd: 22,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  heartbeatFilePath: path.join(process.cwd(), '.codebuddy', 'HEARTBEAT.md'),
  suppressionKeyword: 'HEARTBEAT_OK',
  maxConsecutiveSuppressions: 5,
  enabled: true,
};

export class HeartbeatEngine extends EventEmitter {
  private config: HeartbeatConfig;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastRunTime: Date | null = null;
  private nextRunTime: Date | null = null;
  private consecutiveSuppressions = 0;
  private totalTicks = 0;
  private totalSuppressions = 0;
  private lastResult: string | null = null;

  constructor(config: Partial<HeartbeatConfig> = {}) {
    super();
    this.config = { ...DEFAULT_HEARTBEAT_CONFIG, ...config };
  }

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

  private scheduleNext(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.nextRunTime = new Date(Date.now() + this.config.intervalMs);
    this.timer = setTimeout(async () => {
      try {
        await this.tick();
      } catch (error) {
        logger.error('Heartbeat tick error', { error: String(error) });
        this.emit('heartbeat:error', { error });
      }
      this.scheduleNext();
    }, this.config.intervalMs);
  }

  async tick(): Promise<HeartbeatTickResult> {
    const startTime = Date.now();
    this.totalTicks++;

    if (!this.config.enabled) {
      return {
        timestamp: new Date(),
        skipped: true,
        skipReason: 'disabled',
        suppressed: false,
        duration: Date.now() - startTime,
      };
    }

    if (!this.isWithinActiveHours()) {
      const result: HeartbeatTickResult = {
        timestamp: new Date(),
        skipped: true,
        skipReason: 'outside_active_hours',
        suppressed: false,
        duration: Date.now() - startTime,
      };
      this.emit('heartbeat:skipped', result);
      return result;
    }

    const sources = await readHeartbeatSources({
      localPath: this.config.heartbeatFilePath,
    });
    const checklistContent = mergeHeartbeatChecklists(sources);
    if (!checklistContent.trim()) {
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

    let agentResponse: string;
    try {
      agentResponse = await this.executeAgentReview(checklistContent);
    } catch (error) {
      logger.error('Heartbeat agent review failed', { error: String(error) });
      return {
        timestamp: new Date(),
        skipped: false,
        suppressed: false,
        checklistContent,
        agentResponse: `Error: ${String(error)}`,
        duration: Date.now() - startTime,
      };
    }

    this.lastResult = agentResponse;
    const isSuppressed = agentResponse.includes(this.config.suppressionKeyword);

    if (isSuppressed) {
      this.consecutiveSuppressions++;
      this.totalSuppressions++;
      if (this.consecutiveSuppressions >= this.config.maxConsecutiveSuppressions) {
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
      this.emit('heartbeat:suppressed', {
        consecutiveSuppressions: this.consecutiveSuppressions,
        agentResponse,
      });
      return result;
    }

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
    void this.deliverCompanionImpulse();
    return result;
  }

  private async deliverCompanionImpulse(): Promise<void> {
    try {
      const { runImpulseDeliveryTick } = await import('../companion/impulse-delivery.js');
      await runImpulseDeliveryTick();
    } catch {
      /* companion delivery is optional on a code-heartbeat tick */
    }
  }

  isWithinActiveHours(now?: Date): boolean {
    const date = now || new Date();
    let hour: number;
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hourCycle: 'h23',
        timeZone: this.config.timezone,
      });
      hour = parseInt(formatter.format(date), 10);
    } catch {
      hour = date.getHours();
    }
    const { activeHoursStart, activeHoursEnd } = this.config;
    if (activeHoursStart <= activeHoursEnd) {
      return hour >= activeHoursStart && hour < activeHoursEnd;
    }
    return hour >= activeHoursStart || hour < activeHoursEnd;
  }

  private async executeAgentReview(checklistContent: string): Promise<string> {
    if (this.config.agentReviewFn) {
      return this.config.agentReviewFn(checklistContent);
    }

    const apiKey = process.env.GROK_API_KEY || '';
    const baseURL = process.env.GROK_BASE_URL;
    const model = process.env.GROK_MODEL;
    const forceReview =
      this.consecutiveSuppressions >= this.config.maxConsecutiveSuppressions - 1;
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

    const { CodeBuddyAgent } = await import('../agent/codebuddy-agent.js');
    const agent = new CodeBuddyAgent(apiKey, baseURL, model, 10, false);
    const entries = await agent.processUserMessage(prompt);
    const assistantEntries = entries.filter((e) => e.type === 'assistant');
    return assistantEntries.map((e) => e.content).join('\n') || 'No response';
  }

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

  getConfig(): HeartbeatConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<HeartbeatConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  isRunning(): boolean {
    return this.running;
  }
}

let heartbeatInstance: HeartbeatEngine | null = null;

export function getHeartbeatEngine(config?: Partial<HeartbeatConfig>): HeartbeatEngine {
  if (!heartbeatInstance) {
    heartbeatInstance = new HeartbeatEngine(config);
  }
  return heartbeatInstance;
}

export function resetHeartbeatEngine(): void {
  if (heartbeatInstance) heartbeatInstance.stop();
  heartbeatInstance = null;
}
