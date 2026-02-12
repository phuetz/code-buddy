/**
 * Memory Repository
 *
 * Repository for persistent memory storage with vector embeddings.
 */

import type Database from 'better-sqlite3';
import type { Memory, MemoryType } from '../schema.js';
import { getDatabaseManager } from '../database-manager.js';

// ============================================================================
// Types
// ============================================================================

export interface MemoryFilter {
  type?: MemoryType | MemoryType[];
  scope?: 'user' | 'project';
  projectId?: string;
  minImportance?: number;
  limit?: number;
  offset?: number;
}

export interface MemorySearchResult {
  memory: Memory;
  similarity: number;
}

// ============================================================================
// Memory Repository
// ============================================================================

export class MemoryRepository {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db || getDatabaseManager().getDatabase();
  }

  /**
   * Create a new memory
   */
  create(memory: Omit<Memory, 'access_count' | 'created_at' | 'last_accessed'>): Memory {
    const stmt = this.db.prepare(`
      INSERT INTO memories (id, type, scope, project_id, content, embedding, importance, metadata, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, project_id, content) DO UPDATE SET
        importance = MAX(memories.importance, excluded.importance),
        access_count = memories.access_count + 1,
        last_accessed = CURRENT_TIMESTAMP
      RETURNING *
    `);

    const embeddingBlob = memory.embedding
      ? Buffer.from(new Uint8Array(memory.embedding.buffer.slice(0)))
      : null;

    const result = stmt.get(
      memory.id,
      memory.type,
      memory.scope,
      memory.project_id || null,
      memory.content,
      embeddingBlob,
      memory.importance,
      memory.metadata ? JSON.stringify(memory.metadata) : null,
      memory.expires_at || null
    ) as Memory & { embedding: Buffer | null; metadata: string | null };

    return this.deserializeMemory(result);
  }

  /**
   * Get memory by ID
   */
  getById(id: string): Memory | null {
    const stmt = this.db.prepare('SELECT * FROM memories WHERE id = ?');
    const result = stmt.get(id) as (Memory & { embedding: Buffer | null; metadata: string | null }) | undefined;

    if (!result) return null;

    // Update access stats
    this.db.prepare(`
      UPDATE memories SET access_count = access_count + 1, last_accessed = CURRENT_TIMESTAMP WHERE id = ?
    `).run(id);

    return this.deserializeMemory(result);
  }

  /**
   * Find memories by filter
   */
  find(filter: MemoryFilter = {}): Memory[] {
    let sql = 'SELECT * FROM memories WHERE 1=1';
    const params: unknown[] = [];

    if (filter.type) {
      if (Array.isArray(filter.type)) {
        sql += ` AND type IN (${filter.type.map(() => '?').join(',')})`;
        params.push(...filter.type);
      } else {
        sql += ' AND type = ?';
        params.push(filter.type);
      }
    }

    if (filter.scope) {
      sql += ' AND scope = ?';
      params.push(filter.scope);
    }

    if (filter.projectId) {
      sql += ' AND project_id = ?';
      params.push(filter.projectId);
    }

    if (filter.minImportance !== undefined) {
      sql += ' AND importance >= ?';
      params.push(filter.minImportance);
    }

    // Exclude expired memories
    sql += ' AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)';

    sql += ' ORDER BY importance DESC, last_accessed DESC';

    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    if (filter.offset) {
      sql += ' OFFSET ?';
      params.push(filter.offset);
    }

    const stmt = this.db.prepare(sql);
    const results = stmt.all(...params) as (Memory & { embedding: Buffer | null; metadata: string | null })[];

    return results.map(r => this.deserializeMemory(r));
  }

  /**
   * Search memories by semantic similarity
   */
  searchSimilar(embedding: Float32Array, filter: MemoryFilter = {}, topK: number = 10): MemorySearchResult[] {
    // Get all candidate memories
    const candidates = this.find({ ...filter, limit: 100 });

    // Calculate cosine similarity for each
    const results: MemorySearchResult[] = [];

    for (const memory of candidates) {
      if (!memory.embedding) continue;

      const similarity = this.cosineSimilarity(embedding, memory.embedding);
      results.push({ memory, similarity });
    }

    // Sort by similarity and return top K
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  /**
   * Update memory
   */
  update(id: string, updates: Partial<Omit<Memory, 'id' | 'created_at'>>): boolean {
    const fields: string[] = [];
    const params: unknown[] = [];

    if (updates.type !== undefined) {
      fields.push('type = ?');
      params.push(updates.type);
    }
    if (updates.scope !== undefined) {
      fields.push('scope = ?');
      params.push(updates.scope);
    }
    if (updates.project_id !== undefined) {
      fields.push('project_id = ?');
      params.push(updates.project_id);
    }
    if (updates.content !== undefined) {
      fields.push('content = ?');
      params.push(updates.content);
    }
    if (updates.embedding !== undefined) {
      fields.push('embedding = ?');
      params.push(Buffer.from(updates.embedding.buffer));
    }
    if (updates.importance !== undefined) {
      fields.push('importance = ?');
      params.push(updates.importance);
    }
    if (updates.metadata !== undefined) {
      fields.push('metadata = ?');
      params.push(JSON.stringify(updates.metadata));
    }
    if (updates.expires_at !== undefined) {
      fields.push('expires_at = ?');
      params.push(updates.expires_at);
    }

    if (fields.length === 0) return false;

    params.push(id);
    const stmt = this.db.prepare(`UPDATE memories SET ${fields.join(', ')} WHERE id = ?`);
    const result = stmt.run(...params);

    return result.changes > 0;
  }

  /**
   * Delete memory
   */
  delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM memories WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Delete expired memories
   */
  deleteExpired(): number {
    const stmt = this.db.prepare('DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP');
    const result = stmt.run();
    return result.changes;
  }

  /**
   * Get memory statistics
   */
  getStats(): {
    total: number;
    byType: Record<MemoryType, number>;
    byScope: Record<string, number>;
    avgImportance: number;
  } {
    const total = (this.db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number }).count;

    const byTypeRows = this.db.prepare('SELECT type, COUNT(*) as count FROM memories GROUP BY type').all() as { type: MemoryType; count: number }[];
    const byType = {} as Record<MemoryType, number>;
    for (const row of byTypeRows) {
      byType[row.type] = row.count;
    }

    const byScopeRows = this.db.prepare('SELECT scope, COUNT(*) as count FROM memories GROUP BY scope').all() as { scope: string; count: number }[];
    const byScope: Record<string, number> = {};
    for (const row of byScopeRows) {
      byScope[row.scope] = row.count;
    }

    const avgRow = this.db.prepare('SELECT AVG(importance) as avg FROM memories').get() as { avg: number | null };
    const avgImportance = avgRow.avg || 0;

    return { total, byType, byScope, avgImportance };
  }

  /**
   * Bulk insert memories
   */
  bulkCreate(memories: Omit<Memory, 'access_count' | 'created_at' | 'last_accessed'>[]): number {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO memories (id, type, scope, project_id, content, embedding, importance, metadata, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items: typeof memories) => {
      let count = 0;
      for (const memory of items) {
        const embeddingBlob = memory.embedding
          ? Buffer.from(memory.embedding.buffer)
          : null;

        const result = stmt.run(
          memory.id,
          memory.type,
          memory.scope,
          memory.project_id || null,
          memory.content,
          embeddingBlob,
          memory.importance,
          memory.metadata ? JSON.stringify(memory.metadata) : null,
          memory.expires_at || null
        );
        if (result.changes > 0) count++;
      }
      return count;
    });

    return insertMany(memories);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private deserializeMemory(row: Omit<Memory, 'embedding' | 'metadata'> & { embedding: Buffer | null; metadata: string | null }): Memory {
    let embedding: Float32Array | undefined;
    if (row.embedding) {
      const buf = row.embedding as Buffer;
      embedding = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    }
    return {
      ...row,
      embedding,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

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

let instance: MemoryRepository | null = null;

export function getMemoryRepository(): MemoryRepository {
  if (!instance) {
    instance = new MemoryRepository();
  }
  return instance;
}

export function resetMemoryRepository(): void {
  instance = null;
}
