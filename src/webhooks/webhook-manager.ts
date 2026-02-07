import { randomUUID } from 'crypto';
import { createHmac, timingSafeEqual } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

export interface WebhookConfig {
  id: string;
  name: string;
  secret?: string;
  agentMessage: string;
  enabled: boolean;
  createdAt: number;
}

export class WebhookManager {
  private webhooks: Map<string, WebhookConfig> = new Map();
  private configPath: string;

  constructor(configDir?: string) {
    this.configPath = join(configDir || '.codebuddy', 'webhooks.json');
    this.load();
  }

  register(name: string, agentMessage: string, secret?: string): WebhookConfig {
    const config: WebhookConfig = {
      id: randomUUID(),
      name,
      secret,
      agentMessage,
      enabled: true,
      createdAt: Date.now(),
    };
    this.webhooks.set(config.id, config);
    this.save();
    return config;
  }

  remove(id: string): boolean {
    const deleted = this.webhooks.delete(id);
    if (deleted) {
      this.save();
    }
    return deleted;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const hook = this.webhooks.get(id);
    if (!hook) return false;
    hook.enabled = enabled;
    this.save();
    return true;
  }

  get(id: string): WebhookConfig | undefined {
    return this.webhooks.get(id);
  }

  list(): WebhookConfig[] {
    return Array.from(this.webhooks.values());
  }

  processPayload(
    id: string,
    body: Record<string, unknown>,
    signature?: string
  ): { message: string } | { error: string } {
    const hook = this.webhooks.get(id);
    if (!hook) {
      return { error: 'Webhook not found' };
    }
    if (!hook.enabled) {
      return { error: 'Webhook is disabled' };
    }
    if (hook.secret) {
      if (!signature) {
        return { error: 'Missing signature' };
      }
      const payload = JSON.stringify(body);
      if (!this.verifySignature(payload, signature, hook.secret)) {
        return { error: 'Invalid signature' };
      }
    }
    const message = this.resolveTemplate(hook.agentMessage, body);
    return { message };
  }

  private verifySignature(payload: string, signature: string, secret: string): boolean {
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    try {
      const sigBuf = Buffer.from(signature, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      if (sigBuf.length !== expBuf.length) return false;
      return timingSafeEqual(sigBuf, expBuf);
    } catch {
      return false;
    }
  }

  private resolveTemplate(template: string, body: Record<string, unknown>): string {
    return template.replace(/\{\{body\.([^}]+)\}\}/g, (_match, path: string) => {
      const parts = path.split('.');
      let current: unknown = body;
      for (const part of parts) {
        if (current === null || current === undefined || typeof current !== 'object') {
          return `{{body.${path}}}`;
        }
        current = (current as Record<string, unknown>)[part];
      }
      if (current === null || current === undefined) {
        return `{{body.${path}}}`;
      }
      return String(current);
    });
  }

  private load(): void {
    try {
      if (existsSync(this.configPath)) {
        const data = JSON.parse(readFileSync(this.configPath, 'utf-8'));
        if (Array.isArray(data)) {
          for (const hook of data) {
            this.webhooks.set(hook.id, hook);
          }
        }
      }
    } catch {
      // Start with empty webhooks on load failure
    }
  }

  private save(): void {
    try {
      const dir = dirname(this.configPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.configPath, JSON.stringify(this.list(), null, 2));
    } catch {
      // Silently fail on save errors
    }
  }
}
