/**
 * USearch Vector Index
 *
 * High-performance vector search using USearch library.
 * Provides O(log n) approximate nearest neighbor search with HNSW algorithm.
 *
 * Features:
 * - SIMD-optimized distance calculations
 * - Support for f32, f16, i8 quantization
 * - Memory-mapped indexes for large datasets
 * - Batch operations for efficient bulk indexing
 *
 * @see https://github.com/unum-cloud/usearch
 */

import { EventEmitter } from 'events';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Metric types supported by USearch
 */
export type USearchMetric = 'cos' | 'l2sq' | 'ip' | 'hamming' | 'tanimoto';

/**
 * Data types for vector storage
 */
export type USearchDType = 'f64' | 'f32' | 'f16' | 'i8' | 'b1';

/**
 * USearch index configuration
 */
export interface USearchIndexConfig {
  /** Vector dimensions */
  dimensions: number;
  /** Distance metric (default: 'cos' for cosine similarity) */
  metric?: USearchMetric;
  /** Data type for storage (default: 'f32') */
  dtype?: USearchDType;
  /** Number of connections per node in HNSW graph (default: 16) */
  connectivity?: number;
  /** Size of dynamic candidate list during construction (default: 128) */
  expansionAdd?: number;
  /** Size of dynamic candidate list during search (default: 64) */
  expansionSearch?: number;
  /** Path for persistence (optional) */
  persistPath?: string;
  /** Whether to use memory-mapped index (default: false) */
  memoryMapped?: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_USEARCH_CONFIG: Required<Omit<USearchIndexConfig, 'persistPath'>> = {
  dimensions: 384, // MiniLM-L6-v2 default
  metric: 'cos',
  dtype: 'f32',
  connectivity: 16,
  expansionAdd: 128,
  expansionSearch: 64,
  memoryMapped: false,
};

/**
 * Search result from USearch
 */
export interface USearchResult {
  /** Key/ID of the vector */
  key: number;
  /** Distance to query vector (lower is better for most metrics) */
  distance: number;
}

/**
 * Vector with metadata for indexing
 */
export interface IndexableVector {
  /** Unique ID (will be converted to numeric key) */
  id: string;
  /** Vector embedding */
  embedding: number[] | Float32Array;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Search result with resolved metadata
 */
export interface VectorSearchResult {
  /** Original string ID */
  id: string;
  /** Similarity score (0-1, higher is better) */
  score: number;
  /** Distance from query */
  distance: number;
  /** Associated metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Index statistics
 */
export interface USearchStats {
  /** Total vectors in index */
  size: number;
  /** Index capacity */
  capacity: number;
  /** Vector dimensions */
  dimensions: number;
  /** Connectivity (M) parameter */
  connectivity: number;
  /** Memory usage estimate in bytes */
  memoryUsage: number;
  /** Whether index is memory-mapped */
  memoryMapped: boolean;
}

/**
 * USearch index events
 */
export interface USearchEvents {
  'index:created': { dimensions: number; metric: USearchMetric };
  'vectors:added': { count: number; totalSize: number };
  'vectors:removed': { count: number };
  'search:completed': { queryCount: number; resultCount: number; durationMs: number };
  'index:saved': { path: string; size: number };
  'index:loaded': { path: string; size: number };
  'error': { operation: string; error: Error };
}

// ============================================================================
// USearch Index Wrapper
// ============================================================================

/**
 * High-performance vector index using USearch
 */
export class USearchVectorIndex extends EventEmitter {
  private config: Required<Omit<USearchIndexConfig, 'persistPath'>> & { persistPath?: string };
  private index: USearchNativeIndex | null = null;
  private idToKey: Map<string, number> = new Map();
  private keyToId: Map<number, string> = new Map();
  private metadata: Map<string, Record<string, unknown>> = new Map();
  private nextKey: number = 0;
  private initialized: boolean = false;

  constructor(config: USearchIndexConfig) {
    super();
    this.config = {
      ...DEFAULT_USEARCH_CONFIG,
      ...config,
    };
  }

  /**
   * Initialize the index
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Dynamically import usearch
      const usearch = await this.loadUSearch();

      // Create index
      this.index = new usearch.Index({
        metric: this.config.metric,
        connectivity: this.config.connectivity,
        dimensions: this.config.dimensions,
        // Note: usearch uses 'dtype' for data type
      });

      // Load existing index if path specified
      if (this.config.persistPath && existsSync(this.config.persistPath)) {
        await this.load(this.config.persistPath);
      }

      this.initialized = true;
      this.emit('index:created', {
        dimensions: this.config.dimensions,
        metric: this.config.metric,
      });
    } catch (error) {
      // Fallback to in-memory implementation if usearch not available
      logger.warn('USearch not available, using fallback implementation', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.index = new FallbackVectorIndex(this.config);
      this.initialized = true;
    }
  }

  /**
   * Load USearch module dynamically
   */
  private async loadUSearch(): Promise<USearchModule> {
    try {
      // Try to load usearch dynamically
      // Using Function constructor to bypass TypeScript module resolution
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const importModule = new Function('specifier', 'return import(specifier)') as (
        specifier: string
      ) => Promise<unknown>;
      const usearch = (await importModule('usearch')) as USearchModule;
      return usearch;
    } catch {
      throw new Error('usearch module not installed. Run: npm install usearch');
    }
  }

  /**
   * Add a single vector to the index
   */
  async add(vector: IndexableVector): Promise<void> {
    await this.initialize();
    if (!this.index) throw new Error('Index not initialized');

    const key = this.getOrCreateKey(vector.id);
    const embedding = this.normalizeEmbedding(vector.embedding);

    this.index.add(key, embedding);

    if (vector.metadata) {
      this.metadata.set(vector.id, vector.metadata);
    }

    this.emit('vectors:added', { count: 1, totalSize: this.size() });
  }

  /**
   * Add multiple vectors to the index (batch operation)
   */
  async addBatch(vectors: IndexableVector[]): Promise<void> {
    await this.initialize();
    if (!this.index) throw new Error('Index not initialized');

    for (const vector of vectors) {
      const key = this.getOrCreateKey(vector.id);
      const embedding = this.normalizeEmbedding(vector.embedding);
      this.index.add(key, embedding);

      if (vector.metadata) {
        this.metadata.set(vector.id, vector.metadata);
      }
    }

    this.emit('vectors:added', { count: vectors.length, totalSize: this.size() });
  }

  /**
   * Remove a vector from the index
   */
  remove(id: string): boolean {
    if (!this.index) return false;

    const key = this.idToKey.get(id);
    if (key === undefined) return false;

    // Note: USearch doesn't support removal directly in all versions
    // We mark it as removed in our mapping
    this.idToKey.delete(id);
    this.keyToId.delete(key);
    this.metadata.delete(id);

    this.emit('vectors:removed', { count: 1 });
    return true;
  }

  /**
   * Search for nearest neighbors
   */
  async search(
    query: number[] | Float32Array,
    k: number = 10
  ): Promise<VectorSearchResult[]> {
    await this.initialize();
    if (!this.index) throw new Error('Index not initialized');

    const startTime = Date.now();
    const queryVector = this.normalizeEmbedding(query);

    // Search with expansion factor for better recall
    const results = this.index.search(queryVector, k);

    // Convert results
    const searchResults: VectorSearchResult[] = [];

    // Results have keys and distances arrays
    // Native usearch uses BigUint64Array for keys, Float32Array for distances
    const { keys, distances } = results;

    for (let i = 0; i < keys.length; i++) {
      // Convert BigInt to number if needed (native usearch returns BigUint64Array)
      const rawKey = keys[i];
      const key: number = typeof rawKey === 'bigint' ? Number(rawKey) : rawKey;
      const distance = distances[i];

      const id = this.keyToId.get(key);
      if (!id) continue; // Skip removed vectors

      // Convert distance to similarity score
      const score = this.distanceToScore(distance);

      searchResults.push({
        id,
        score,
        distance,
        metadata: this.metadata.get(id),
      });
    }

    const durationMs = Date.now() - startTime;
    this.emit('search:completed', {
      queryCount: 1,
      resultCount: searchResults.length,
      durationMs,
    });

    return searchResults;
  }

  /**
   * Batch search for multiple queries
   */
  async searchBatch(
    queries: Array<number[] | Float32Array>,
    k: number = 10
  ): Promise<VectorSearchResult[][]> {
    const results: VectorSearchResult[][] = [];
    for (const query of queries) {
      results.push(await this.search(query, k));
    }
    return results;
  }

  /**
   * Save index to disk
   */
  async save(path?: string): Promise<void> {
    if (!this.index) return;

    const savePath = path || this.config.persistPath;
    if (!savePath) {
      throw new Error('No save path specified');
    }

    // Ensure directory exists
    const dir = dirname(savePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Save index
    if (this.index.save) {
      this.index.save(savePath);
    }

    // Save mappings
    const mappingsPath = `${savePath}.mappings.json`;
    const mappings = {
      idToKey: Array.from(this.idToKey.entries()),
      metadata: Array.from(this.metadata.entries()),
      nextKey: this.nextKey,
    };

    const { writeFileSync } = await import('fs');
    writeFileSync(mappingsPath, JSON.stringify(mappings));

    this.emit('index:saved', { path: savePath, size: this.size() });
  }

  /**
   * Load index from disk
   */
  async load(path: string): Promise<void> {
    if (!this.index) return;

    // Check for mappings file (always created)
    const mappingsPath = `${path}.mappings.json`;
    if (!existsSync(path) && !existsSync(mappingsPath)) {
      throw new Error(`Index file not found: ${path}`);
    }

    // Load native index if available and file exists
    if (existsSync(path)) {
      if (this.index.load) {
        this.index.load(path);
      } else if (this.index.view && this.config.memoryMapped) {
        this.index.view(path);
      }
    }

    // Load mappings
    if (existsSync(mappingsPath)) {
      const { readFileSync } = await import('fs');
      const mappings = JSON.parse(readFileSync(mappingsPath, 'utf-8'));

      this.idToKey = new Map(mappings.idToKey);
      this.keyToId = new Map(
        mappings.idToKey.map(([id, key]: [string, number]) => [key, id])
      );
      this.metadata = new Map(mappings.metadata);
      this.nextKey = mappings.nextKey;
    }

    this.emit('index:loaded', { path, size: this.size() });
  }

  /**
   * Get index statistics
   */
  getStats(): USearchStats {
    return {
      size: this.size(),
      capacity: this.index?.capacity?.() || this.size(),
      dimensions: this.config.dimensions,
      connectivity: this.config.connectivity,
      memoryUsage: this.estimateMemoryUsage(),
      memoryMapped: this.config.memoryMapped,
    };
  }

  /**
   * Get the number of vectors in the index
   */
  size(): number {
    return this.idToKey.size;
  }

  /**
   * Check if index contains a vector
   */
  has(id: string): boolean {
    return this.idToKey.has(id);
  }

  /**
   * Clear all vectors from the index
   */
  clear(): void {
    this.idToKey.clear();
    this.keyToId.clear();
    this.metadata.clear();
    this.nextKey = 0;

    // Recreate index
    if (this.index) {
      this.initialized = false;
      this.index = null;
    }
  }

  /**
   * Dispose the index
   */
  dispose(): void {
    this.clear();
    this.removeAllListeners();

    // Delete persisted files
    if (this.config.persistPath) {
      try {
        if (existsSync(this.config.persistPath)) {
          unlinkSync(this.config.persistPath);
        }
        const mappingsPath = `${this.config.persistPath}.mappings.json`;
        if (existsSync(mappingsPath)) {
          unlinkSync(mappingsPath);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private getOrCreateKey(id: string): number {
    let key = this.idToKey.get(id);
    if (key === undefined) {
      key = this.nextKey++;
      this.idToKey.set(id, key);
      this.keyToId.set(key, id);
    }
    return key;
  }

  private normalizeEmbedding(embedding: number[] | Float32Array): Float32Array {
    if (embedding instanceof Float32Array) {
      return embedding;
    }
    return new Float32Array(embedding);
  }

  private distanceToScore(distance: number): number {
    // Convert distance to similarity score based on metric
    switch (this.config.metric) {
      case 'cos':
        // Cosine distance: 0 = identical, 2 = opposite
        // Convert to similarity: 1 - (distance / 2)
        return Math.max(0, 1 - distance / 2);
      case 'l2sq':
        // L2 squared: 0 = identical, higher = more different
        // Use exponential decay for similarity
        return Math.exp(-distance);
      case 'ip':
        // Inner product: higher is more similar
        // Normalize assuming values are in reasonable range
        return 1 / (1 + Math.exp(-distance));
      default:
        return 1 - distance;
    }
  }

  private estimateMemoryUsage(): number {
    const vectorBytes = this.size() * this.config.dimensions * this.getDTypeBytes();
    const graphBytes = this.size() * this.config.connectivity * 8; // approximate
    const overheadBytes = this.size() * 64; // metadata overhead estimate
    return vectorBytes + graphBytes + overheadBytes;
  }

  private getDTypeBytes(): number {
    switch (this.config.dtype) {
      case 'f64':
        return 8;
      case 'f32':
        return 4;
      case 'f16':
        return 2;
      case 'i8':
        return 1;
      case 'b1':
        return 0.125;
      default:
        return 4;
    }
  }
}

// ============================================================================
// Fallback Implementation (when usearch not available)
// ============================================================================

/**
 * Search results from native index
 */
interface NativeSearchResults {
  keys: number[] | BigUint64Array;
  distances: number[] | Float32Array;
}

/**
 * Native USearch index interface
 */
interface USearchNativeIndex {
  add(key: number, vector: Float32Array): void;
  search(query: Float32Array, k: number): NativeSearchResults;
  save?(path: string): void;
  load?(path: string): void;
  view?(path: string): void;
  capacity?(): number;
}

/**
 * USearch module interface
 */
interface USearchModule {
  Index: new (config: {
    metric: USearchMetric;
    connectivity: number;
    dimensions: number;
  }) => USearchNativeIndex;
}

/**
 * Fallback vector index using brute-force search
 * Used when usearch is not installed
 */
class FallbackVectorIndex implements USearchNativeIndex {
  private vectors: Map<number, Float32Array> = new Map();
  private config: { metric: USearchMetric; dimensions: number };

  constructor(config: { metric: USearchMetric; dimensions: number }) {
    this.config = config;
  }

  add(key: number, vector: Float32Array): void {
    this.vectors.set(key, vector);
  }

  search(query: Float32Array, k: number): { keys: number[]; distances: number[] } {
    const results: Array<{ key: number; distance: number }> = [];

    for (const [key, vector] of this.vectors) {
      const distance = this.calculateDistance(query, vector);
      results.push({ key, distance });
    }

    // Sort by distance (ascending)
    results.sort((a, b) => a.distance - b.distance);

    // Take top k
    const topK = results.slice(0, k);

    return {
      keys: topK.map((r) => r.key),
      distances: topK.map((r) => r.distance),
    };
  }

  private calculateDistance(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error('Vector dimensions must match');
    }

    switch (this.config.metric) {
      case 'cos':
        return this.cosineDistance(a, b);
      case 'l2sq':
        return this.l2SquaredDistance(a, b);
      case 'ip':
        return -this.innerProduct(a, b); // Negate for distance
      default:
        return this.cosineDistance(a, b);
    }
  }

  private cosineDistance(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 2; // Maximum distance

    const similarity = dotProduct / denominator;
    return 1 - similarity; // Convert to distance
  }

  private l2SquaredDistance(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return sum;
  }

  private innerProduct(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  capacity(): number {
    return this.vectors.size;
  }
}

// ============================================================================
// Singleton Management
// ============================================================================

const indexInstances: Map<string, USearchVectorIndex> = new Map();

/**
 * Get or create a USearch vector index
 */
export function getUSearchIndex(
  name: string,
  config?: USearchIndexConfig
): USearchVectorIndex {
  let index = indexInstances.get(name);

  if (!index && config) {
    index = new USearchVectorIndex(config);
    indexInstances.set(name, index);
  }

  if (!index) {
    throw new Error(`USearch index '${name}' not found. Provide config to create.`);
  }

  return index;
}

/**
 * Remove a USearch index
 */
export function removeUSearchIndex(name: string): boolean {
  const index = indexInstances.get(name);
  if (index) {
    index.dispose();
    indexInstances.delete(name);
    return true;
  }
  return false;
}

/**
 * Clear all USearch indexes
 */
export function clearAllUSearchIndexes(): void {
  for (const index of indexInstances.values()) {
    index.dispose();
  }
  indexInstances.clear();
}
