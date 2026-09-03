/**
 * Webhook Integration
 *
 * Support for external webhooks:
 * - Event notifications
 * - Custom endpoints
 * - Retry logic
 * - Payload signing
 */

import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';

export type WebhookEvent =
  | 'session.start'
  | 'session.end'
  | 'message.user'
  | 'message.assistant'
  | 'tool.start'
  | 'tool.complete'
  | 'tool.error'
  | 'file.create'
  | 'file.modify'
  | 'file.delete'
  | 'error'
  | 'cost.threshold';

export interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  secret?: string;
  enabled: boolean;
  headers?: Record<string, string>;
  retryCount?: number;
  retryDelay?: number; // ms
  timeout?: number; // ms
}

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, unknown>;
  sessionId?: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: WebhookEvent;
  payload: WebhookPayload;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  lastAttempt?: Date;
  response?: {
    statusCode: number;
    body?: string;
  };
  error?: string;
}

const DEFAULT_WEBHOOK_CONFIG: Partial<WebhookConfig> = {
  enabled: true,
  retryCount: 3,
  retryDelay: 1000,
  timeout: 10000,
};

/**
 * Webhook Manager
 */
export class WebhookManager {
  private webhooks: Map<string, WebhookConfig> = new Map();
  private deliveryHistory: WebhookDelivery[] = [];
  private configPath: string;
  private maxHistorySize: number = 100;

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(os.homedir(), '.codebuddy', 'webhooks.json');
    this.loadConfig();
  }

  /**
   * Register a webhook
   */
  register(config: Omit<WebhookConfig, 'id'>): string {
    const id = `webhook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const webhook: WebhookConfig = {
      ...DEFAULT_WEBHOOK_CONFIG,
      ...config,
      id,
    };

    this.webhooks.set(id, webhook);
    this.saveConfig();

    return id;
  }

  /**
   * Update a webhook
   */
  update(id: string, updates: Partial<WebhookConfig>): boolean {
    const webhook = this.webhooks.get(id);
    if (!webhook) return false;

    Object.assign(webhook, updates);
    this.saveConfig();
    return true;
  }

  /**
   * Remove a webhook
   */
  remove(id: string): boolean {
    const result = this.webhooks.delete(id);
    if (result) this.saveConfig();
    return result;
  }

  /**
   * Get webhook by ID
   */
  get(id: string): WebhookConfig | undefined {
    return this.webhooks.get(id);
  }

  /**
   * Get all webhooks
   */
  getAll(): WebhookConfig[] {
    return Array.from(this.webhooks.values());
  }

  /**
   * Get webhooks for an event
   */
  getForEvent(event: WebhookEvent): WebhookConfig[] {
    return this.getAll().filter(w =>
      w.enabled && w.events.includes(event)
    );
  }

  /**
   * Emit an event to all registered webhooks
   */
  async emit(
    event: WebhookEvent,
    data: Record<string, unknown>,
    sessionId?: string
  ): Promise<WebhookDelivery[]> {
    const webhooks = this.getForEvent(event);
    const deliveries: WebhookDelivery[] = [];

    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
      sessionId,
    };

    for (const webhook of webhooks) {
      const delivery = await this.deliver(webhook, payload);
      deliveries.push(delivery);
      this.addToHistory(delivery);
    }

    return deliveries;
  }

  /**
   * Deliver payload to a webhook
   */
  private async deliver(
    webhook: WebhookConfig,
    payload: WebhookPayload
  ): Promise<WebhookDelivery> {
    const delivery: WebhookDelivery = {
      id: `delivery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      webhookId: webhook.id,
      event: payload.event,
      payload,
      status: 'pending',
      attempts: 0,
    };

    const retryCount = webhook.retryCount || 3;
    const retryDelay = webhook.retryDelay || 1000;

    for (let attempt = 0; attempt < retryCount; attempt++) {
      delivery.attempts++;
      delivery.lastAttempt = new Date();

      try {
        const response = await this.sendRequest(webhook, payload);
        delivery.status = 'success';
        delivery.response = response;
        break;
      } catch (error) {
        delivery.error = error instanceof Error ? error.message : 'Unknown error';

        if (attempt < retryCount - 1) {
          await this.delay(retryDelay * Math.pow(2, attempt)); // Exponential backoff
        } else {
          delivery.status = 'failed';
        }
      }
    }

    return delivery;
  }

  /**
   * Send HTTP request
   */
  private sendRequest(
    webhook: WebhookConfig,
    payload: WebhookPayload
  ): Promise<{ statusCode: number; body?: string }> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(payload);
      const url = new URL(webhook.url);
      const isHttps = url.protocol === 'https:';

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body).toString(),
        'User-Agent': 'CodeBuddy-Webhook/1.0',
        ...webhook.headers,
      };

      // Add signature if secret is configured
      if (webhook.secret) {
        const signature = this.signPayload(body, webhook.secret);
        headers['X-Webhook-Signature'] = signature;
      }

      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers,
        timeout: webhook.timeout || 10000,
      };

      const req = (isHttps ? https : http).request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, body: responseBody });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${responseBody.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.write(body);
      req.end();
    });
  }

  /**
   * Sign payload with secret
   */
  private signPayload(payload: string, secret: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  }

  /**
   * Verify webhook signature
   */
  static verifySignature(
    payload: string,
    signature: string,
    secret: string
  ): boolean {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  }

  /**
   * Get delivery history
   */
  getHistory(webhookId?: string): WebhookDelivery[] {
    if (webhookId) {
      return this.deliveryHistory.filter(d => d.webhookId === webhookId);
    }
    return [...this.deliveryHistory];
  }

  /**
   * Get failed deliveries
   */
  getFailedDeliveries(): WebhookDelivery[] {
    return this.deliveryHistory.filter(d => d.status === 'failed');
  }

  /**
   * Retry a failed delivery
   */
  async retry(deliveryId: string): Promise<WebhookDelivery | null> {
    const delivery = this.deliveryHistory.find(d => d.id === deliveryId);
    if (!delivery || delivery.status !== 'failed') return null;

    const webhook = this.webhooks.get(delivery.webhookId);
    if (!webhook) return null;

    const newDelivery = await this.deliver(webhook, delivery.payload);
    this.addToHistory(newDelivery);

    return newDelivery;
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.deliveryHistory = [];
  }

  /**
   * Test a webhook
   */
  async test(id: string): Promise<WebhookDelivery | null> {
    const webhook = this.webhooks.get(id);
    if (!webhook) return null;

    const payload: WebhookPayload = {
      event: 'session.start',
      timestamp: new Date().toISOString(),
      data: { test: true, message: 'This is a test webhook delivery' },
    };

    const delivery = await this.deliver(webhook, payload);
    this.addToHistory(delivery);

    return delivery;
  }

  /**
   * Format webhook list for display
   */
  formatWebhooks(): string {
    const webhooks = this.getAll();

    if (webhooks.length === 0) {
      return 'No webhooks configured.';
    }

    const lines: string[] = [
      '',
      '═══════════════════════════════════════════════════════════',
      '              WEBHOOKS',
      '═══════════════════════════════════════════════════════════',
      '',
    ];

    for (const webhook of webhooks) {
      const status = webhook.enabled ? '[ON] ' : '[OFF]';
      lines.push(`${status} ${webhook.name}`);
      lines.push(`      URL: ${webhook.url}`);
      lines.push(`      Events: ${webhook.events.join(', ')}`);
      lines.push('');
    }

    lines.push('═══════════════════════════════════════════════════════════');

    return lines.join('\n');
  }

  /**
   * Add to history
   */
  private addToHistory(delivery: WebhookDelivery): void {
    this.deliveryHistory.push(delivery);

    // Trim history
    if (this.deliveryHistory.length > this.maxHistorySize) {
      this.deliveryHistory = this.deliveryHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Load config from file
   */
  private loadConfig(): void {
    const data = readJsonAtomicSync<WebhookConfig[]>(this.configPath, [], {
      mode: 0o600,
      isValid: (value): value is WebhookConfig[] => Array.isArray(value),
    });
    for (const webhook of data) {
      if (webhook && typeof webhook.id === 'string') {
        this.webhooks.set(webhook.id, webhook);
      }
    }
  }

  /**
   * Save config to file
   */
  private saveConfig(): void {
    try {
      const webhooks = Array.from(this.webhooks.values());
      writeJsonAtomicSync(this.configPath, webhooks, { mode: 0o600 });
    } catch {
      // Ignore save errors
    }
  }
}

// Singleton instance
let webhookManager: WebhookManager | null = null;

/**
 * Get or create webhook manager
 */
export function getWebhookManager(): WebhookManager {
  if (!webhookManager) {
    webhookManager = new WebhookManager();
  }
  return webhookManager;
}

/**
 * Emit a webhook event
 */
export async function emitWebhook(
  event: WebhookEvent,
  data: Record<string, unknown>,
  sessionId?: string
): Promise<void> {
  await getWebhookManager().emit(event, data, sessionId);
}

export default WebhookManager;
