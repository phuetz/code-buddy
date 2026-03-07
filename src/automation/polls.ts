/**
 * Polls Automation
 *
 * Periodic polling system for external data sources.
 * Inspired by OpenClaw's automation/polls feature.
 *
 * Supports polling URLs, files, commands, and custom functions
 * at configurable intervals with change detection.
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export type PollType = 'url' | 'file' | 'command' | 'custom';

export interface PollConfig {
  id: string;
  name: string;
  type: PollType;
  target: string;
  intervalMs: number;
  enabled: boolean;
  onChangeOnly?: boolean;
  headers?: Record<string, string>;
  transform?: string;
  maxRetries?: number;
}

export interface PollResult {
  pollId: string;
  data: unknown;
  previousData: unknown;
  changed: boolean;
  timestamp: Date;
  durationMs: number;
  error?: string;
}

// ============================================================================
// Poll Manager
// ============================================================================

export class PollManager extends EventEmitter {
  private static instance: PollManager | null = null;
  private polls: Map<string, PollConfig> = new Map();
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private lastResults: Map<string, unknown> = new Map();
  private retryCount: Map<string, number> = new Map();

  static getInstance(): PollManager {
    if (!PollManager.instance) {
      PollManager.instance = new PollManager();
    }
    return PollManager.instance;
  }

  static resetInstance(): void {
    if (PollManager.instance) {
      PollManager.instance.stopAll();
    }
    PollManager.instance = null;
  }

  addPoll(config: PollConfig): void {
    if (this.polls.has(config.id)) {
      this.removePoll(config.id);
    }
    this.polls.set(config.id, config);
    if (config.enabled) {
      this.startPoll(config.id);
    }
    logger.debug(`Poll added: ${config.name} (${config.type}: ${config.target})`);
  }

  removePoll(id: string): boolean {
    this.stopPoll(id);
    const removed = this.polls.delete(id);
    this.lastResults.delete(id);
    this.retryCount.delete(id);
    return removed;
  }

  startPoll(id: string): void {
    const config = this.polls.get(id);
    if (!config) throw new Error(`Poll not found: ${id}`);

    this.stopPoll(id);
    config.enabled = true;

    // Execute immediately, then at interval
    this.executePoll(id);
    const timer = setInterval(() => this.executePoll(id), config.intervalMs);
    this.timers.set(id, timer);
    logger.debug(`Poll started: ${config.name} (every ${config.intervalMs}ms)`);
  }

  stopPoll(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(id);
    }
    const config = this.polls.get(id);
    if (config) config.enabled = false;
  }

  stopAll(): void {
    for (const id of this.timers.keys()) {
      this.stopPoll(id);
    }
  }

  listPolls(): PollConfig[] {
    return Array.from(this.polls.values());
  }

  getPoll(id: string): PollConfig | undefined {
    return this.polls.get(id);
  }

  getLastResult(id: string): unknown {
    return this.lastResults.get(id);
  }

  private async executePoll(id: string): Promise<void> {
    const config = this.polls.get(id);
    if (!config) return;

    const start = Date.now();
    let data: unknown;
    let error: string | undefined;

    try {
      switch (config.type) {
        case 'url':
          data = await this.pollUrl(config);
          break;
        case 'file':
          data = await this.pollFile(config);
          break;
        case 'command':
          data = await this.pollCommand(config);
          break;
        case 'custom':
          data = { type: 'custom', target: config.target };
          break;
      }
      this.retryCount.set(id, 0);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      const retries = (this.retryCount.get(id) || 0) + 1;
      this.retryCount.set(id, retries);

      if (retries >= (config.maxRetries || 3)) {
        logger.warn(`Poll ${config.name} failed ${retries} times, stopping`);
        this.stopPoll(id);
        this.emit('poll:failed', { pollId: id, error, retries });
        return;
      }
    }

    const previousData = this.lastResults.get(id);
    const changed = JSON.stringify(data) !== JSON.stringify(previousData);

    if (data !== undefined) {
      this.lastResults.set(id, data);
    }

    const result: PollResult = {
      pollId: id,
      data,
      previousData,
      changed,
      timestamp: new Date(),
      durationMs: Date.now() - start,
      error,
    };

    if (!config.onChangeOnly || changed) {
      this.emit('poll:result', result);
    }

    if (changed) {
      this.emit('poll:changed', result);
    }
  }

  private async pollUrl(config: PollConfig): Promise<unknown> {
    const response = await fetch(config.target, {
      headers: config.headers,
      signal: AbortSignal.timeout(10_000),
    });
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('json')) {
      return response.json();
    }
    return response.text();
  }

  private async pollFile(config: PollConfig): Promise<unknown> {
    const { readFile, stat } = await import('fs/promises');
    const fileStat = await stat(config.target);
    const content = await readFile(config.target, 'utf8');
    return { content, size: fileStat.size, mtime: fileStat.mtime.toISOString() };
  }

  private async pollCommand(config: PollConfig): Promise<unknown> {
    const { execSync } = await import('child_process');
    const output = execSync(config.target, { encoding: 'utf8', timeout: 10_000 });
    return output.trim();
  }
}
