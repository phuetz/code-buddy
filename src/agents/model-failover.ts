import { codeBuddyEnv } from '../config/legacy-env.js';
import { runtimeDefaultModel } from '../config/runtime-default-model.js';
export interface FailoverEntry {
  provider: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  healthy: boolean;
  lastError?: string;
  lastChecked?: number;
  consecutiveFailures: number;
}

export interface FailoverConfig {
  maxRetries: number;
  cooldownMs: number;
  healthCheckIntervalMs: number;
}

const DEFAULT_CONFIG: FailoverConfig = {
  maxRetries: 3,
  cooldownMs: 60000,
  healthCheckIntervalMs: 300000,
};

export class ModelFailoverChain {
  private chain: FailoverEntry[];
  private config: FailoverConfig;

  constructor(chain?: Partial<FailoverEntry>[], config?: Partial<FailoverConfig>) {
    this.chain = (chain ?? []).map(e => ({
      healthy: true,
      consecutiveFailures: 0,
      ...e,
      provider: e.provider ?? '',
      model: e.model ?? '',
    }));
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  addProvider(entry: Omit<FailoverEntry, 'healthy' | 'consecutiveFailures'>): void {
    this.chain.push({
      ...entry,
      healthy: true,
      consecutiveFailures: 0,
    });
  }

  getNextProvider(): FailoverEntry | null {
    const now = Date.now();
    for (const entry of this.chain) {
      if (entry.healthy) {
        return entry;
      }
      // Check if cooldown has expired
      if (entry.lastChecked && (now - entry.lastChecked) >= this.config.cooldownMs) {
        entry.healthy = true;
        entry.consecutiveFailures = 0;
        return entry;
      }
    }
    return null;
  }

  markFailed(provider: string, error: string): void {
    const entry = this.chain.find(e => e.provider === provider);
    if (entry) {
      entry.consecutiveFailures++;
      entry.healthy = false;
      entry.lastError = error;
      entry.lastChecked = Date.now();
    }
  }

  markHealthy(provider: string): void {
    const entry = this.chain.find(e => e.provider === provider);
    if (entry) {
      entry.healthy = true;
      entry.consecutiveFailures = 0;
      entry.lastError = undefined;
      entry.lastChecked = Date.now();
    }
  }

  resetAll(): void {
    for (const entry of this.chain) {
      entry.healthy = true;
      entry.consecutiveFailures = 0;
      entry.lastError = undefined;
      entry.lastChecked = undefined;
    }
  }

  getStatus(): Array<{ provider: string; model: string; healthy: boolean; failures: number }> {
    return this.chain.map(e => ({
      provider: e.provider,
      model: e.model,
      healthy: e.healthy,
      failures: e.consecutiveFailures,
    }));
  }

  static fromEnvironment(): ModelFailoverChain {
    const chain = new ModelFailoverChain();

    if (process.env.CODEBUDDY_API_KEY) {
      chain.addProvider({
        provider: 'custom',
        model: codeBuddyEnv('MODEL') || runtimeDefaultModel(),
        apiKey: 'CODEBUDDY_API_KEY',
        baseURL: codeBuddyEnv('BASE_URL'),
      });
    } else if (process.env.XAI_API_KEY || process.env.GROK_API_KEY) {
      codeBuddyEnv('API_KEY'); // Log the deprecated alias once when present.
      chain.addProvider({
        provider: 'grok',
        model: process.env.XAI_MODEL || codeBuddyEnv('MODEL') || 'grok-3',
        apiKey: process.env.XAI_API_KEY ? 'XAI_API_KEY' : 'GROK_API_KEY',
        baseURL: codeBuddyEnv('BASE_URL'),
      });
    }

    if (process.env.ANTHROPIC_API_KEY) {
      chain.addProvider({
        provider: 'claude',
        model: 'claude-sonnet-4-20250514',
        apiKey: 'ANTHROPIC_API_KEY',
      });
    }

    if (process.env.OPENAI_API_KEY) {
      chain.addProvider({
        provider: 'chatgpt',
        model: 'gpt-4o',
        apiKey: 'OPENAI_API_KEY',
      });
    }

    if (process.env.GOOGLE_API_KEY) {
      chain.addProvider({
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        apiKey: 'GOOGLE_API_KEY',
      });
    }

    return chain;
  }
}
