/**
 * GitNexus Tool Client
 *
 * Consultative, read-only interface to GitNexus endpoints (/ask, /push-session, /world-model).
 * Degrades gracefully by returning empty contexts/invariants and detailed notes on timeout/offline.
 */

import { logger } from '../utils/logger.js';
import { redactSecrets } from '../security/data-redaction.js';

export interface GitNexusConfig {
  endpoint?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface GitNexusContext {
  likelyFiles: string[];        // fichiers probablement concernés
  dependentSymbols: string[];   // symboles dépendants
  testsToWatch: string[];       // tests/modules à surveiller
  notes?: string;
}

export interface WorldModelInvariants {
  architecture: string[];
  invariants: string[];
}

export class GitNexusTool {
  private endpoint: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(config?: GitNexusConfig) {
    this.endpoint = config?.endpoint || process.env.GITNEXUS_ENDPOINT || '';
    this.apiKey = config?.apiKey || process.env.GITNEXUS_API_KEY || '';
    this.timeoutMs = config?.timeoutMs ?? Number(process.env.GITNEXUS_TIMEOUT_MS || 5000);
  }

  /**
   * Helper to perform HTTP request with timeout and headers.
   */
  private async request<T>(path: string, options: { method: string; body?: unknown }): Promise<T | null> {
    if (!this.endpoint) {
      logger.debug(`GitNexus: No endpoint configured, skipping request to ${path}`);
      return null;
    }

    const url = `${this.endpoint.replace(/\/$/, '')}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const fetchOptions: RequestInit = {
        method: options.method,
        headers,
        signal: controller.signal,
      };

      if (options.body !== undefined) {
        fetchOptions.body = JSON.stringify(options.body);
      }

      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${errText || response.statusText}`);
      }

      const data = await response.json() as T;
      return data;
    } catch (error) {
      const rawMsg = error instanceof Error ? error.message : String(error);
      const msg = redactSecrets(rawMsg);
      logger.warn(`GitNexus request to ${path} failed: ${msg}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Lecture seule : interroge GitNexus pour une tâche/texte. Dégrade proprement si indisponible.
   */
  async ask(query: string): Promise<GitNexusContext> {
    const redactedQuery = redactSecrets(query);
    logger.debug(`GitNexus.ask called with query: ${redactedQuery}`);

    if (!this.endpoint) {
      return {
        likelyFiles: [],
        dependentSymbols: [],
        testsToWatch: [],
        notes: 'GitNexus is not configured (missing endpoint).',
      };
    }

    const response = await this.request<GitNexusContext>('/ask', {
      method: 'POST',
      body: { query },
    });

    if (!response) {
      return {
        likelyFiles: [],
        dependentSymbols: [],
        testsToWatch: [],
        notes: 'GitNexus is offline or returned an error.',
      };
    }

    return {
      likelyFiles: response.likelyFiles || [],
      dependentSymbols: response.dependentSymbols || [],
      testsToWatch: response.testsToWatch || [],
      notes: response.notes,
    };
  }

  /**
   * Pousse le résumé de session vers GitNexus (mémoire technique).
   */
  async pushSession(summary: string): Promise<{ ok: boolean }> {
    const redactedSummary = redactSecrets(summary);
    logger.debug(`GitNexus.pushSession called: ${redactedSummary}`);

    if (!this.endpoint) {
      return { ok: false };
    }

    const response = await this.request<{ ok: boolean }>('/push-session', {
      method: 'POST',
      body: { summary },
    });

    return response || { ok: false };
  }

  /**
   * Lecture des invariants du world model.
   */
  async readWorldModel(): Promise<WorldModelInvariants | null> {
    logger.debug('GitNexus.readWorldModel called');

    if (!this.endpoint) {
      return null;
    }

    const response = await this.request<WorldModelInvariants>('/world-model', {
      method: 'GET',
    });

    return response;
  }
}
