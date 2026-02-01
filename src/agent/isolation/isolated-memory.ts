/**
 * Isolated Memory
 *
 * Provides memory isolation for agents with scoped access
 * to memories based on agent ID.
 */

import type { MemoryEntry, MemoryType, MemorySearchOptions } from '../../memory/enhanced-memory.js';
import { getEnhancedMemory } from '../../memory/enhanced-memory.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Memory scope
 */
export type MemoryScope = 'agent' | 'shared' | 'global';

/**
 * Scoped memory entry
 */
export interface ScopedMemoryEntry extends MemoryEntry {
  /** Agent ID (for agent-scoped memories) */
  agentId?: string;
  /** Memory scope */
  scope: MemoryScope;
}

/**
 * Isolated memory configuration
 */
export interface IsolatedMemoryConfig {
  /** Agent ID */
  agentId: string;
  /** Whether to include shared memories */
  includeShared: boolean;
  /** Whether to include global memories */
  includeGlobal: boolean;
  /** Maximum memories to return per query */
  maxResults: number;
}

/**
 * Default isolated memory configuration
 */
export const DEFAULT_ISOLATED_MEMORY_CONFIG: Omit<IsolatedMemoryConfig, 'agentId'> = {
  includeShared: true,
  includeGlobal: true,
  maxResults: 50,
};

// ============================================================================
// Isolated Memory
// ============================================================================

/**
 * Provides isolated memory access for an agent
 */
export class IsolatedMemory {
  private agentId: string;
  private config: IsolatedMemoryConfig;

  constructor(agentId: string, config: Partial<IsolatedMemoryConfig> = {}) {
    this.agentId = agentId;
    this.config = {
      agentId,
      ...DEFAULT_ISOLATED_MEMORY_CONFIG,
      ...config,
    };
  }

  /**
   * Store a memory scoped to this agent
   */
  async store(options: {
    type: MemoryType;
    content: string;
    summary?: string;
    importance?: number;
    tags?: string[];
    metadata?: Record<string, unknown>;
    scope?: MemoryScope;
  }): Promise<ScopedMemoryEntry> {
    const enhancedMemory = getEnhancedMemory();
    const scope = options.scope || 'agent';

    // Add agent ID to tags for filtering
    const tags = [...(options.tags || [])];
    if (scope === 'agent') {
      tags.push(`agent:${this.agentId}`);
    } else if (scope === 'shared') {
      tags.push('scope:shared');
    } else {
      tags.push('scope:global');
    }

    const entry = await enhancedMemory.store({
      type: options.type,
      content: options.content,
      summary: options.summary,
      importance: options.importance,
      tags,
      metadata: {
        ...options.metadata,
        agentId: scope === 'agent' ? this.agentId : undefined,
        scope,
      },
    });

    logger.debug('Stored isolated memory', {
      agentId: this.agentId,
      memoryId: entry.id,
      scope,
      type: options.type,
    });

    return {
      ...entry,
      agentId: scope === 'agent' ? this.agentId : undefined,
      scope,
    };
  }

  /**
   * Recall memories with agent scoping
   */
  async recall(options: Partial<MemorySearchOptions> = {}): Promise<ScopedMemoryEntry[]> {
    const enhancedMemory = getEnhancedMemory();
    const tags: string[] = [];

    // Build tag filter based on configuration
    if (this.config.includeGlobal && this.config.includeShared) {
      // No tag filter - include everything the agent can access
    } else {
      // Always include agent's own memories
      tags.push(`agent:${this.agentId}`);

      if (this.config.includeShared) {
        tags.push('scope:shared');
      }
      if (this.config.includeGlobal) {
        tags.push('scope:global');
      }
    }

    const memories = await enhancedMemory.recall({
      ...options,
      tags: tags.length > 0 ? [...(options.tags || []), ...tags] : options.tags,
      limit: options.limit || this.config.maxResults,
    });

    // Filter and annotate with scope
    return memories
      .filter(m => this.hasAccess(m))
      .map(m => this.annotateWithScope(m));
  }

  /**
   * Check if agent has access to a memory
   */
  private hasAccess(memory: MemoryEntry): boolean {
    const metadata = memory.metadata as { agentId?: string; scope?: MemoryScope } | undefined;

    // Check if it's this agent's memory
    if (metadata?.agentId === this.agentId) {
      return true;
    }

    // Check scope-based access
    const scope = metadata?.scope || 'global';

    if (scope === 'agent') {
      return metadata?.agentId === this.agentId;
    }

    if (scope === 'shared') {
      return this.config.includeShared;
    }

    // Global
    return this.config.includeGlobal;
  }

  /**
   * Annotate memory with scope info
   */
  private annotateWithScope(memory: MemoryEntry): ScopedMemoryEntry {
    const metadata = memory.metadata as { agentId?: string; scope?: MemoryScope } | undefined;

    let scope: MemoryScope = 'global';
    if (memory.tags.includes(`agent:${this.agentId}`)) {
      scope = 'agent';
    } else if (memory.tags.includes('scope:shared')) {
      scope = 'shared';
    }

    return {
      ...memory,
      agentId: metadata?.agentId,
      scope,
    };
  }

  /**
   * Forget a memory (only if owned by this agent)
   */
  async forget(memoryId: string): Promise<boolean> {
    const enhancedMemory = getEnhancedMemory();

    // Recall to check ownership
    const memories = await this.recall({ limit: 1000 });
    const memory = memories.find(m => m.id === memoryId);

    if (!memory) {
      logger.warn('Memory not found or not accessible', {
        agentId: this.agentId,
        memoryId,
      });
      return false;
    }

    if (memory.scope === 'agent' && memory.agentId !== this.agentId) {
      logger.warn('Cannot forget memory owned by another agent', {
        agentId: this.agentId,
        memoryId,
        ownerId: memory.agentId,
      });
      return false;
    }

    return enhancedMemory.forget(memoryId);
  }

  /**
   * Get memory statistics for this agent
   */
  async getStats(): Promise<{
    agentMemories: number;
    sharedMemories: number;
    globalMemories: number;
    total: number;
  }> {
    const enhancedMemory = getEnhancedMemory();
    const allMemories = await enhancedMemory.recall({ limit: 10000 });

    let agentMemories = 0;
    let sharedMemories = 0;
    let globalMemories = 0;

    for (const memory of allMemories) {
      if (memory.tags.includes(`agent:${this.agentId}`)) {
        agentMemories++;
      } else if (memory.tags.includes('scope:shared')) {
        sharedMemories++;
      } else {
        globalMemories++;
      }
    }

    return {
      agentMemories,
      sharedMemories,
      globalMemories,
      total: agentMemories + (this.config.includeShared ? sharedMemories : 0) +
             (this.config.includeGlobal ? globalMemories : 0),
    };
  }

  /**
   * Share a memory with other agents
   */
  async shareMemory(memoryId: string): Promise<boolean> {
    const enhancedMemory = getEnhancedMemory();

    // Find the memory
    const memories = await this.recall({ limit: 1000 });
    const memory = memories.find(m => m.id === memoryId);

    if (!memory || memory.agentId !== this.agentId) {
      return false;
    }

    // Re-store with shared scope
    await this.store({
      type: memory.type,
      content: memory.content,
      summary: memory.summary,
      importance: memory.importance,
      tags: memory.tags.filter(t => !t.startsWith('agent:')),
      metadata: memory.metadata,
      scope: 'shared',
    });

    // Optionally remove the original
    await enhancedMemory.forget(memoryId);

    return true;
  }

  /**
   * Get agent ID
   */
  getAgentId(): string {
    return this.agentId;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<IsolatedMemoryConfig>): void {
    Object.assign(this.config, config);
  }
}

// ============================================================================
// Factory
// ============================================================================

const isolatedMemoryInstances: Map<string, IsolatedMemory> = new Map();

/**
 * Get or create IsolatedMemory for an agent
 */
export function getIsolatedMemory(
  agentId: string,
  config?: Partial<IsolatedMemoryConfig>
): IsolatedMemory {
  let instance = isolatedMemoryInstances.get(agentId);
  if (!instance) {
    instance = new IsolatedMemory(agentId, config);
    isolatedMemoryInstances.set(agentId, instance);
  }
  return instance;
}

/**
 * Reset IsolatedMemory instance for an agent
 */
export function resetIsolatedMemory(agentId: string): void {
  isolatedMemoryInstances.delete(agentId);
}

/**
 * Reset all IsolatedMemory instances
 */
export function resetAllIsolatedMemory(): void {
  isolatedMemoryInstances.clear();
}
