/**
 * Sentry Error Tracking Integration
 *
 * Production error tracking and monitoring:
 * - Automatic error capture
 * - Performance monitoring
 * - Release tracking
 * - User context
 */

import { EventEmitter } from 'events';
import * as os from 'os';
import { logger } from '../utils/logger';

export interface SentryConfig {
  /** Sentry DSN */
  dsn: string;
  /** Environment name */
  environment?: string;
  /** Release version */
  release?: string;
  /** Sample rate for errors (0-1) */
  sampleRate?: number;
  /** Sample rate for performance (0-1) */
  tracesSampleRate?: number;
  /** Enable debug mode */
  debug?: boolean;
  /** Tags to add to all events */
  tags?: Record<string, string>;
  /** User information */
  user?: SentryUser;
  /** Before send hook */
  beforeSend?: (event: SentryEvent) => SentryEvent | null;
}

export interface SentryUser {
  id?: string;
  email?: string;
  username?: string;
  ip_address?: string;
}

export interface SentryEvent {
  event_id: string;
  timestamp: string;
  platform: string;
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  message?: string;
  exception?: {
    values: Array<{
      type: string;
      value: string;
      stacktrace?: {
        frames: Array<{
          filename: string;
          function: string;
          lineno?: number;
          colno?: number;
          in_app: boolean;
        }>;
      };
    }>;
  };
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: SentryUser;
  contexts?: {
    os?: { name: string; version: string };
    runtime?: { name: string; version: string };
    app?: { app_name: string; app_version: string };
  };
  release?: string;
  environment?: string;
  server_name?: string;
  transaction?: string;
}

export interface SentryBreadcrumb {
  timestamp: number;
  category: string;
  message: string;
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  data?: Record<string, unknown>;
}

export interface SentryTransaction {
  name: string;
  op: string;
  startTimestamp: number;
  endTimestamp?: number;
  status?: 'ok' | 'cancelled' | 'unknown' | 'aborted' | 'internal_error';
  spans: SentrySpan[];
}

export interface SentrySpan {
  spanId: string;
  parentSpanId?: string;
  op: string;
  description: string;
  startTimestamp: number;
  endTimestamp?: number;
  status?: string;
  data?: Record<string, unknown>;
}

/**
 * Sentry Integration for Code Buddy
 */
export class SentryIntegration extends EventEmitter {
  private config: Required<SentryConfig>;
  private initialized: boolean = false;
  private breadcrumbs: SentryBreadcrumb[] = [];
  private maxBreadcrumbs: number = 100;
  private transactions: Map<string, SentryTransaction> = new Map();
  private eventQueue: SentryEvent[] = [];
  private flushInterval: NodeJS.Timeout | null = null;

  constructor(config: SentryConfig) {
    super();
    this.config = {
      dsn: config.dsn,
      environment: config.environment || process.env.NODE_ENV || 'development',
      release: config.release || process.env.npm_package_version || '0.0.0',
      sampleRate: config.sampleRate ?? 1.0,
      tracesSampleRate: config.tracesSampleRate ?? 0.1,
      debug: config.debug ?? false,
      tags: config.tags || {},
      user: config.user || {},
      beforeSend: config.beforeSend || ((e) => e),
    };
  }

  /**
   * Initialize Sentry integration
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    if (!this.config.dsn) {
      logger.warn('Sentry DSN not configured, error tracking disabled');
      return;
    }

    // Set up global error handlers
    process.on('uncaughtException', (error) => {
      this.captureException(error, { level: 'fatal' });
    });

    process.on('unhandledRejection', (reason) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      this.captureException(error, { level: 'error' });
    });

    // Start flush interval
    this.flushInterval = setInterval(() => {
      this.flush().catch(() => {});
    }, 10000);

    this.initialized = true;
    this.emit('initialized');

    if (this.config.debug) {
      logger.info('Sentry initialized', { environment: this.config.environment });
    }
  }

  /**
   * Capture an exception
   */
  captureException(
    error: Error,
    options?: { level?: SentryEvent['level']; tags?: Record<string, string>; extra?: Record<string, unknown> }
  ): string {
    // Sample rate check
    if (Math.random() > this.config.sampleRate) {
      return '';
    }

    const eventId = this.generateEventId();
    const event: SentryEvent = {
      event_id: eventId,
      timestamp: new Date().toISOString(),
      platform: 'node',
      level: options?.level || 'error',
      exception: {
        values: [{
          type: error.name,
          value: error.message,
          stacktrace: this.parseStackTrace(error.stack),
        }],
      },
      tags: { ...this.config.tags, ...options?.tags },
      extra: options?.extra,
      user: this.config.user,
      contexts: this.getContexts(),
      release: this.config.release,
      environment: this.config.environment,
      server_name: os.hostname(),
    };

    // Apply beforeSend hook
    const processedEvent = this.config.beforeSend(event);
    if (processedEvent) {
      this.eventQueue.push(processedEvent);
      this.emit('exception', { eventId, error });
    }

    return eventId;
  }

  /**
   * Capture a message
   */
  captureMessage(
    message: string,
    level: SentryEvent['level'] = 'info',
    options?: { tags?: Record<string, string>; extra?: Record<string, unknown> }
  ): string {
    // Sample rate check
    if (Math.random() > this.config.sampleRate) {
      return '';
    }

    const eventId = this.generateEventId();
    const event: SentryEvent = {
      event_id: eventId,
      timestamp: new Date().toISOString(),
      platform: 'node',
      level,
      message,
      tags: { ...this.config.tags, ...options?.tags },
      extra: options?.extra,
      user: this.config.user,
      contexts: this.getContexts(),
      release: this.config.release,
      environment: this.config.environment,
      server_name: os.hostname(),
    };

    const processedEvent = this.config.beforeSend(event);
    if (processedEvent) {
      this.eventQueue.push(processedEvent);
      this.emit('message', { eventId, message, level });
    }

    return eventId;
  }

  /**
   * Add a breadcrumb
   */
  addBreadcrumb(breadcrumb: Omit<SentryBreadcrumb, 'timestamp'>): void {
    this.breadcrumbs.push({
      ...breadcrumb,
      timestamp: Date.now() / 1000,
    });

    // Keep only the last N breadcrumbs
    if (this.breadcrumbs.length > this.maxBreadcrumbs) {
      this.breadcrumbs = this.breadcrumbs.slice(-this.maxBreadcrumbs);
    }
  }

  /**
   * Set user context
   */
  setUser(user: SentryUser | null): void {
    this.config.user = user || {};
  }

  /**
   * Set tag
   */
  setTag(key: string, value: string): void {
    this.config.tags[key] = value;
  }

  /**
   * Set extra context
   */
  setExtra(key: string, value: unknown): void {
    // Store in tags for simplicity
    this.config.tags[`extra_${key}`] = String(value);
  }

  /**
   * Start a transaction for performance monitoring
   */
  startTransaction(name: string, op: string): string {
    // Sample rate check for traces
    if (Math.random() > this.config.tracesSampleRate) {
      return '';
    }

    const transactionId = this.generateEventId();
    const transaction: SentryTransaction = {
      name,
      op,
      startTimestamp: Date.now() / 1000,
      spans: [],
    };

    this.transactions.set(transactionId, transaction);
    this.emit('transaction:start', { transactionId, name, op });

    return transactionId;
  }

  /**
   * Start a span within a transaction
   */
  startSpan(transactionId: string, op: string, description: string): string {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) return '';

    const spanId = this.generateSpanId();
    const span: SentrySpan = {
      spanId,
      op,
      description,
      startTimestamp: Date.now() / 1000,
    };

    transaction.spans.push(span);
    return spanId;
  }

  /**
   * Finish a span
   */
  finishSpan(transactionId: string, spanId: string, status: string = 'ok'): void {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) return;

    const span = transaction.spans.find(s => s.spanId === spanId);
    if (span) {
      span.endTimestamp = Date.now() / 1000;
      span.status = status;
    }
  }

  /**
   * Finish a transaction
   */
  finishTransaction(transactionId: string, status: SentryTransaction['status'] = 'ok'): void {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) return;

    transaction.endTimestamp = Date.now() / 1000;
    transaction.status = status;

    this.emit('transaction:finish', { transactionId, transaction });
    this.transactions.delete(transactionId);
  }

  /**
   * Flush pending events to Sentry
   */
  async flush(): Promise<void> {
    if (this.eventQueue.length === 0) return;

    const events = [...this.eventQueue];
    this.eventQueue = [];

    for (const event of events) {
      try {
        await this.sendEvent(event);
      } catch (error) {
        if (this.config.debug) {
          logger.error('Failed to send event to Sentry', { error });
        }
      }
    }
  }

  /**
   * Send event to Sentry
   */
  private async sendEvent(event: SentryEvent): Promise<void> {
    const { projectId, publicKey, host } = this.parseDsn(this.config.dsn);

    const url = `https://${host}/api/${projectId}/store/`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=code-buddy/1.0.0, sentry_key=${publicKey}`,
      },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      throw new Error(`Sentry API error: ${response.status}`);
    }

    if (this.config.debug) {
      logger.debug('Event sent to Sentry', { eventId: event.event_id });
    }
  }

  /**
   * Parse Sentry DSN
   */
  private parseDsn(dsn: string): { publicKey: string; projectId: string; host: string } {
    const match = dsn.match(/^https?:\/\/([^@]+)@([^/]+)\/(\d+)$/);
    if (!match) {
      throw new Error('Invalid Sentry DSN format');
    }

    return {
      publicKey: match[1],
      host: match[2],
      projectId: match[3],
    };
  }

  /**
   * Parse error stack trace
   */
  private parseStackTrace(stack?: string): { frames: Array<{ filename: string; function: string; lineno?: number; colno?: number; in_app: boolean }> } | undefined {
    if (!stack) return undefined;

    const frames = stack
      .split('\n')
      .slice(1) // Skip error message line
      .map(line => {
        const match = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/);
        if (!match) return null;

        return {
          function: match[1] || '<anonymous>',
          filename: match[2],
          lineno: parseInt(match[3], 10),
          colno: parseInt(match[4], 10),
          in_app: !match[2].includes('node_modules'),
        };
      })
      .filter((frame): frame is NonNullable<typeof frame> => frame !== null)
      .reverse(); // Sentry expects oldest frame first

    return { frames };
  }

  /**
   * Get system contexts
   */
  private getContexts(): SentryEvent['contexts'] {
    return {
      os: {
        name: os.platform(),
        version: os.release(),
      },
      runtime: {
        name: 'node',
        version: process.version,
      },
      app: {
        app_name: 'code-buddy',
        app_version: this.config.release,
      },
    };
  }

  /**
   * Generate event ID
   */
  private generateEventId(): string {
    return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/x/g, () =>
      Math.floor(Math.random() * 16).toString(16)
    );
  }

  /**
   * Generate span ID
   */
  private generateSpanId(): string {
    return 'xxxxxxxxxxxxxxxx'.replace(/x/g, () =>
      Math.floor(Math.random() * 16).toString(16)
    );
  }

  /**
   * Close Sentry integration
   */
  async close(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    await this.flush();
    this.initialized = false;
    this.emit('closed');
  }
}

// Singleton instance
let sentryInstance: SentryIntegration | null = null;

/**
 * Initialize Sentry
 */
export function initSentry(config: SentryConfig): SentryIntegration {
  if (!sentryInstance) {
    sentryInstance = new SentryIntegration(config);
    sentryInstance.init().catch(() => {});
  }
  return sentryInstance;
}

/**
 * Get Sentry instance
 */
export function getSentry(): SentryIntegration | null {
  return sentryInstance;
}

/**
 * Capture exception helper
 */
export function captureException(error: Error, options?: Parameters<SentryIntegration['captureException']>[1]): string {
  return sentryInstance?.captureException(error, options) || '';
}

/**
 * Capture message helper
 */
export function captureMessage(
  message: string,
  level?: SentryEvent['level'],
  options?: Parameters<SentryIntegration['captureMessage']>[2]
): string {
  return sentryInstance?.captureMessage(message, level, options) || '';
}

export default SentryIntegration;
