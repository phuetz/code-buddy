/**
 * Cache Repository
 *
 * Repository for general-purpose caching with TTL.
 */

import type Database from 'better-sqlite3';
import { getDatabaseManager } from '../database-manager.js';

// ============================================================================
// Types
// ============================================================================

export interface CacheEntry {
  key: string;
  value: unknown;
  embedding?: Float32Array;
  created_at: string;
  expires_at?: string;
  hits: number;
  category?: string;
}

export interface CacheFilter {
  category?: string;
  includeExpired?: boolean;
}

// ============================================================================
// Cache Repository
// ============================================================================

export class CacheRepository {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db || getDatabaseManager().getDatabase();
  }

  /**
   * Get cached value
   */
  get<T = unknown>(key: string): T | null {
    const stmt = this.db.prepare(`
      SELECT value, expires_at FROM cache
      WHERE key = ? AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `);
    const result = stmt.get(key) as { value: string; expires_at: string | null } | undefined;

    if (!result) return null;

    // Update hit count
    this.db.prepare('UPDATE cache SET hits = hits + 1 WHERE key = ?').run(key);

    try {
      return JSON.parse(result.value) as T;
    } catch {
      // Corrupted cache entry - delete it and return null
      this.delete(key);
      return null;
    }
  }

  /**
   * Set cached value
   */
  set<T = unknown>(
    key: string,
    value: T,
    options: { ttlMs?: number; category?: string; embedding?: Float32Array } = {}
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO cache (key, value, embedding, expires_at, category)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        embedding = excluded.embedding,
        expires_at = excluded.expires_at,
        category = excluded.category,
        created_at = CURRENT_TIMESTAMP,
        hits = 0
    `);

    // Use SQLite-compatible timestamp format (YYYY-MM-DD HH:MM:SS)
    const expiresAt = options.ttlMs
      ? new Date(Date.now() + options.ttlMs).toISOString().replace('T', ' ').slice(0, 19)
      : null;

    const embeddingBlob = options.embedding
      ? Buffer.from(options.embedding.buffer)
      : null;

    stmt.run(
      key,
      JSON.stringify(value),
      embeddingBlob,
      expiresAt,
      options.category || null
    );
  }

  /**
   * Get or compute cached value
   */
  async getOrCompute<T>(
    key: string,
    computeFn: () => Promise<T>,
    options: { ttlMs?: number; category?: string } = {}
  ): Promise<{ value: T; cached: boolean }> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return { value: cached, cached: true };
    }

    const value = await computeFn();
    this.set(key, value, options);
    return { value, cached: false };
  }

  /**
   * Delete cached value
   */
  delete(key: string): boolean {
    const stmt = this.db.prepare('DELETE FROM cache WHERE key = ?');
    const result = stmt.run(key);
    return result.changes > 0;
  }

  /**
   * Delete by pattern
   */
  deleteByPattern(pattern: string | RegExp): number {
    if (typeof pattern === 'string') {
      const stmt = this.db.prepare('DELETE FROM cache WHERE key LIKE ?');
      const result = stmt.run(`%${pattern}%`);
      return result.changes;
    }

    // For regex, we need to fetch keys and filter
    const keys = this.db.prepare('SELECT key FROM cache').all() as { key: string }[];
    const matchingKeys = keys.filter(k => pattern.test(k.key)).map(k => k.key);

    if (matchingKeys.length === 0) return 0;

    const placeholders = matchingKeys.map(() => '?').join(',');
    const stmt = this.db.prepare(`DELETE FROM cache WHERE key IN (${placeholders})`);
    const result = stmt.run(...matchingKeys);
    return result.changes;
  }

  /**
   * Delete by category
   */
  deleteByCategory(category: string): number {
    const stmt = this.db.prepare('DELETE FROM cache WHERE category = ?');
    const result = stmt.run(category);
    return result.changes;
  }

  /**
   * Delete expired entries
   */
  deleteExpired(): number {
    const stmt = this.db.prepare('DELETE FROM cache WHERE expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP');
    const result = stmt.run();
    return result.changes;
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.db.exec('DELETE FROM cache');
  }

  /**
   * Check if key exists
   */
  has(key: string): boolean {
    const stmt = this.db.prepare(`
      SELECT 1 FROM cache
      WHERE key = ? AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `);
    return stmt.get(key) !== undefined;
  }

  /**
   * Get all keys
   */
  keys(filter: CacheFilter = {}): string[] {
    let sql = 'SELECT key FROM cache WHERE 1=1';
    const params: unknown[] = [];

    if (!filter.includeExpired) {
      sql += ' AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)';
    }

    if (filter.category) {
      sql += ' AND category = ?';
      params.push(filter.category);
    }

    const stmt = this.db.prepare(sql);
    const results = stmt.all(...params) as { key: string }[];
    return results.map(r => r.key);
  }

  /**
   * Search cache by semantic similarity
   */
  searchSimilar(
    queryEmbedding: Float32Array,
    category?: string,
    topK: number = 10
  ): { key: string; value: unknown; similarity: number }[] {
    let sql = `
      SELECT key, value, embedding FROM cache
      WHERE embedding IS NOT NULL
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `;
    const params: unknown[] = [];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    const stmt = this.db.prepare(sql);
    const results = stmt.all(...params) as { key: string; value: string; embedding: Buffer }[];

    // Calculate similarities
    const withSimilarity = results.map(r => {
      const embedding = new Float32Array(
        r.embedding.buffer.slice(
          r.embedding.byteOffset,
          r.embedding.byteOffset + r.embedding.byteLength
        )
      );
      let value: unknown = null;
      try {
        value = JSON.parse(r.value);
      } catch {
        // Skip corrupted entries
        value = null;
      }
      return {
        key: r.key,
        value,
        similarity: this.cosineSimilarity(queryEmbedding, embedding),
      };
    }).filter(r => r.value !== null);

    // Sort and return top K
    return withSimilarity
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    totalEntries: number;
    totalHits: number;
    byCategory: Record<string, number>;
    expiredCount: number;
  } {
    const total = (this.db.prepare('SELECT COUNT(*) as count FROM cache').get() as { count: number }).count;

    const totalHits = (this.db.prepare('SELECT SUM(hits) as total FROM cache').get() as { total: number | null }).total || 0;

    const categoryRows = this.db.prepare('SELECT category, COUNT(*) as count FROM cache GROUP BY category').all() as { category: string | null; count: number }[];

    const byCategory: Record<string, number> = {};
    for (const row of categoryRows) {
      byCategory[row.category || 'uncategorized'] = row.count;
    }

    const expiredCount = (this.db.prepare(`
      SELECT COUNT(*) as count FROM cache
      WHERE expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP
    `).get() as { count: number }).count;

    return { totalEntries: total, totalHits, byCategory, expiredCount };
  }

  /**
   * Get size estimate in bytes
   */
  getSizeEstimate(): number {
    const result = this.db.prepare(`
      SELECT SUM(LENGTH(value) + LENGTH(key) + COALESCE(LENGTH(embedding), 0)) as size
      FROM cache
    `).get() as { size: number | null };
    return result.size || 0;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: CacheRepository | null = null;

export function getCacheRepository(): CacheRepository {
  if (!instance) {
    instance = new CacheRepository();
  }
  return instance;
}

export function resetCacheRepository(): void {
  instance = null;
}
