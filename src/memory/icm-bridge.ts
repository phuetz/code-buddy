/**
 * ICM (Infinite Context Memory) Bridge
 *
 * Wraps ICM's MCP tools into Code Buddy's memory lifecycle.
 * ICM provides persistent cross-session memory via episodic + semantic
 * dual architecture through 16 MCP tools.
 *
 * All methods fail silently (log warning) if ICM is not available.
 *
 * @see https://github.com/rtk-ai/icm
 */

import { logger } from '../utils/logger.js';

/**
 * Minimal MCP manager interface for calling tools
 */
export interface MCPToolCaller {
  callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
  getConnectedServers(): string[];
}

export interface EpisodeMetadata {
  source?: string;
  tags?: string[];
  sessionId?: string;
  turnNumber?: number;
  [key: string]: unknown;
}

export interface MemorySearchOptions {
  limit?: number;
  threshold?: number;
  tags?: string[];
}

export interface MemoryEntry {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  score?: number;
  createdAt?: string;
}

/**
 * Bridge between Code Buddy and ICM MCP server
 */
export class ICMBridge {
  private mcpCaller: MCPToolCaller | null = null;
  private available = false;
  private readonly serverName = 'icm';

  /**
   * Initialize the bridge by checking if ICM server is connected
   */
  async initialize(mcpCaller: MCPToolCaller): Promise<void> {
    this.mcpCaller = mcpCaller;

    try {
      const servers = mcpCaller.getConnectedServers();
      this.available = servers.includes(this.serverName);

      if (this.available) {
        logger.info('ICM memory bridge initialized');
      } else {
        logger.debug('ICM MCP server not connected — memory bridge inactive');
      }
    } catch (error) {
      logger.warn('Failed to initialize ICM bridge', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.available = false;
    }
  }

  /**
   * Check if ICM MCP server is connected and available
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Store an episode (conversation turn, event) in ICM memory
   */
  async storeEpisode(content: string, metadata?: EpisodeMetadata): Promise<void> {
    if (!this.available || !this.mcpCaller) return;

    try {
      await this.mcpCaller.callTool(this.serverName, 'create_memory', {
        content,
        metadata: metadata || {},
      });
      logger.debug('Stored episode in ICM', { contentLength: content.length });
    } catch (error) {
      logger.warn('Failed to store episode in ICM', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Search ICM memory for relevant entries
   */
  async searchMemory(query: string, options?: MemorySearchOptions): Promise<MemoryEntry[]> {
    if (!this.available || !this.mcpCaller) return [];

    try {
      const result = await this.mcpCaller.callTool(this.serverName, 'search_memory', {
        query,
        limit: options?.limit ?? 10,
        threshold: options?.threshold,
        tags: options?.tags,
      });

      // ICM returns results as an array of memory entries
      if (Array.isArray(result)) {
        return result as MemoryEntry[];
      }

      // Handle wrapped response
      const response = result as Record<string, unknown>;
      if (Array.isArray(response.memories)) {
        return response.memories as MemoryEntry[];
      }

      return [];
    } catch (error) {
      logger.warn('ICM memory search failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get recent memories/episodes from ICM
   */
  async getRecentContext(limit = 10): Promise<MemoryEntry[]> {
    if (!this.available || !this.mcpCaller) return [];

    try {
      const result = await this.mcpCaller.callTool(this.serverName, 'get_recent_memories', {
        limit,
      });

      if (Array.isArray(result)) {
        return result as MemoryEntry[];
      }

      const response = result as Record<string, unknown>;
      if (Array.isArray(response.memories)) {
        return response.memories as MemoryEntry[];
      }

      return [];
    } catch (error) {
      logger.warn('ICM get recent context failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
