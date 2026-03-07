/**
 * Auth Monitoring Automation
 *
 * Monitors authentication state across providers and channels.
 * Detects token expiration, auth failures, and credential issues.
 * Inspired by OpenClaw's automation/auth-monitoring.
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export type AuthState = 'valid' | 'expiring' | 'expired' | 'invalid' | 'unknown';

export interface AuthTarget {
  id: string;
  name: string;
  type: 'provider' | 'channel' | 'service';
  envVar?: string;
  expiresAt?: Date;
  lastChecked?: Date;
  state: AuthState;
  error?: string;
}

export interface AuthMonitorConfig {
  checkIntervalMs: number;
  expiryWarningMs: number;
  autoRefresh: boolean;
}

export interface AuthEvent {
  target: AuthTarget;
  previousState: AuthState;
  newState: AuthState;
  timestamp: Date;
  message: string;
}

// ============================================================================
// Auth Monitor
// ============================================================================

export class AuthMonitor extends EventEmitter {
  private static instance: AuthMonitor | null = null;
  private targets: Map<string, AuthTarget> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;
  private config: AuthMonitorConfig;
  private history: AuthEvent[] = [];

  constructor(config?: Partial<AuthMonitorConfig>) {
    super();
    this.config = {
      checkIntervalMs: config?.checkIntervalMs ?? 300_000, // 5 minutes
      expiryWarningMs: config?.expiryWarningMs ?? 86_400_000, // 24 hours
      autoRefresh: config?.autoRefresh ?? false,
    };
  }

  static getInstance(config?: Partial<AuthMonitorConfig>): AuthMonitor {
    if (!AuthMonitor.instance) {
      AuthMonitor.instance = new AuthMonitor(config);
    }
    return AuthMonitor.instance;
  }

  static resetInstance(): void {
    if (AuthMonitor.instance) {
      AuthMonitor.instance.stop();
    }
    AuthMonitor.instance = null;
  }

  // --------------------------------------------------------------------------
  // Target Management
  // --------------------------------------------------------------------------

  addTarget(target: AuthTarget): void {
    this.targets.set(target.id, target);
    logger.debug(`Auth monitor: added ${target.name} (${target.type})`);
  }

  removeTarget(id: string): boolean {
    return this.targets.delete(id);
  }

  getTarget(id: string): AuthTarget | undefined {
    return this.targets.get(id);
  }

  listTargets(): AuthTarget[] {
    return Array.from(this.targets.values());
  }

  // --------------------------------------------------------------------------
  // Monitoring
  // --------------------------------------------------------------------------

  start(): void {
    if (this.timer) return;
    this.registerDefaultTargets();
    this.checkAll();
    this.timer = setInterval(() => this.checkAll(), this.config.checkIntervalMs);
    logger.info('Auth monitoring started');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async checkAll(): Promise<AuthEvent[]> {
    const events: AuthEvent[] = [];
    for (const target of this.targets.values()) {
      const event = await this.checkTarget(target);
      if (event) {
        events.push(event);
        this.history.push(event);
        this.emit('auth:changed', event);
      }
      target.lastChecked = new Date();
    }

    // Trim history
    if (this.history.length > 1000) {
      this.history = this.history.slice(-500);
    }

    return events;
  }

  private async checkTarget(target: AuthTarget): Promise<AuthEvent | null> {
    const previousState = target.state;
    let newState: AuthState = 'unknown';

    // Check env var presence
    if (target.envVar) {
      const value = process.env[target.envVar];
      if (!value) {
        newState = 'invalid';
      } else if (value.length < 10) {
        newState = 'invalid';
      } else {
        newState = 'valid';
      }
    }

    // Check expiry
    if (target.expiresAt) {
      const now = Date.now();
      const expiresAt = target.expiresAt.getTime();
      if (now >= expiresAt) {
        newState = 'expired';
      } else if (expiresAt - now < this.config.expiryWarningMs) {
        newState = 'expiring';
      }
    }

    target.state = newState;

    if (newState !== previousState) {
      const message = newState === 'expired'
        ? `${target.name} credentials have expired`
        : newState === 'expiring'
        ? `${target.name} credentials expiring soon`
        : newState === 'invalid'
        ? `${target.name} credentials missing or invalid`
        : `${target.name} credentials are valid`;

      return {
        target: { ...target },
        previousState,
        newState,
        timestamp: new Date(),
        message,
      };
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Default Targets
  // --------------------------------------------------------------------------

  private registerDefaultTargets(): void {
    const defaults: Omit<AuthTarget, 'state' | 'lastChecked'>[] = [
      { id: 'grok', name: 'Grok API', type: 'provider', envVar: 'GROK_API_KEY' },
      { id: 'openai', name: 'OpenAI API', type: 'provider', envVar: 'OPENAI_API_KEY' },
      { id: 'anthropic', name: 'Anthropic API', type: 'provider', envVar: 'ANTHROPIC_API_KEY' },
      { id: 'gemini', name: 'Gemini API', type: 'provider', envVar: 'GEMINI_API_KEY' },
      { id: 'openrouter', name: 'OpenRouter', type: 'provider', envVar: 'OPENROUTER_API_KEY' },
      { id: 'discord', name: 'Discord Bot', type: 'channel', envVar: 'DISCORD_BOT_TOKEN' },
      { id: 'slack', name: 'Slack Bot', type: 'channel', envVar: 'SLACK_BOT_TOKEN' },
      { id: 'telegram', name: 'Telegram Bot', type: 'channel', envVar: 'TELEGRAM_BOT_TOKEN' },
      { id: 'brave', name: 'Brave Search', type: 'service', envVar: 'BRAVE_API_KEY' },
      { id: 'sentry', name: 'Sentry', type: 'service', envVar: 'SENTRY_DSN' },
    ];

    for (const def of defaults) {
      if (!this.targets.has(def.id)) {
        this.addTarget({ ...def, state: 'unknown' });
      }
    }
  }

  // --------------------------------------------------------------------------
  // History & Reporting
  // --------------------------------------------------------------------------

  getHistory(limit?: number): AuthEvent[] {
    const events = [...this.history].reverse();
    return limit ? events.slice(0, limit) : events;
  }

  getSummary(): { total: number; valid: number; invalid: number; expiring: number; expired: number } {
    const targets = this.listTargets();
    return {
      total: targets.length,
      valid: targets.filter(t => t.state === 'valid').length,
      invalid: targets.filter(t => t.state === 'invalid').length,
      expiring: targets.filter(t => t.state === 'expiring').length,
      expired: targets.filter(t => t.state === 'expired').length,
    };
  }
}
