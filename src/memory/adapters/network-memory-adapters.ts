import type { MemoryProvider, MemoryRememberOptions } from '../memory-provider.js';
import { LocalMemoryProvider } from '../memory-provider.js';
import type { Memory } from '../persistent-memory.js';
import { logger } from '../../utils/logger.js';

/**
 * Mem0 Memory Provider Adapter
 */
export class Mem0MemoryProvider implements MemoryProvider {
  readonly id = 'mem0';
  private fallback: LocalMemoryProvider;
  private apiKey: string;
  private baseUrl: string;

  constructor(options: { apiKey?: string; baseUrl?: string } = {}) {
    this.apiKey = options.apiKey || process.env.MEM0_API_KEY || '';
    this.baseUrl = options.baseUrl || process.env.MEM0_BASE_URL || 'https://api.mem0.ai/v1';
    this.fallback = new LocalMemoryProvider();
  }

  async initialize(): Promise<void> {
    await this.fallback.initialize();
    if (!this.apiKey) {
      logger.info('Mem0MemoryProvider: No API key provided, falling back to local memory.');
    } else {
      logger.info('Mem0MemoryProvider: Initialized with remote backend.');
    }
  }

  async remember(key: string, value: string, options?: MemoryRememberOptions): Promise<void> {
    if (!this.apiKey) {
      return this.fallback.remember(key, value, options);
    }
    try {
      const response = await fetch(`${this.baseUrl}/memories/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Token ${this.apiKey}`,
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `${key}: ${value}` }],
          user_id: options?.scope === 'user' ? 'default-user' : 'project-context',
        }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      logger.debug('Mem0MemoryProvider: Successfully remembered memory.');
    } catch (err) {
      logger.warn('Mem0MemoryProvider: remember failed, falling back to local', {
        error: err instanceof Error ? err.message : String(err),
      });
      await this.fallback.remember(key, value, options);
    }
  }

  async recall(key: string, scope?: 'project' | 'user'): Promise<string | null> {
    if (!this.apiKey) {
      return this.fallback.recall(key, scope);
    }
    try {
      const response = await fetch(`${this.baseUrl}/memories/?user_id=${scope === 'user' ? 'default-user' : 'project-context'}&q=${encodeURIComponent(key)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as Array<{ memory?: string }>;
      if (Array.isArray(data) && data.length > 0) {
        return data[0]?.memory || null;
      }
      return null;
    } catch (err) {
      logger.warn('Mem0MemoryProvider: recall failed, falling back to local', {
        error: err instanceof Error ? err.message : String(err),
      });
      return this.fallback.recall(key, scope);
    }
  }

  async getRelevantMemories(query: string, limit = 5): Promise<Memory[]> {
    if (!this.apiKey) {
      return this.fallback.getRelevantMemories(query, limit);
    }
    try {
      const response = await fetch(`${this.baseUrl}/memories/search/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Token ${this.apiKey}`,
        },
        body: JSON.stringify({
          query,
          user_id: 'default-user',
          limit,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as Array<{ memory?: string }>;
      if (Array.isArray(data)) {
        return data.map((item) => ({
          key: query,
          value: item.memory || '',
          category: 'context' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
          accessCount: 1,
        }));
      }
      return [];
    } catch (err) {
      logger.warn('Mem0MemoryProvider: search failed, falling back to local', {
        error: err instanceof Error ? err.message : String(err),
      });
      return this.fallback.getRelevantMemories(query, limit);
    }
  }

  async getContextForPrompt(): Promise<string> {
    if (!this.apiKey) {
      return this.fallback.getContextForPrompt();
    }
    try {
      const memories = await this.getRelevantMemories('working preferences', 10);
      if (memories.length === 0) return '';
      return memories.map(m => `- ${m.value}`).join('\n');
    } catch {
      return this.fallback.getContextForPrompt();
    }
  }
}

/**
 * Honcho Memory Provider Adapter
 */
export class HonchoMemoryProvider implements MemoryProvider {
  readonly id = 'honcho';
  private fallback: LocalMemoryProvider;
  private apiKey: string;
  private baseUrl: string;

  constructor(options: { apiKey?: string; baseUrl?: string } = {}) {
    this.apiKey = options.apiKey || process.env.HONCHO_API_KEY || '';
    this.baseUrl = options.baseUrl || process.env.HONCHO_BASE_URL || 'https://api.honcho.dev/v1';
    this.fallback = new LocalMemoryProvider();
  }

  async initialize(): Promise<void> {
    await this.fallback.initialize();
    if (!this.apiKey) {
      logger.info('HonchoMemoryProvider: No API key provided, falling back to local memory.');
    } else {
      logger.info('HonchoMemoryProvider: Initialized.');
    }
  }

  async remember(key: string, value: string, options?: MemoryRememberOptions): Promise<void> {
    if (!this.apiKey) {
      return this.fallback.remember(key, value, options);
    }
    try {
      const response = await fetch(`${this.baseUrl}/users/me/metatheory/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ key, value }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (err) {
      logger.warn('HonchoMemoryProvider: remember failed, falling back to local', {
        error: err instanceof Error ? err.message : String(err),
      });
      await this.fallback.remember(key, value, options);
    }
  }

  async recall(key: string, scope?: 'project' | 'user'): Promise<string | null> {
    if (!this.apiKey) {
      return this.fallback.recall(key, scope);
    }
    try {
      const response = await fetch(`${this.baseUrl}/users/me/metatheory/${encodeURIComponent(key)}/`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { value?: string };
      return data.value || null;
    } catch (err) {
      logger.warn('HonchoMemoryProvider: recall failed, falling back to local', {
        error: err instanceof Error ? err.message : String(err),
      });
      return this.fallback.recall(key, scope);
    }
  }

  async getRelevantMemories(query: string, limit = 5): Promise<Memory[]> {
    if (!this.apiKey) {
      return this.fallback.getRelevantMemories(query, limit);
    }
    try {
      const response = await fetch(`${this.baseUrl}/users/me/metatheory/?q=${encodeURIComponent(query)}&limit=${limit}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as Array<{ key?: string; value?: string }>;
      if (Array.isArray(data)) {
        return data.map((item) => ({
          key: item.key || query,
          value: item.value || '',
          category: 'preferences' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
          accessCount: 1,
        }));
      }
      return [];
    } catch (err) {
      logger.warn('HonchoMemoryProvider: search failed, falling back to local', {
        error: err instanceof Error ? err.message : String(err),
      });
      return this.fallback.getRelevantMemories(query, limit);
    }
  }

  async getContextForPrompt(): Promise<string> {
    if (!this.apiKey) {
      return this.fallback.getContextForPrompt();
    }
    try {
      const memories = await this.getRelevantMemories('working preferences', 10);
      if (memories.length === 0) return '';
      return memories.map(m => `- [${m.key}]: ${m.value}`).join('\n');
    } catch {
      return this.fallback.getContextForPrompt();
    }
  }
}

/**
 * Supermemory Memory Provider Adapter
 */
export class SupermemoryMemoryProvider implements MemoryProvider {
  readonly id = 'supermemory';
  private fallback: LocalMemoryProvider;
  private apiKey: string;
  private baseUrl: string;

  constructor(options: { apiKey?: string; baseUrl?: string } = {}) {
    this.apiKey = options.apiKey || process.env.SUPERMEMORY_API_KEY || '';
    this.baseUrl = options.baseUrl || process.env.SUPERMEMORY_BASE_URL || 'https://api.supermemory.ai/v1';
    this.fallback = new LocalMemoryProvider();
  }

  async initialize(): Promise<void> {
    await this.fallback.initialize();
    if (!this.apiKey) {
      logger.info('SupermemoryMemoryProvider: No API key provided, falling back to local memory.');
    } else {
      logger.info('SupermemoryMemoryProvider: Initialized.');
    }
  }

  async remember(key: string, value: string, options?: MemoryRememberOptions): Promise<void> {
    if (!this.apiKey) {
      return this.fallback.remember(key, value, options);
    }
    try {
      const response = await fetch(`${this.baseUrl}/memories/add`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ key, value }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (err) {
      logger.warn('SupermemoryMemoryProvider: remember failed, falling back to local', {
        error: err instanceof Error ? err.message : String(err),
      });
      await this.fallback.remember(key, value, options);
    }
  }

  async recall(key: string, scope?: 'project' | 'user'): Promise<string | null> {
    if (!this.apiKey) {
      return this.fallback.recall(key, scope);
    }
    try {
      const response = await fetch(`${this.baseUrl}/memories/get?key=${encodeURIComponent(key)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { value?: string };
      return data.value || null;
    } catch (err) {
      logger.warn('SupermemoryMemoryProvider: recall failed, falling back to local', {
        error: err instanceof Error ? err.message : String(err),
      });
      return this.fallback.recall(key, scope);
    }
  }

  async getRelevantMemories(query: string, limit = 5): Promise<Memory[]> {
    if (!this.apiKey) {
      return this.fallback.getRelevantMemories(query, limit);
    }
    try {
      const response = await fetch(`${this.baseUrl}/memories/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ query, limit }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as Array<{ value?: string; text?: string }>;
      if (Array.isArray(data)) {
        return data.map((item) => ({
          key: query,
          value: item.value || item.text || '',
          category: 'context' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
          accessCount: 1,
        }));
      }
      return [];
    } catch (err) {
      logger.warn('SupermemoryMemoryProvider: search failed, falling back to local', {
        error: err instanceof Error ? err.message : String(err),
      });
      return this.fallback.getRelevantMemories(query, limit);
    }
  }

  async getContextForPrompt(): Promise<string> {
    if (!this.apiKey) {
      return this.fallback.getContextForPrompt();
    }
    try {
      const memories = await this.getRelevantMemories('working preferences', 10);
      if (memories.length === 0) return '';
      return memories.map(m => `- ${m.value}`).join('\n');
    } catch {
      return this.fallback.getContextForPrompt();
    }
  }
}
