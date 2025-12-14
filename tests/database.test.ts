/**
 * Database System Tests
 *
 * Comprehensive tests for SQLite database, repositories, and integration.
 */

import {
  getDatabaseManager,
  resetDatabaseManager,
  initializeDatabase,
} from '../src/database/database-manager.js';
import {
  MemoryRepository,
  getMemoryRepository,
  resetMemoryRepository,
} from '../src/database/repositories/memory-repository.js';
import {
  SessionRepository,
  getSessionRepository,
  resetSessionRepository,
} from '../src/database/repositories/session-repository.js';
import {
  AnalyticsRepository,
  getAnalyticsRepository,
  resetAnalyticsRepository,
} from '../src/database/repositories/analytics-repository.js';
import {
  EmbeddingRepository,
  getEmbeddingRepository,
  resetEmbeddingRepository,
} from '../src/database/repositories/embedding-repository.js';
import {
  CacheRepository,
  getCacheRepository,
  resetCacheRepository,
} from '../src/database/repositories/cache-repository.js';
import type { MemoryType } from '../src/database/schema.js';

// ============================================================================
// Test Setup
// ============================================================================

describe('Database System', () => {
  beforeAll(async () => {
    // Initialize in-memory database for tests
    await initializeDatabase({ inMemory: true });
  });

  afterAll(() => {
    resetMemoryRepository();
    resetSessionRepository();
    resetAnalyticsRepository();
    resetEmbeddingRepository();
    resetCacheRepository();
    resetDatabaseManager();
  });

  // ============================================================================
  // DatabaseManager Tests
  // ============================================================================

  describe('DatabaseManager', () => {
    it('should initialize successfully', () => {
      const manager = getDatabaseManager();
      expect(manager.isInitialized()).toBe(true);
    });

    it('should return database instance', () => {
      const manager = getDatabaseManager();
      const db = manager.getDatabase();
      expect(db).toBeDefined();
    });

    it('should return stats', () => {
      const manager = getDatabaseManager();
      const stats = manager.getStats();

      expect(stats).toHaveProperty('version');
      expect(stats).toHaveProperty('tables');
      expect(stats).toHaveProperty('memoriesCount');
      expect(stats).toHaveProperty('sessionsCount');
      expect(Array.isArray(stats.tables)).toBe(true);
    });

    it('should format stats for display', () => {
      const manager = getDatabaseManager();
      const formatted = manager.formatStats();

      expect(typeof formatted).toBe('string');
      expect(formatted).toContain('Database Statistics');
    });

    it('should execute raw SQL', () => {
      const manager = getDatabaseManager();
      expect(() => {
        manager.exec('SELECT 1');
      }).not.toThrow();
    });

    it('should prepare statements', () => {
      const manager = getDatabaseManager();
      const stmt = manager.prepare('SELECT 1 as value');
      const result = stmt.get() as { value: number };

      expect(result.value).toBe(1);
    });

    it('should run transactions', () => {
      const manager = getDatabaseManager();
      const result = manager.transaction(() => {
        return 42;
      });

      expect(result).toBe(42);
    });
  });

  // ============================================================================
  // MemoryRepository Tests
  // ============================================================================

  describe('MemoryRepository', () => {
    let repo: MemoryRepository;

    beforeEach(() => {
      repo = getMemoryRepository();
    });

    it('should create a memory', () => {
      const memory = repo.create({
        id: 'test-memory-1',
        type: 'fact' as MemoryType,
        scope: 'user',
        content: 'Test memory content',
        importance: 0.8,
      });

      expect(memory.id).toBe('test-memory-1');
      expect(memory.type).toBe('fact');
      expect(memory.content).toBe('Test memory content');
      expect(memory.importance).toBe(0.8);
    });

    it('should get memory by ID', () => {
      const memory = repo.getById('test-memory-1');

      expect(memory).not.toBeNull();
      expect(memory?.content).toBe('Test memory content');
    });

    it('should find memories by filter', () => {
      // Create additional memories
      repo.create({
        id: 'test-memory-2',
        type: 'preference' as MemoryType,
        scope: 'user',
        content: 'User prefers dark mode',
        importance: 0.6,
      });

      const memories = repo.find({ type: 'fact' });
      expect(memories.length).toBeGreaterThanOrEqual(1);
      expect(memories.every(m => m.type === 'fact')).toBe(true);
    });

    it('should find memories by scope', () => {
      const memories = repo.find({ scope: 'user' });
      expect(memories.length).toBeGreaterThanOrEqual(1);
      expect(memories.every(m => m.scope === 'user')).toBe(true);
    });

    it('should find memories by minimum importance', () => {
      const memories = repo.find({ minImportance: 0.7 });
      expect(memories.every(m => m.importance >= 0.7)).toBe(true);
    });

    it('should update memory', () => {
      const updated = repo.update('test-memory-1', { importance: 0.9 });
      expect(updated).toBe(true);

      const memory = repo.getById('test-memory-1');
      expect(memory?.importance).toBe(0.9);
    });

    it('should create memory with embedding', () => {
      const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);

      const memory = repo.create({
        id: 'test-memory-embed',
        type: 'pattern' as MemoryType,
        scope: 'project',
        project_id: 'test-project',
        content: 'Code pattern with embedding',
        embedding,
        importance: 0.7,
      });

      expect(memory.embedding).toBeDefined();
      expect(memory.embedding?.length).toBe(4);
    });

    it('should search by semantic similarity', () => {
      const queryEmbedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);

      const results = repo.searchSimilar(queryEmbedding, {}, 5);

      expect(Array.isArray(results)).toBe(true);
      // Results should be sorted by similarity
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
      }
    });

    it('should get stats', () => {
      const stats = repo.getStats();

      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('byType');
      expect(stats).toHaveProperty('byScope');
      expect(stats).toHaveProperty('avgImportance');
      expect(stats.total).toBeGreaterThanOrEqual(1);
    });

    it('should bulk create memories', () => {
      const memories = [
        { id: 'bulk-1', type: 'fact' as MemoryType, scope: 'user' as const, content: 'Bulk 1', importance: 0.5 },
        { id: 'bulk-2', type: 'fact' as MemoryType, scope: 'user' as const, content: 'Bulk 2', importance: 0.5 },
        { id: 'bulk-3', type: 'fact' as MemoryType, scope: 'user' as const, content: 'Bulk 3', importance: 0.5 },
      ];

      const count = repo.bulkCreate(memories);
      expect(count).toBe(3);
    });

    it('should delete memory', () => {
      const deleted = repo.delete('test-memory-2');
      expect(deleted).toBe(true);

      const memory = repo.getById('test-memory-2');
      expect(memory).toBeNull();
    });
  });

  // ============================================================================
  // SessionRepository Tests
  // ============================================================================

  describe('SessionRepository', () => {
    let repo: SessionRepository;

    beforeEach(() => {
      repo = getSessionRepository();
    });

    it('should create a session', () => {
      const session = repo.createSession({
        id: 'test-session-1',
        project_id: 'test-project',
        name: 'Test Session',
        model: 'grok-beta',
      });

      expect(session.id).toBe('test-session-1');
      expect(session.name).toBe('Test Session');
      expect(session.model).toBe('grok-beta');
      expect(session.message_count).toBe(0);
    });

    it('should get session by ID', () => {
      const session = repo.getSessionById('test-session-1');

      expect(session).not.toBeNull();
      expect(session?.name).toBe('Test Session');
    });

    it('should add messages to session', () => {
      const message1 = repo.addMessage({
        session_id: 'test-session-1',
        role: 'user',
        content: 'Hello, AI!',
        tokens: 10,
      });

      expect(message1.role).toBe('user');
      expect(message1.content).toBe('Hello, AI!');

      const message2 = repo.addMessage({
        session_id: 'test-session-1',
        role: 'assistant',
        content: 'Hello! How can I help you?',
        tokens: 15,
      });

      expect(message2.role).toBe('assistant');

      // Session message count should be updated
      const session = repo.getSessionById('test-session-1');
      expect(session?.message_count).toBe(2);
    });

    it('should get messages for session', () => {
      const messages = repo.getMessages('test-session-1');

      expect(messages.length).toBe(2);
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
    });

    it('should get recent messages', () => {
      const messages = repo.getRecentMessages('test-session-1', 1);
      expect(messages.length).toBe(1);
    });

    it('should update session stats', () => {
      const updated = repo.updateSessionStats('test-session-1', {
        tokensIn: 100,
        tokensOut: 200,
        cost: 0.05,
        toolCalls: 3,
      });

      expect(updated).toBe(true);

      const session = repo.getSessionById('test-session-1');
      expect(session?.total_tokens_in).toBe(100);
      expect(session?.total_tokens_out).toBe(200);
      expect(session?.total_cost).toBe(0.05);
      expect(session?.tool_calls_count).toBe(3);
    });

    it('should find sessions by filter', () => {
      const sessions = repo.findSessions({ projectId: 'test-project' });

      expect(sessions.length).toBeGreaterThanOrEqual(1);
      expect(sessions.every(s => s.project_id === 'test-project')).toBe(true);
    });

    it('should get session with messages', () => {
      const sessionWithMessages = repo.getSessionWithMessages('test-session-1');

      expect(sessionWithMessages).not.toBeNull();
      expect(sessionWithMessages?.messages.length).toBe(2);
    });

    it('should archive session', () => {
      const archived = repo.setArchived('test-session-1', true);
      expect(archived).toBe(true);

      const session = repo.getSessionById('test-session-1');
      expect(session?.is_archived).toBe(true);
    });

    it('should get stats', () => {
      const stats = repo.getStats();

      expect(stats).toHaveProperty('totalSessions');
      expect(stats).toHaveProperty('totalMessages');
      expect(stats).toHaveProperty('totalCost');
      expect(stats.totalSessions).toBeGreaterThanOrEqual(1);
    });

    it('should get cost by model', () => {
      const costs = repo.getCostByModel();

      expect(Array.isArray(costs)).toBe(true);
    });
  });

  // ============================================================================
  // AnalyticsRepository Tests
  // ============================================================================

  describe('AnalyticsRepository', () => {
    let repo: AnalyticsRepository;

    beforeEach(() => {
      repo = getAnalyticsRepository();
    });

    it('should record analytics', () => {
      const today = new Date().toISOString().split('T')[0];

      expect(() => {
        repo.recordAnalytics({
          date: today,
          model: 'grok-beta',
          tokens_in: 1000,
          tokens_out: 500,
          cost: 0.10,
          requests: 5,
          tool_calls: 10,
          errors: 0,
          avg_response_time_ms: 250,
          cache_hit_rate: 0.5,
          session_count: 1,
        });
      }).not.toThrow();
    });

    it('should aggregate analytics on conflict', () => {
      const today = new Date().toISOString().split('T')[0];
      const uniqueModel = `test-model-${Date.now()}`;
      const uniqueProjectId = `test-project-${Date.now()}`;

      // First record - must use explicit project_id (SQLite treats NULL != NULL in UNIQUE)
      repo.recordAnalytics({
        date: today,
        project_id: uniqueProjectId,
        model: uniqueModel,
        tokens_in: 1000,
        tokens_out: 500,
        cost: 0.10,
        requests: 5,
        tool_calls: 10,
        errors: 0,
        avg_response_time_ms: 250,
        cache_hit_rate: 0.5,
        session_count: 1,
      });

      // Second record with same date/model/project_id should aggregate via ON CONFLICT
      repo.recordAnalytics({
        date: today,
        project_id: uniqueProjectId,
        model: uniqueModel,
        tokens_in: 500,
        tokens_out: 250,
        cost: 0.05,
        requests: 3,
        tool_calls: 5,
        errors: 1,
        avg_response_time_ms: 200,
        cache_hit_rate: 0.6,
        session_count: 0,
      });

      const analytics = repo.getAnalytics({ model: uniqueModel, projectId: uniqueProjectId });
      const todayData = analytics.find(a => a.date === today);

      expect(todayData).toBeDefined();
      expect(todayData?.tokens_in).toBe(1500); // 1000 + 500
      expect(todayData?.requests).toBe(8); // 5 + 3
    });

    it('should get analytics by filter', () => {
      const analytics = repo.getAnalytics({ model: 'grok-beta' });

      expect(Array.isArray(analytics)).toBe(true);
      expect(analytics.every(a => a.model === 'grok-beta')).toBe(true);
    });

    it('should get daily summary', () => {
      const summary = repo.getDailySummary(7);

      expect(Array.isArray(summary)).toBe(true);
    });

    it('should get total cost', () => {
      const cost = repo.getTotalCost({});
      expect(typeof cost).toBe('number');
      expect(cost).toBeGreaterThanOrEqual(0);
    });

    it('should record tool usage', () => {
      expect(() => {
        repo.recordToolUsage('search', true, 150, false, 'test-project');
        repo.recordToolUsage('search', true, 120, true, 'test-project');
        repo.recordToolUsage('search', false, 200, false, 'test-project');
      }).not.toThrow();
    });

    it('should get tool stats', () => {
      const stats = repo.getToolStats('test-project');

      expect(Array.isArray(stats)).toBe(true);
      const searchStats = stats.find(s => s.tool_name === 'search');
      expect(searchStats).toBeDefined();
      expect(searchStats?.success_count).toBe(2);
      expect(searchStats?.failure_count).toBe(1);
    });

    it('should get top tools', () => {
      const topTools = repo.getTopTools(5);

      expect(Array.isArray(topTools)).toBe(true);
    });

    it('should record repair attempt', () => {
      expect(() => {
        repo.recordRepairAttempt(
          'TypeError: undefined is not a function',
          'runtime',
          'null_check',
          true,
          1,
          { language: 'typescript' }
        );
      }).not.toThrow();
    });

    it('should get best repair strategies', () => {
      const strategies = repo.getBestStrategies('TypeError', {}, 5);

      expect(Array.isArray(strategies)).toBe(true);
    });

    it('should get repair stats', () => {
      const stats = repo.getRepairStats();

      expect(stats).toHaveProperty('totalPatterns');
      expect(stats).toHaveProperty('avgSuccessRate');
      expect(stats).toHaveProperty('byErrorType');
    });
  });

  // ============================================================================
  // EmbeddingRepository Tests
  // ============================================================================

  describe('EmbeddingRepository', () => {
    let repo: EmbeddingRepository;

    beforeEach(() => {
      repo = getEmbeddingRepository();
    });

    it('should upsert embedding', () => {
      const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);

      const result = repo.upsert({
        project_id: 'test-project',
        file_path: 'src/test.ts',
        chunk_index: 0,
        chunk_text: 'function hello() { return "world"; }',
        chunk_hash: 'abc123',
        embedding,
        symbol_type: 'function',
        symbol_name: 'hello',
        start_line: 1,
        end_line: 3,
        language: 'typescript',
      });

      expect(result.file_path).toBe('src/test.ts');
      expect(result.symbol_name).toBe('hello');
      expect(result.embedding.length).toBe(5);
    });

    it('should bulk upsert embeddings', () => {
      const embeddings = [
        {
          project_id: 'test-project',
          file_path: 'src/utils.ts',
          chunk_index: 0,
          chunk_text: 'const foo = 1;',
          chunk_hash: 'hash1',
          embedding: new Float32Array([0.1, 0.2, 0.3]),
          language: 'typescript',
        },
        {
          project_id: 'test-project',
          file_path: 'src/utils.ts',
          chunk_index: 1,
          chunk_text: 'const bar = 2;',
          chunk_hash: 'hash2',
          embedding: new Float32Array([0.4, 0.5, 0.6]),
          language: 'typescript',
        },
      ];

      const count = repo.bulkUpsert(embeddings);
      expect(count).toBe(2);
    });

    it('should find embeddings by filter', () => {
      const results = repo.find({ projectId: 'test-project' });

      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('should search by semantic similarity', () => {
      const queryEmbedding = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);

      const results = repo.searchSimilar(queryEmbedding, { projectId: 'test-project' }, 5);

      expect(Array.isArray(results)).toBe(true);
      // Results should be sorted by similarity
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
      }
    });

    it('should search by symbol name', () => {
      const results = repo.searchBySymbol('hello', { projectId: 'test-project' });

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(r => r.symbol_name === 'hello')).toBe(true);
    });

    it('should check if file needs reindex', () => {
      const needsReindex = repo.needsReindex('test-project', 'src/test.ts', 'different-hash');
      expect(needsReindex).toBe(true);

      const noReindex = repo.needsReindex('test-project', 'src/test.ts', 'abc123');
      expect(noReindex).toBe(false);
    });

    it('should get stats', () => {
      const stats = repo.getStats('test-project');

      expect(stats).toHaveProperty('totalEmbeddings');
      expect(stats).toHaveProperty('totalFiles');
      expect(stats).toHaveProperty('byLanguage');
      expect(stats).toHaveProperty('bySymbolType');
    });

    it('should delete embeddings for file', () => {
      const count = repo.deleteForFile('test-project', 'src/utils.ts');
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================================
  // CacheRepository Tests
  // ============================================================================

  describe('CacheRepository', () => {
    let repo: CacheRepository;

    beforeEach(() => {
      repo = getCacheRepository();
    });

    it('should set and get value', () => {
      repo.set('test-key', { foo: 'bar' });

      const value = repo.get<{ foo: string }>('test-key');
      expect(value).toEqual({ foo: 'bar' });
    });

    it('should return null for missing key', () => {
      const value = repo.get('non-existent-key');
      expect(value).toBeNull();
    });

    it('should handle TTL expiration', async () => {
      // SQLite CURRENT_TIMESTAMP has second precision, so use longer TTL
      // Set expiration to 1 second
      repo.set('expiring-key', 'value', { ttlMs: 1000 });

      // Value should exist immediately
      expect(repo.get('expiring-key')).toBe('value');

      // Wait for expiration (1.5 seconds to ensure SQLite timestamp catches up)
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Value should be expired
      expect(repo.get('expiring-key')).toBeNull();
    }, 5000); // Increase test timeout

    it('should check if key exists', () => {
      repo.set('exists-key', 'value');

      expect(repo.has('exists-key')).toBe(true);
      expect(repo.has('not-exists')).toBe(false);
    });

    it('should delete value', () => {
      repo.set('to-delete', 'value');
      expect(repo.has('to-delete')).toBe(true);

      const deleted = repo.delete('to-delete');
      expect(deleted).toBe(true);
      expect(repo.has('to-delete')).toBe(false);
    });

    it('should delete by pattern', () => {
      repo.set('pattern-1', 'a');
      repo.set('pattern-2', 'b');
      repo.set('other-key', 'c');

      const count = repo.deleteByPattern('pattern');
      expect(count).toBe(2);
      expect(repo.has('other-key')).toBe(true);
    });

    it('should delete by category', () => {
      repo.set('cat-1', 'a', { category: 'test-category' });
      repo.set('cat-2', 'b', { category: 'test-category' });
      repo.set('cat-3', 'c', { category: 'other-category' });

      const count = repo.deleteByCategory('test-category');
      expect(count).toBe(2);
    });

    it('should get or compute value', async () => {
      let computeCount = 0;

      const result1 = await repo.getOrCompute('compute-key', async () => {
        computeCount++;
        return 'computed-value';
      });

      expect(result1.value).toBe('computed-value');
      expect(result1.cached).toBe(false);
      expect(computeCount).toBe(1);

      // Second call should use cache
      const result2 = await repo.getOrCompute('compute-key', async () => {
        computeCount++;
        return 'new-value';
      });

      expect(result2.value).toBe('computed-value');
      expect(result2.cached).toBe(true);
      expect(computeCount).toBe(1); // Should not have called compute again
    });

    it('should get all keys', () => {
      repo.set('key-a', 'a');
      repo.set('key-b', 'b');

      const keys = repo.keys();
      expect(keys).toContain('key-a');
      expect(keys).toContain('key-b');
    });

    it('should get stats', () => {
      const stats = repo.getStats();

      expect(stats).toHaveProperty('totalEntries');
      expect(stats).toHaveProperty('totalHits');
      expect(stats).toHaveProperty('byCategory');
    });

    it('should search by semantic similarity', () => {
      const embedding = new Float32Array([0.1, 0.2, 0.3]);
      repo.set('semantic-key', 'value', { embedding, category: 'semantic' });

      const queryEmbedding = new Float32Array([0.1, 0.2, 0.3]);
      const results = repo.searchSimilar(queryEmbedding, 'semantic', 5);

      expect(Array.isArray(results)).toBe(true);
    });

    it('should clear all cache', () => {
      repo.set('clear-1', 'a');
      repo.set('clear-2', 'b');

      repo.clear();

      expect(repo.keys().length).toBe(0);
    });
  });
});
