/**
 * Vector Store
 *
 * In-memory vector store with efficient similarity search.
 * Uses brute-force search for simplicity, with optional
 * approximate nearest neighbor support for larger indices.
 */

import { VectorStore } from "./types.js";
import { cosineSimilarity } from "./embeddings.js";
import fs from "fs";
import path from "path";
import { logger } from "../../utils/logger.js";

interface VectorEntry {
  id: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

/**
 * Simple in-memory vector store
 */
export class InMemoryVectorStore implements VectorStore {
  private vectors: Map<string, VectorEntry> = new Map();
  private persistPath?: string;
  private dirty: boolean = false;
  private autoSaveInterval: NodeJS.Timeout | null = null;

  constructor(persistPath?: string) {
    this.persistPath = persistPath;
    if (persistPath) {
      this.loadFromDisk();
      this.startAutoSave();
    }
  }

  /**
   * Add a single vector
   */
  async add(
    id: string,
    embedding: number[],
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    this.vectors.set(id, { id, embedding, metadata });
    this.dirty = true;
  }

  /**
   * Add multiple vectors in batch
   */
  async addBatch(
    items: Array<{ id: string; embedding: number[]; metadata?: Record<string, unknown> }>
  ): Promise<void> {
    for (const item of items) {
      this.vectors.set(item.id, {
        id: item.id,
        embedding: item.embedding,
        metadata: item.metadata || {},
      });
    }
    this.dirty = true;
  }

  /**
   * Search for similar vectors
   */
  async search(
    embedding: number[],
    k: number,
    filter?: Record<string, unknown>
  ): Promise<Array<{ id: string; score: number }>> {
    const results: Array<{ id: string; score: number }> = [];

    for (const entry of this.vectors.values()) {
      // Apply filter if provided
      if (filter && !this.matchesFilter(entry.metadata, filter)) {
        continue;
      }

      const score = cosineSimilarity(embedding, entry.embedding);
      results.push({ id: entry.id, score });
    }

    // Sort by score descending and take top k
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /**
   * Delete a vector by ID
   */
  async delete(id: string): Promise<void> {
    this.vectors.delete(id);
    this.dirty = true;
  }

  /**
   * Delete vectors matching a filter
   */
  async deleteByFilter(filter: Record<string, unknown>): Promise<number> {
    let deleted = 0;

    for (const [id, entry] of this.vectors) {
      if (this.matchesFilter(entry.metadata, filter)) {
        this.vectors.delete(id);
        deleted++;
      }
    }

    if (deleted > 0) {
      this.dirty = true;
    }

    return deleted;
  }

  /**
   * Get count of vectors
   */
  async count(): Promise<number> {
    return this.vectors.size;
  }

  /**
   * Clear all vectors
   */
  async clear(): Promise<void> {
    this.vectors.clear();
    this.dirty = true;
  }

  /**
   * Get a vector by ID
   */
  get(id: string): VectorEntry | undefined {
    return this.vectors.get(id);
  }

  /**
   * Check if a vector exists
   */
  has(id: string): boolean {
    return this.vectors.has(id);
  }

  /**
   * Get all IDs
   */
  getAllIds(): string[] {
    return Array.from(this.vectors.keys());
  }

  /**
   * Check if metadata matches filter
   */
  private matchesFilter(
    metadata: Record<string, unknown>,
    filter: Record<string, unknown>
  ): boolean {
    for (const [key, value] of Object.entries(filter)) {
      if (metadata[key] !== value) {
        return false;
      }
    }
    return true;
  }

  /**
   * Save to disk
   */
  async saveToDisk(): Promise<void> {
    if (!this.persistPath || !this.dirty) return;

    const data = {
      version: 1,
      vectors: Array.from(this.vectors.values()),
    };

    const dir = path.dirname(this.persistPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(
      this.persistPath,
      JSON.stringify(data),
      "utf-8"
    );

    this.dirty = false;
  }

  /**
   * Load from disk
   */
  private loadFromDisk(): void {
    if (!this.persistPath || !fs.existsSync(this.persistPath)) return;

    try {
      const content = fs.readFileSync(this.persistPath, "utf-8");
      const data = JSON.parse(content);

      if (data.version === 1 && Array.isArray(data.vectors)) {
        for (const entry of data.vectors) {
          this.vectors.set(entry.id, entry);
        }
      }
    } catch (error) {
      logger.warn("Failed to load vector store from disk:", { error });
    }
  }

  /**
   * Start auto-save interval
   */
  private startAutoSave(): void {
    if (this.autoSaveInterval) return;

    this.autoSaveInterval = setInterval(() => {
      if (this.dirty) {
        this.saveToDisk().catch(err => logger.error("Failed to save vector store", { error: err }));
      }
    }, 30000); // Save every 30 seconds if dirty
  }

  /**
   * Stop auto-save and save final state
   */
  async dispose(): Promise<void> {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
    await this.saveToDisk();
  }

  /**
   * Get memory usage estimate
   */
  getMemoryUsage(): number {
    let bytes = 0;
    for (const entry of this.vectors.values()) {
      bytes += entry.id.length * 2; // String chars
      bytes += entry.embedding.length * 8; // Float64
      bytes += JSON.stringify(entry.metadata).length * 2;
    }
    return bytes;
  }
}

/**
 * Partitioned vector store for larger datasets
 * Divides vectors into partitions for faster search
 */
export class PartitionedVectorStore implements VectorStore {
  private partitions: Map<string, InMemoryVectorStore> = new Map();
  private partitionKey: string;
  private persistDir?: string;

  constructor(partitionKey: string = "language", persistDir?: string) {
    this.partitionKey = partitionKey;
    this.persistDir = persistDir;
  }

  /**
   * Get or create partition
   */
  private getPartition(metadata: Record<string, unknown>): InMemoryVectorStore {
    const key = String(metadata[this.partitionKey] || "default");

    if (!this.partitions.has(key)) {
      const persistPath = this.persistDir
        ? path.join(this.persistDir, `partition-${key}.json`)
        : undefined;
      this.partitions.set(key, new InMemoryVectorStore(persistPath));
    }

    return this.partitions.get(key)!;
  }

  /**
   * Add a single vector
   */
  async add(
    id: string,
    embedding: number[],
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    const partition = this.getPartition(metadata);
    await partition.add(id, embedding, metadata);
  }

  /**
   * Add multiple vectors in batch
   */
  async addBatch(
    items: Array<{ id: string; embedding: number[]; metadata?: Record<string, unknown> }>
  ): Promise<void> {
    // Group by partition
    const groups = new Map<string, typeof items>();

    for (const item of items) {
      const key = String(item.metadata?.[this.partitionKey] || "default");
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(item);
    }

    // Add to each partition
    for (const [key, groupItems] of groups) {
      const partition = this.getPartition({ [this.partitionKey]: key });
      await partition.addBatch(groupItems);
    }
  }

  /**
   * Search for similar vectors
   */
  async search(
    embedding: number[],
    k: number,
    filter?: Record<string, unknown>
  ): Promise<Array<{ id: string; score: number }>> {
    // If filter specifies partition, only search that one
    if (filter && this.partitionKey in filter) {
      const partition = this.partitions.get(String(filter[this.partitionKey]));
      if (!partition) return [];
      return partition.search(embedding, k, filter);
    }

    // Otherwise, search all partitions and merge
    const allResults: Array<{ id: string; score: number }> = [];

    for (const partition of this.partitions.values()) {
      const results = await partition.search(embedding, k, filter);
      allResults.push(...results);
    }

    // Sort and take top k
    return allResults
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /**
   * Delete a vector by ID
   */
  async delete(id: string): Promise<void> {
    for (const partition of this.partitions.values()) {
      if (partition.has(id)) {
        await partition.delete(id);
        return;
      }
    }
  }

  /**
   * Delete vectors matching a filter
   */
  async deleteByFilter(filter: Record<string, unknown>): Promise<number> {
    let totalDeleted = 0;

    for (const partition of this.partitions.values()) {
      totalDeleted += await partition.deleteByFilter(filter);
    }

    return totalDeleted;
  }

  /**
   * Get count of vectors
   */
  async count(): Promise<number> {
    let total = 0;
    for (const partition of this.partitions.values()) {
      total += await partition.count();
    }
    return total;
  }

  /**
   * Clear all vectors
   */
  async clear(): Promise<void> {
    for (const partition of this.partitions.values()) {
      await partition.clear();
    }
    this.partitions.clear();
  }

  /**
   * Save all partitions
   */
  async saveToDisk(): Promise<void> {
    for (const partition of this.partitions.values()) {
      await partition.saveToDisk();
    }
  }

  /**
   * Dispose all partitions
   */
  async dispose(): Promise<void> {
    for (const partition of this.partitions.values()) {
      await partition.dispose();
    }
  }

  /**
   * Get partition names
   */
  getPartitionNames(): string[] {
    return Array.from(this.partitions.keys());
  }

  /**
   * Get partition statistics
   */
  async getPartitionStats(): Promise<Record<string, number>> {
    const stats: Record<string, number> = {};
    for (const [name, partition] of this.partitions) {
      stats[name] = await partition.count();
    }
    return stats;
  }
}

/**
 * Create a vector store
 */
export function createVectorStore(
  type: "memory" | "partitioned" = "memory",
  options: {
    persistPath?: string;
    persistDir?: string;
    partitionKey?: string;
  } = {}
): VectorStore {
  if (type === "partitioned") {
    return new PartitionedVectorStore(options.partitionKey, options.persistDir);
  }
  return new InMemoryVectorStore(options.persistPath);
}
