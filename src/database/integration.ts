/**
 * Database Integration Layer
 *
 * Provides a unified interface for integrating the SQLite database
 * with existing components. This module bridges the old JSON-based
 * storage with the new database system.
 */

import { EventEmitter } from 'events';
// Import directly from source modules to avoid circular dependency with index.ts
import { initializeDatabase, getDatabaseManager } from './database-manager.js';
import { needsMigration, runMigration } from './migration.js';
import { getMemoryRepository, type MemoryFilter } from './repositories/memory-repository.js';
import { getSessionRepository } from './repositories/session-repository.js';
import { getEmbeddingRepository } from './repositories/embedding-repository.js';
import { getCacheRepository } from './repositories/cache-repository.js';
import { initializeEmbeddingProvider, getEmbeddingProvider } from '../embeddings/index.js';
import { getPersistentLearning } from '../learning/index.js';
import { getPersistentAnalytics } from '../analytics/index.js';
import type { Memory, MemoryType, Session, Message } from './schema.js';

// ============================================================================
// Types
// ============================================================================

export interface DatabaseIntegrationConfig {
  dbPath?: string;
  inMemory?: boolean;
  autoMigrate?: boolean;
  embeddingProvider?: 'local' | 'openai' | 'grok' | 'mock';
}

export interface MemoryAddOptions {
  type: MemoryType;
  scope?: 'user' | 'project';
  projectId?: string;
  importance?: number;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
  generateEmbedding?: boolean;
}

export interface MemorySearchOptions {
  type?: MemoryType | MemoryType[];
  scope?: 'user' | 'project';
  projectId?: string;
  minImportance?: number;
  limit?: number;
  semantic?: boolean;
}

// ============================================================================
// Database Integration Class
// ============================================================================

export class DatabaseIntegration extends EventEmitter {
  private initialized: boolean = false;
  private config: DatabaseIntegrationConfig;

  constructor(config: DatabaseIntegrationConfig = {}) {
    super();
    this.config = config;
  }

  /**
   * Initialize the database system
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Initialize database
    await initializeDatabase({
      dbPath: this.config.dbPath,
      inMemory: this.config.inMemory,
    });

    // Check for and run migration if needed
    if (this.config.autoMigrate !== false && needsMigration()) {
      this.emit('migration:starting');
      const result = await runMigration({ verbose: false });
      this.emit('migration:complete', result);
    }

    // Initialize embedding provider (will fall back to mock if local fails)
    try {
      await initializeEmbeddingProvider({
        provider: this.config.embeddingProvider || 'local',
      });
    } catch {
      // Continue without embeddings - mock will be used
      this.emit('warning', { type: 'embeddings', message: 'Using mock embeddings' });
    }

    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ============================================================================
  // Memory Operations
  // ============================================================================

  /**
   * Add a memory
   */
  async addMemory(content: string, options: MemoryAddOptions): Promise<Memory> {
    const memoryRepo = getMemoryRepository();
    const embeddingProvider = getEmbeddingProvider();

    // Generate embedding if requested
    let embedding: Float32Array | undefined;
    if (options.generateEmbedding !== false) {
      try {
        const result = await embeddingProvider.embed(content);
        embedding = result.embedding;
      } catch {
        // Continue without embedding
      }
    }

    return memoryRepo.create({
      id: this.generateId(),
      type: options.type,
      scope: options.scope || 'user',
      project_id: options.projectId,
      content,
      embedding,
      importance: options.importance || 0.5,
      expires_at: options.expiresAt?.toISOString(),
      metadata: options.metadata,
    });
  }

  /**
   * Search memories
   */
  async searchMemories(
    query: string,
    options: MemorySearchOptions = {}
  ): Promise<{ memory: Memory; similarity?: number }[]> {
    const memoryRepo = getMemoryRepository();

    if (options.semantic) {
      // Semantic search using embeddings
      const embeddingProvider = getEmbeddingProvider();
      const queryResult = await embeddingProvider.embed(query);

      const filter: MemoryFilter = {
        type: options.type,
        scope: options.scope,
        projectId: options.projectId,
        minImportance: options.minImportance,
      };

      const results = memoryRepo.searchSimilar(queryResult.embedding, filter, options.limit || 10);
      return results.map(r => ({ memory: r.memory, similarity: r.similarity }));
    } else {
      // Keyword search
      const filter: MemoryFilter = {
        type: options.type,
        scope: options.scope,
        projectId: options.projectId,
        minImportance: options.minImportance,
        limit: options.limit,
      };

      const memories = memoryRepo.find(filter);
      // Simple keyword matching
      const queryLower = query.toLowerCase();
      return memories
        .filter(m => m.content.toLowerCase().includes(queryLower))
        .map(m => ({ memory: m }));
    }
  }

  /**
   * Get memories by filter
   */
  getMemories(filter: MemoryFilter = {}): Memory[] {
    return getMemoryRepository().find(filter);
  }

  /**
   * Update memory importance
   */
  updateMemoryImportance(id: string, importance: number): boolean {
    return getMemoryRepository().update(id, { importance });
  }

  /**
   * Delete memory
   */
  deleteMemory(id: string): boolean {
    return getMemoryRepository().delete(id);
  }

  // ============================================================================
  // Session Operations
  // ============================================================================

  /**
   * Create a new session
   */
  createSession(options: {
    projectId?: string;
    projectPath?: string;
    name?: string;
    model?: string;
  } = {}): Session {
    const sessionRepo = getSessionRepository();
    const analytics = getPersistentAnalytics();

    // Record session in analytics
    analytics.recordSession(options.projectId);

    return sessionRepo.createSession({
      id: this.generateId(),
      project_id: options.projectId,
      project_path: options.projectPath,
      name: options.name,
      model: options.model,
    });
  }

  /**
   * Get session by ID
   */
  getSession(id: string): Session | null {
    return getSessionRepository().getSessionById(id);
  }

  /**
   * Add message to session
   */
  addMessage(
    sessionId: string,
    role: 'user' | 'assistant' | 'system' | 'tool',
    content?: string,
    options: {
      toolCalls?: unknown[];
      toolCallId?: string;
      tokens?: number;
    } = {}
  ): Message {
    return getSessionRepository().addMessage({
      session_id: sessionId,
      role,
      content,
      tool_calls: options.toolCalls,
      tool_call_id: options.toolCallId,
      tokens: options.tokens,
    });
  }

  /**
   * Get messages for session
   */
  getMessages(sessionId: string, limit?: number): Message[] {
    return getSessionRepository().getMessages(sessionId, limit);
  }

  /**
   * Update session stats
   */
  updateSessionStats(
    sessionId: string,
    stats: {
      tokensIn?: number;
      tokensOut?: number;
      cost?: number;
      toolCalls?: number;
    }
  ): void {
    getSessionRepository().updateSessionStats(sessionId, stats);

    // Also record in analytics
    if (stats.tokensIn || stats.tokensOut || stats.cost) {
      const session = this.getSession(sessionId);
      const analytics = getPersistentAnalytics();

      analytics.record({
        model: session?.model || 'unknown',
        tokensIn: stats.tokensIn || 0,
        tokensOut: stats.tokensOut || 0,
        cost: stats.cost || 0,
        responseTimeMs: 0,
        cacheHit: false,
        toolCalls: stats.toolCalls,
        projectId: session?.project_id,
      });
    }
  }

  /**
   * Get recent sessions
   */
  getRecentSessions(limit: number = 10): Session[] {
    return getSessionRepository().findSessions({ limit, isArchived: false });
  }

  // ============================================================================
  // Learning Operations
  // ============================================================================

  /**
   * Record repair attempt
   */
  recordRepairAttempt(
    errorMessage: string,
    errorType: 'compile' | 'runtime' | 'test' | 'lint' | 'type',
    strategy: string,
    success: boolean,
    attempts: number,
    options: {
      language?: string;
      framework?: string;
      fixCode?: string;
    } = {}
  ): void {
    const learning = getPersistentLearning();
    learning.recordRepairAttempt({
      errorMessage,
      errorType,
      strategy,
      success,
      attempts,
      ...options,
    });
  }

  /**
   * Get best repair strategies
   */
  getBestRepairStrategies(
    errorMessage: string,
    options: {
      errorType?: 'compile' | 'runtime' | 'test' | 'lint' | 'type';
      language?: string;
      limit?: number;
    } = {}
  ): { strategy: string; successRate: number }[] {
    const learning = getPersistentLearning();
    const strategies = learning.getBestRepairStrategies(errorMessage, options);
    return strategies.map(s => ({
      strategy: s.strategy,
      successRate: s.success_rate,
    }));
  }

  /**
   * Record tool usage
   */
  recordToolUsage(
    toolName: string,
    success: boolean,
    timeMs: number,
    cacheHit: boolean,
    projectId?: string
  ): void {
    const learning = getPersistentLearning();
    learning.recordToolUsage({ toolName, success, timeMs, cacheHit, projectId });
  }

  // ============================================================================
  // Analytics Operations
  // ============================================================================

  /**
   * Get cost summary
   */
  getCostSummary(): {
    session: number;
    daily: number;
    weekly: number;
    monthly: number;
  } {
    const analytics = getPersistentAnalytics();
    return {
      session: analytics.getSessionCost(),
      daily: analytics.getDailyCost(),
      weekly: analytics.getWeeklyCost(),
      monthly: analytics.getMonthlyCost(),
    };
  }

  /**
   * Get analytics dashboard
   */
  getAnalyticsDashboard(): string {
    return getPersistentAnalytics().formatDashboard();
  }

  /**
   * Get learning stats
   */
  getLearningStats(): string {
    return getPersistentLearning().formatStats();
  }

  // ============================================================================
  // Cache Operations
  // ============================================================================

  /**
   * Get cached value
   */
  getCached<T>(key: string): T | null {
    return getCacheRepository().get<T>(key);
  }

  /**
   * Set cached value
   */
  setCached<T>(key: string, value: T, ttlMs?: number): void {
    getCacheRepository().set(key, value, { ttlMs });
  }

  /**
   * Get or compute cached value
   */
  async getOrComputeCached<T>(
    key: string,
    computeFn: () => Promise<T>,
    ttlMs?: number
  ): Promise<T> {
    const result = await getCacheRepository().getOrCompute(key, computeFn, { ttlMs });
    return result.value;
  }

  // ============================================================================
  // Code Embedding Operations
  // ============================================================================

  /**
   * Index code chunk
   */
  async indexCodeChunk(
    projectId: string,
    filePath: string,
    chunkIndex: number,
    chunkText: string,
    options: {
      symbolType?: string;
      symbolName?: string;
      startLine?: number;
      endLine?: number;
      language?: string;
    } = {}
  ): Promise<void> {
    const embeddingRepo = getEmbeddingRepository();
    const embeddingProvider = getEmbeddingProvider();

    // Generate embedding
    const result = await embeddingProvider.embed(chunkText);

    // Create hash for change detection
    const hash = this.hashString(chunkText);

    embeddingRepo.upsert({
      project_id: projectId,
      file_path: filePath,
      chunk_index: chunkIndex,
      chunk_text: chunkText,
      chunk_hash: hash,
      embedding: result.embedding,
      ...options,
    });
  }

  /**
   * Search code semantically
   */
  async searchCode(
    query: string,
    projectId: string,
    options: { limit?: number; symbolType?: string } = {}
  ): Promise<{ filePath: string; chunkText: string; similarity: number }[]> {
    const embeddingRepo = getEmbeddingRepository();
    const embeddingProvider = getEmbeddingProvider();

    const queryResult = await embeddingProvider.embed(query);

    const results = embeddingRepo.searchSimilar(
      queryResult.embedding,
      { projectId, symbolType: options.symbolType },
      options.limit || 10
    );

    return results.map(r => ({
      filePath: r.embedding.file_path,
      chunkText: r.embedding.chunk_text,
      similarity: r.similarity,
    }));
  }

  // ============================================================================
  // Database Stats
  // ============================================================================

  /**
   * Get database statistics
   */
  getStats(): {
    database: ReturnType<typeof getDatabaseManager.prototype.getStats>;
    memory: ReturnType<typeof getMemoryRepository.prototype.getStats>;
    session: ReturnType<typeof getSessionRepository.prototype.getStats>;
    embedding: ReturnType<typeof getEmbeddingRepository.prototype.getStats>;
    cache: ReturnType<typeof getCacheRepository.prototype.getStats>;
  } {
    return {
      database: getDatabaseManager().getStats(),
      memory: getMemoryRepository().getStats(),
      session: getSessionRepository().getStats(),
      embedding: getEmbeddingRepository().getStats(),
      cache: getCacheRepository().getStats(),
    };
  }

  /**
   * Format stats for display
   */
  formatStats(): string {
    return getDatabaseManager().formatStats();
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: DatabaseIntegration | null = null;

export function getDatabaseIntegration(config?: DatabaseIntegrationConfig): DatabaseIntegration {
  if (!instance) {
    instance = new DatabaseIntegration(config);
  }
  return instance;
}

export async function initializeDatabaseIntegration(config?: DatabaseIntegrationConfig): Promise<DatabaseIntegration> {
  const integration = getDatabaseIntegration(config);
  if (!integration.isInitialized()) {
    await integration.initialize();
  }
  return integration;
}

export function resetDatabaseIntegration(): void {
  instance = null;
}
