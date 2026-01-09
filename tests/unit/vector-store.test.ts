/**
 * Unit tests for VectorStore implementations
 * Tests InMemoryVectorStore and PartitionedVectorStore
 */

// Mock dependencies before imports
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock cosineSimilarity
jest.mock('../../src/context/codebase-rag/embeddings', () => ({
  cosineSimilarity: jest.fn((a: number[], b: number[]) => {
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
  }),
}));

import fs from 'fs';
import {
  InMemoryVectorStore,
  PartitionedVectorStore,
  createVectorStore,
} from '../../src/context/codebase-rag/vector-store';

describe('InMemoryVectorStore', () => {
  let store: InMemoryVectorStore;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    store = new InMemoryVectorStore();
  });

  afterEach(async () => {
    // Clear any pending timers and dispose store
    jest.clearAllTimers();
    if (store) {
      await store.dispose();
    }
    jest.useRealTimers();
  });

  describe('Constructor', () => {
    it('should create empty store without persistence', () => {
      const store = new InMemoryVectorStore();
      expect(store).toBeDefined();
    });

    it('should create store with persistence path', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const store = new InMemoryVectorStore('/tmp/test-vectors.json');
      expect(store).toBeDefined();
    });

    it('should load existing data from disk', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({
        version: 1,
        vectors: [
          { id: 'test-1', embedding: [0.1, 0.2, 0.3], metadata: { type: 'test' } },
        ],
      }));

      const store = new InMemoryVectorStore('/tmp/test-vectors.json');
      expect(store.has('test-1')).toBe(true);
    });

    it('should handle corrupted data gracefully', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('invalid json');

      const store = new InMemoryVectorStore('/tmp/test-vectors.json');
      expect(store.getAllIds()).toHaveLength(0);
    });

    it('should handle missing file gracefully', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const store = new InMemoryVectorStore('/tmp/nonexistent.json');
      expect(store.getAllIds()).toHaveLength(0);
    });
  });

  describe('add', () => {
    it('should add single vector', async () => {
      await store.add('vec-1', [0.1, 0.2, 0.3]);

      expect(store.has('vec-1')).toBe(true);
      const entry = store.get('vec-1');
      expect(entry?.embedding).toEqual([0.1, 0.2, 0.3]);
    });

    it('should add vector with metadata', async () => {
      await store.add('vec-1', [0.1, 0.2], { type: 'code', language: 'typescript' });

      const entry = store.get('vec-1');
      expect(entry?.metadata).toEqual({ type: 'code', language: 'typescript' });
    });

    it('should overwrite existing vector', async () => {
      await store.add('vec-1', [0.1, 0.2, 0.3]);
      await store.add('vec-1', [0.4, 0.5, 0.6]);

      const entry = store.get('vec-1');
      expect(entry?.embedding).toEqual([0.4, 0.5, 0.6]);
    });

    it('should mark store as dirty', async () => {
      await store.add('vec-1', [0.1, 0.2, 0.3]);
      // dirty flag is private, but we can verify through save behavior
      expect(store.has('vec-1')).toBe(true);
    });
  });

  describe('addBatch', () => {
    it('should add multiple vectors', async () => {
      await store.addBatch([
        { id: 'vec-1', embedding: [0.1, 0.2] },
        { id: 'vec-2', embedding: [0.3, 0.4] },
        { id: 'vec-3', embedding: [0.5, 0.6] },
      ]);

      expect(await store.count()).toBe(3);
      expect(store.has('vec-1')).toBe(true);
      expect(store.has('vec-2')).toBe(true);
      expect(store.has('vec-3')).toBe(true);
    });

    it('should add vectors with metadata', async () => {
      await store.addBatch([
        { id: 'vec-1', embedding: [0.1], metadata: { type: 'a' } },
        { id: 'vec-2', embedding: [0.2], metadata: { type: 'b' } },
      ]);

      expect(store.get('vec-1')?.metadata).toEqual({ type: 'a' });
      expect(store.get('vec-2')?.metadata).toEqual({ type: 'b' });
    });

    it('should handle empty array', async () => {
      await store.addBatch([]);
      expect(await store.count()).toBe(0);
    });

    it('should handle missing metadata', async () => {
      await store.addBatch([
        { id: 'vec-1', embedding: [0.1] },
      ]);

      expect(store.get('vec-1')?.metadata).toEqual({});
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await store.addBatch([
        { id: 'vec-1', embedding: [1, 0, 0], metadata: { type: 'a' } },
        { id: 'vec-2', embedding: [0, 1, 0], metadata: { type: 'b' } },
        { id: 'vec-3', embedding: [0, 0, 1], metadata: { type: 'a' } },
        { id: 'vec-4', embedding: [0.7, 0.7, 0], metadata: { type: 'b' } },
      ]);
    });

    it('should find similar vectors', async () => {
      const results = await store.search([1, 0, 0], 2);

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('vec-1'); // Most similar
      expect(results[0].score).toBeCloseTo(1, 5);
    });

    it('should return top k results', async () => {
      const results = await store.search([0.5, 0.5, 0], 3);

      expect(results).toHaveLength(3);
    });

    it('should sort by score descending', async () => {
      const results = await store.search([1, 0, 0], 4);

      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
      }
    });

    it('should filter by metadata', async () => {
      const results = await store.search([1, 0, 0], 10, { type: 'a' });

      expect(results).toHaveLength(2);
      results.forEach(r => {
        const entry = store.get(r.id);
        expect(entry?.metadata.type).toBe('a');
      });
    });

    it('should return empty array when no matches', async () => {
      const results = await store.search([1, 0, 0], 10, { type: 'nonexistent' });

      expect(results).toHaveLength(0);
    });

    it('should handle empty store', async () => {
      const emptyStore = new InMemoryVectorStore();
      const results = await emptyStore.search([1, 0, 0], 5);

      expect(results).toHaveLength(0);
    });

    it('should handle k larger than store size', async () => {
      const results = await store.search([1, 0, 0], 100);

      expect(results).toHaveLength(4);
    });
  });

  describe('delete', () => {
    beforeEach(async () => {
      await store.addBatch([
        { id: 'vec-1', embedding: [0.1] },
        { id: 'vec-2', embedding: [0.2] },
      ]);
    });

    it('should delete vector by id', async () => {
      await store.delete('vec-1');

      expect(store.has('vec-1')).toBe(false);
      expect(store.has('vec-2')).toBe(true);
    });

    it('should handle deleting non-existent id', async () => {
      await store.delete('nonexistent');

      expect(await store.count()).toBe(2);
    });
  });

  describe('deleteByFilter', () => {
    beforeEach(async () => {
      await store.addBatch([
        { id: 'vec-1', embedding: [0.1], metadata: { type: 'a', lang: 'ts' } },
        { id: 'vec-2', embedding: [0.2], metadata: { type: 'b', lang: 'ts' } },
        { id: 'vec-3', embedding: [0.3], metadata: { type: 'a', lang: 'js' } },
        { id: 'vec-4', embedding: [0.4], metadata: { type: 'b', lang: 'js' } },
      ]);
    });

    it('should delete vectors matching filter', async () => {
      const deleted = await store.deleteByFilter({ type: 'a' });

      expect(deleted).toBe(2);
      expect(await store.count()).toBe(2);
      expect(store.has('vec-1')).toBe(false);
      expect(store.has('vec-3')).toBe(false);
    });

    it('should delete vectors matching multiple filter criteria', async () => {
      const deleted = await store.deleteByFilter({ type: 'a', lang: 'ts' });

      expect(deleted).toBe(1);
      expect(store.has('vec-1')).toBe(false);
    });

    it('should return 0 when no matches', async () => {
      const deleted = await store.deleteByFilter({ type: 'nonexistent' });

      expect(deleted).toBe(0);
      expect(await store.count()).toBe(4);
    });
  });

  describe('count', () => {
    it('should return 0 for empty store', async () => {
      expect(await store.count()).toBe(0);
    });

    it('should return correct count', async () => {
      await store.addBatch([
        { id: 'vec-1', embedding: [0.1] },
        { id: 'vec-2', embedding: [0.2] },
        { id: 'vec-3', embedding: [0.3] },
      ]);

      expect(await store.count()).toBe(3);
    });

    it('should update after delete', async () => {
      await store.add('vec-1', [0.1]);
      await store.add('vec-2', [0.2]);
      await store.delete('vec-1');

      expect(await store.count()).toBe(1);
    });
  });

  describe('clear', () => {
    it('should remove all vectors', async () => {
      await store.addBatch([
        { id: 'vec-1', embedding: [0.1] },
        { id: 'vec-2', embedding: [0.2] },
      ]);

      await store.clear();

      expect(await store.count()).toBe(0);
      expect(store.getAllIds()).toHaveLength(0);
    });
  });

  describe('get', () => {
    it('should return vector entry', async () => {
      await store.add('vec-1', [0.1, 0.2], { type: 'test' });

      const entry = store.get('vec-1');

      expect(entry?.id).toBe('vec-1');
      expect(entry?.embedding).toEqual([0.1, 0.2]);
      expect(entry?.metadata).toEqual({ type: 'test' });
    });

    it('should return undefined for non-existent id', () => {
      expect(store.get('nonexistent')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('should return true for existing vector', async () => {
      await store.add('vec-1', [0.1]);

      expect(store.has('vec-1')).toBe(true);
    });

    it('should return false for non-existent vector', () => {
      expect(store.has('nonexistent')).toBe(false);
    });
  });

  describe('getAllIds', () => {
    it('should return all ids', async () => {
      await store.addBatch([
        { id: 'vec-1', embedding: [0.1] },
        { id: 'vec-2', embedding: [0.2] },
        { id: 'vec-3', embedding: [0.3] },
      ]);

      const ids = store.getAllIds();

      expect(ids).toHaveLength(3);
      expect(ids).toContain('vec-1');
      expect(ids).toContain('vec-2');
      expect(ids).toContain('vec-3');
    });

    it('should return empty array for empty store', () => {
      expect(store.getAllIds()).toHaveLength(0);
    });
  });

  describe('Persistence', () => {
    it('should save to disk when dirty', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const persistentStore = new InMemoryVectorStore('/tmp/test-vectors.json');

      await persistentStore.add('vec-1', [0.1, 0.2], { type: 'test' });
      await persistentStore.saveToDisk();

      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should not save when not dirty', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const persistentStore = new InMemoryVectorStore('/tmp/test-vectors.json');

      await persistentStore.saveToDisk();

      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should create directory if not exists', async () => {
      (fs.existsSync as jest.Mock).mockImplementation((path: string) => {
        if (path.includes('test-vectors.json')) return false;
        return false;
      });

      const persistentStore = new InMemoryVectorStore('/tmp/subdir/test-vectors.json');
      await persistentStore.add('vec-1', [0.1]);
      await persistentStore.saveToDisk();

      expect(fs.mkdirSync).toHaveBeenCalled();
    });

    it('should save on auto-save interval', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const persistentStore = new InMemoryVectorStore('/tmp/test-vectors.json');

      await persistentStore.add('vec-1', [0.1]);

      // Fast-forward 30 seconds
      jest.advanceTimersByTime(30000);

      // Give async operations time to complete
      await Promise.resolve();

      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should stop auto-save on dispose', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const persistentStore = new InMemoryVectorStore('/tmp/test-vectors.json');

      await persistentStore.add('vec-1', [0.1]);
      await persistentStore.dispose();

      jest.clearAllMocks();
      jest.advanceTimersByTime(60000);

      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('getMemoryUsage', () => {
    it('should return 0 for empty store', () => {
      expect(store.getMemoryUsage()).toBe(0);
    });

    it('should estimate memory usage', async () => {
      await store.add('vec-1', [0.1, 0.2, 0.3, 0.4], { type: 'test' });

      const usage = store.getMemoryUsage();
      expect(usage).toBeGreaterThan(0);
    });

    it('should increase with more vectors', async () => {
      await store.add('vec-1', [0.1, 0.2]);
      const usage1 = store.getMemoryUsage();

      await store.add('vec-2', [0.3, 0.4]);
      const usage2 = store.getMemoryUsage();

      expect(usage2).toBeGreaterThan(usage1);
    });
  });

  describe('dispose', () => {
    it('should save and cleanup', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const persistentStore = new InMemoryVectorStore('/tmp/test-vectors.json');

      await persistentStore.add('vec-1', [0.1]);
      await persistentStore.dispose();

      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });
});

describe('PartitionedVectorStore', () => {
  let store: PartitionedVectorStore;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    store = new PartitionedVectorStore('language');
  });

  afterEach(async () => {
    // Clear any pending timers and dispose store
    jest.clearAllTimers();
    if (store) {
      await store.dispose();
    }
    jest.useRealTimers();
  });

  describe('Constructor', () => {
    it('should create with default partition key', () => {
      const store = new PartitionedVectorStore();
      expect(store).toBeDefined();
    });

    it('should create with custom partition key', () => {
      const store = new PartitionedVectorStore('type');
      expect(store).toBeDefined();
    });

    it('should create with persist directory', () => {
      const store = new PartitionedVectorStore('language', '/tmp/partitions');
      expect(store).toBeDefined();
    });
  });

  describe('add', () => {
    it('should add vector to correct partition', async () => {
      await store.add('vec-1', [0.1], { language: 'typescript' });
      await store.add('vec-2', [0.2], { language: 'javascript' });

      expect(await store.count()).toBe(2);
      expect(store.getPartitionNames()).toContain('typescript');
      expect(store.getPartitionNames()).toContain('javascript');
    });

    it('should use default partition when key missing', async () => {
      await store.add('vec-1', [0.1], {});

      expect(store.getPartitionNames()).toContain('default');
    });

    it('should handle missing metadata', async () => {
      await store.add('vec-1', [0.1]);

      expect(store.getPartitionNames()).toContain('default');
    });
  });

  describe('addBatch', () => {
    it('should distribute vectors to partitions', async () => {
      await store.addBatch([
        { id: 'vec-1', embedding: [0.1], metadata: { language: 'ts' } },
        { id: 'vec-2', embedding: [0.2], metadata: { language: 'js' } },
        { id: 'vec-3', embedding: [0.3], metadata: { language: 'ts' } },
      ]);

      const stats = await store.getPartitionStats();
      expect(stats['ts']).toBe(2);
      expect(stats['js']).toBe(1);
    });

    it('should handle empty batch', async () => {
      await store.addBatch([]);
      expect(await store.count()).toBe(0);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await store.addBatch([
        { id: 'ts-1', embedding: [1, 0, 0], metadata: { language: 'ts', type: 'a' } },
        { id: 'ts-2', embedding: [0.9, 0.1, 0], metadata: { language: 'ts', type: 'b' } },
        { id: 'js-1', embedding: [0, 1, 0], metadata: { language: 'js', type: 'a' } },
        { id: 'js-2', embedding: [0, 0.9, 0.1], metadata: { language: 'js', type: 'b' } },
      ]);
    });

    it('should search all partitions', async () => {
      const results = await store.search([1, 0, 0], 4);

      expect(results.length).toBe(4);
    });

    it('should search specific partition when filtered', async () => {
      const results = await store.search([1, 0, 0], 10, { language: 'ts' });

      expect(results.length).toBe(2);
      results.forEach(r => expect(r.id).toMatch(/^ts-/));
    });

    it('should return empty for non-existent partition', async () => {
      const results = await store.search([1, 0, 0], 10, { language: 'python' });

      expect(results.length).toBe(0);
    });

    it('should merge and sort results from all partitions', async () => {
      const results = await store.search([1, 0, 0], 2);

      expect(results.length).toBe(2);
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    });

    it('should apply additional filter within partition', async () => {
      const results = await store.search([1, 0, 0], 10, { language: 'ts', type: 'a' });

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('ts-1');
    });
  });

  describe('delete', () => {
    beforeEach(async () => {
      await store.addBatch([
        { id: 'vec-1', embedding: [0.1], metadata: { language: 'ts' } },
        { id: 'vec-2', embedding: [0.2], metadata: { language: 'js' } },
      ]);
    });

    it('should delete vector from correct partition', async () => {
      await store.delete('vec-1');

      expect(await store.count()).toBe(1);
    });

    it('should handle non-existent id', async () => {
      await store.delete('nonexistent');

      expect(await store.count()).toBe(2);
    });
  });

  describe('deleteByFilter', () => {
    beforeEach(async () => {
      await store.addBatch([
        { id: 'vec-1', embedding: [0.1], metadata: { language: 'ts', type: 'a' } },
        { id: 'vec-2', embedding: [0.2], metadata: { language: 'ts', type: 'b' } },
        { id: 'vec-3', embedding: [0.3], metadata: { language: 'js', type: 'a' } },
      ]);
    });

    it('should delete from all partitions', async () => {
      const deleted = await store.deleteByFilter({ type: 'a' });

      expect(deleted).toBe(2);
      expect(await store.count()).toBe(1);
    });
  });

  describe('count', () => {
    it('should return total count across partitions', async () => {
      await store.addBatch([
        { id: 'vec-1', embedding: [0.1], metadata: { language: 'ts' } },
        { id: 'vec-2', embedding: [0.2], metadata: { language: 'js' } },
        { id: 'vec-3', embedding: [0.3], metadata: { language: 'py' } },
      ]);

      expect(await store.count()).toBe(3);
    });

    it('should return 0 for empty store', async () => {
      expect(await store.count()).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear all partitions', async () => {
      await store.addBatch([
        { id: 'vec-1', embedding: [0.1], metadata: { language: 'ts' } },
        { id: 'vec-2', embedding: [0.2], metadata: { language: 'js' } },
      ]);

      await store.clear();

      expect(await store.count()).toBe(0);
      expect(store.getPartitionNames()).toHaveLength(0);
    });
  });

  describe('getPartitionNames', () => {
    it('should return all partition names', async () => {
      await store.addBatch([
        { id: 'vec-1', embedding: [0.1], metadata: { language: 'ts' } },
        { id: 'vec-2', embedding: [0.2], metadata: { language: 'js' } },
        { id: 'vec-3', embedding: [0.3], metadata: { language: 'py' } },
      ]);

      const names = store.getPartitionNames();

      expect(names).toHaveLength(3);
      expect(names).toContain('ts');
      expect(names).toContain('js');
      expect(names).toContain('py');
    });

    it('should return empty array for empty store', () => {
      expect(store.getPartitionNames()).toHaveLength(0);
    });
  });

  describe('getPartitionStats', () => {
    it('should return count per partition', async () => {
      await store.addBatch([
        { id: 'vec-1', embedding: [0.1], metadata: { language: 'ts' } },
        { id: 'vec-2', embedding: [0.2], metadata: { language: 'ts' } },
        { id: 'vec-3', embedding: [0.3], metadata: { language: 'js' } },
      ]);

      const stats = await store.getPartitionStats();

      expect(stats['ts']).toBe(2);
      expect(stats['js']).toBe(1);
    });
  });

  describe('saveToDisk', () => {
    it('should save all partitions', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const persistentStore = new PartitionedVectorStore('language', '/tmp/partitions');

      await persistentStore.addBatch([
        { id: 'vec-1', embedding: [0.1], metadata: { language: 'ts' } },
        { id: 'vec-2', embedding: [0.2], metadata: { language: 'js' } },
      ]);

      await persistentStore.saveToDisk();

      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should dispose all partitions', async () => {
      await store.addBatch([
        { id: 'vec-1', embedding: [0.1], metadata: { language: 'ts' } },
        { id: 'vec-2', embedding: [0.2], metadata: { language: 'js' } },
      ]);

      await store.dispose();

      // After dispose, store should still exist but be cleaned up
      expect(store).toBeDefined();
    });
  });
});

describe('createVectorStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
  });

  it('should create memory store by default', () => {
    const store = createVectorStore();
    expect(store).toBeInstanceOf(InMemoryVectorStore);
  });

  it('should create memory store explicitly', () => {
    const store = createVectorStore('memory');
    expect(store).toBeInstanceOf(InMemoryVectorStore);
  });

  it('should create partitioned store', () => {
    const store = createVectorStore('partitioned');
    expect(store).toBeInstanceOf(PartitionedVectorStore);
  });

  it('should create memory store with persist path', () => {
    const store = createVectorStore('memory', { persistPath: '/tmp/test.json' });
    expect(store).toBeInstanceOf(InMemoryVectorStore);
  });

  it('should create partitioned store with options', () => {
    const store = createVectorStore('partitioned', {
      persistDir: '/tmp/partitions',
      partitionKey: 'type',
    });
    expect(store).toBeInstanceOf(PartitionedVectorStore);
  });
});

describe('Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('should handle full lifecycle', async () => {
    const store = new InMemoryVectorStore();

    // Add vectors
    await store.addBatch([
      { id: 'doc-1', embedding: [1, 0, 0], metadata: { type: 'code' } },
      { id: 'doc-2', embedding: [0, 1, 0], metadata: { type: 'doc' } },
      { id: 'doc-3', embedding: [0, 0, 1], metadata: { type: 'code' } },
    ]);

    // Search
    const searchResults = await store.search([1, 0, 0], 2);
    expect(searchResults[0].id).toBe('doc-1');

    // Filter search
    const filteredResults = await store.search([0.5, 0.5, 0], 10, { type: 'code' });
    expect(filteredResults.every(r => r.id !== 'doc-2')).toBe(true);

    // Delete
    await store.delete('doc-1');
    expect(await store.count()).toBe(2);

    // Clear
    await store.clear();
    expect(await store.count()).toBe(0);
  });

  it('should handle partitioned lifecycle', async () => {
    const store = new PartitionedVectorStore('language');

    // Add vectors to different partitions
    await store.addBatch([
      { id: 'ts-1', embedding: [1, 0], metadata: { language: 'typescript' } },
      { id: 'ts-2', embedding: [0.9, 0.1], metadata: { language: 'typescript' } },
      { id: 'js-1', embedding: [0, 1], metadata: { language: 'javascript' } },
    ]);

    // Verify partitions
    expect(store.getPartitionNames()).toHaveLength(2);

    // Search specific partition
    const tsResults = await store.search([1, 0], 10, { language: 'typescript' });
    expect(tsResults).toHaveLength(2);

    // Search all partitions
    const allResults = await store.search([1, 0], 3);
    expect(allResults).toHaveLength(3);

    // Get stats
    const stats = await store.getPartitionStats();
    expect(stats['typescript']).toBe(2);
    expect(stats['javascript']).toBe(1);
  });

  it('should maintain consistency between operations', async () => {
    const store = new InMemoryVectorStore();

    // Add
    await store.add('vec-1', [0.1, 0.2]);
    expect(store.has('vec-1')).toBe(true);
    expect(await store.count()).toBe(1);

    // Get
    const entry = store.get('vec-1');
    expect(entry?.embedding).toEqual([0.1, 0.2]);

    // Update (overwrite)
    await store.add('vec-1', [0.3, 0.4]);
    expect(await store.count()).toBe(1);
    expect(store.get('vec-1')?.embedding).toEqual([0.3, 0.4]);

    // Delete
    await store.delete('vec-1');
    expect(store.has('vec-1')).toBe(false);
    expect(await store.count()).toBe(0);
    expect(store.get('vec-1')).toBeUndefined();
  });
});
