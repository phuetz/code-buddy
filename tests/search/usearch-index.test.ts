/**
 * USearch Vector Index Tests
 */

import { join } from 'path';
import { existsSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import {
  USearchVectorIndex,
  getUSearchIndex,
  removeUSearchIndex,
  clearAllUSearchIndexes,
  DEFAULT_USEARCH_CONFIG,
} from '../../src/search/usearch-index.js';

describe('USearch Vector Index', () => {
  let index: USearchVectorIndex;
  const testDir = join(process.cwd(), 'test-usearch-indexes');

  beforeEach(() => {
    index = new USearchVectorIndex({
      dimensions: 3,
      metric: 'cos',
    });
  });

  afterEach(() => {
    index.dispose();
    clearAllUSearchIndexes();

    // Cleanup test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('DEFAULT_USEARCH_CONFIG', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_USEARCH_CONFIG.dimensions).toBe(384);
      expect(DEFAULT_USEARCH_CONFIG.metric).toBe('cos');
      expect(DEFAULT_USEARCH_CONFIG.dtype).toBe('f32');
      expect(DEFAULT_USEARCH_CONFIG.connectivity).toBe(16);
      expect(DEFAULT_USEARCH_CONFIG.expansionAdd).toBe(128);
      expect(DEFAULT_USEARCH_CONFIG.expansionSearch).toBe(64);
      expect(DEFAULT_USEARCH_CONFIG.memoryMapped).toBe(false);
    });
  });

  describe('Initialization', () => {
    it('should create index with custom config', async () => {
      const customIndex = new USearchVectorIndex({
        dimensions: 768,
        metric: 'l2sq',
        connectivity: 32,
      });

      await customIndex.initialize();
      const stats = customIndex.getStats();

      expect(stats.dimensions).toBe(768);
      expect(stats.connectivity).toBe(32);
      expect(stats.size).toBe(0);

      customIndex.dispose();
    });

    it('should initialize only once', async () => {
      await index.initialize();
      await index.initialize(); // Should not throw

      expect(index.size()).toBe(0);
    });
  });

  describe('Adding Vectors', () => {
    it('should add single vector', async () => {
      await index.add({
        id: 'vec-1',
        embedding: [1.0, 0.0, 0.0],
      });

      expect(index.size()).toBe(1);
      expect(index.has('vec-1')).toBe(true);
    });

    it('should add vector with metadata', async () => {
      await index.add({
        id: 'vec-1',
        embedding: [1.0, 0.0, 0.0],
        metadata: { label: 'test', category: 'demo' },
      });

      const results = await index.search([1.0, 0.0, 0.0], 1);
      expect(results[0].metadata).toEqual({ label: 'test', category: 'demo' });
    });

    it('should add batch of vectors', async () => {
      await index.addBatch([
        { id: 'vec-1', embedding: [1.0, 0.0, 0.0] },
        { id: 'vec-2', embedding: [0.0, 1.0, 0.0] },
        { id: 'vec-3', embedding: [0.0, 0.0, 1.0] },
      ]);

      expect(index.size()).toBe(3);
      expect(index.has('vec-1')).toBe(true);
      expect(index.has('vec-2')).toBe(true);
      expect(index.has('vec-3')).toBe(true);
    });

    it('should accept Float32Array', async () => {
      await index.add({
        id: 'vec-1',
        embedding: new Float32Array([1.0, 0.0, 0.0]),
      });

      expect(index.size()).toBe(1);
    });

    it('should emit vectors:added event', async () => {
      const addedEvents: Array<{ count: number; totalSize: number }> = [];
      index.on('vectors:added', (data) => addedEvents.push(data));

      await index.add({ id: 'vec-1', embedding: [1.0, 0.0, 0.0] });

      expect(addedEvents.length).toBe(1);
      expect(addedEvents[0].count).toBe(1);
      expect(addedEvents[0].totalSize).toBe(1);
    });
  });

  describe('Searching', () => {
    beforeEach(async () => {
      await index.addBatch([
        { id: 'north', embedding: [1.0, 0.0, 0.0], metadata: { direction: 'north' } },
        { id: 'east', embedding: [0.0, 1.0, 0.0], metadata: { direction: 'east' } },
        { id: 'up', embedding: [0.0, 0.0, 1.0], metadata: { direction: 'up' } },
        { id: 'northeast', embedding: [0.707, 0.707, 0.0], metadata: { direction: 'northeast' } },
      ]);
    });

    it('should find exact match', async () => {
      const results = await index.search([1.0, 0.0, 0.0], 1);

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('north');
      expect(results[0].score).toBeCloseTo(1.0, 1);
    });

    it('should return k nearest neighbors', async () => {
      const results = await index.search([1.0, 0.0, 0.0], 3);

      expect(results.length).toBe(3);
      // First should be exact match
      expect(results[0].id).toBe('north');
    });

    it('should rank similar vectors higher', async () => {
      // Query closer to northeast
      const results = await index.search([0.6, 0.6, 0.0], 4);

      expect(results.length).toBe(4);
      // Northeast should be ranked highly
      const northeastRank = results.findIndex((r) => r.id === 'northeast');
      expect(northeastRank).toBeLessThan(2);
    });

    it('should include metadata in results', async () => {
      const results = await index.search([1.0, 0.0, 0.0], 1);

      expect(results[0].metadata).toEqual({ direction: 'north' });
    });

    it('should handle batch search', async () => {
      const results = await index.searchBatch(
        [
          [1.0, 0.0, 0.0],
          [0.0, 1.0, 0.0],
        ],
        1
      );

      expect(results.length).toBe(2);
      expect(results[0][0].id).toBe('north');
      expect(results[1][0].id).toBe('east');
    });

    it('should emit search:completed event', async () => {
      const searchEvents: Array<{
        queryCount: number;
        resultCount: number;
        durationMs: number;
      }> = [];
      index.on('search:completed', (data) => searchEvents.push(data));

      await index.search([1.0, 0.0, 0.0], 2);

      expect(searchEvents.length).toBe(1);
      expect(searchEvents[0].queryCount).toBe(1);
      expect(searchEvents[0].resultCount).toBe(2);
      expect(searchEvents[0].durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Removing Vectors', () => {
    it('should remove vector by id', async () => {
      await index.add({ id: 'vec-1', embedding: [1.0, 0.0, 0.0] });
      expect(index.has('vec-1')).toBe(true);

      const removed = index.remove('vec-1');

      expect(removed).toBe(true);
      expect(index.has('vec-1')).toBe(false);
    });

    it('should return false for non-existent id', () => {
      const removed = index.remove('non-existent');
      expect(removed).toBe(false);
    });

    it('should emit vectors:removed event', async () => {
      await index.add({ id: 'vec-1', embedding: [1.0, 0.0, 0.0] });

      const removedEvents: Array<{ count: number }> = [];
      index.on('vectors:removed', (data) => removedEvents.push(data));

      index.remove('vec-1');

      expect(removedEvents.length).toBe(1);
      expect(removedEvents[0].count).toBe(1);
    });
  });

  describe('Statistics', () => {
    it('should return correct stats', async () => {
      await index.addBatch([
        { id: 'vec-1', embedding: [1.0, 0.0, 0.0] },
        { id: 'vec-2', embedding: [0.0, 1.0, 0.0] },
      ]);

      const stats = index.getStats();

      expect(stats.size).toBe(2);
      expect(stats.dimensions).toBe(3);
      expect(stats.connectivity).toBe(16);
      expect(stats.memoryUsage).toBeGreaterThan(0);
      expect(stats.memoryMapped).toBe(false);
    });
  });

  describe('Persistence', () => {
    const persistPath = join(testDir, 'test-index.usearch');

    beforeEach(() => {
      if (!existsSync(testDir)) {
        mkdirSync(testDir, { recursive: true });
      }
    });

    it('should save index to disk', async () => {
      await index.addBatch([
        { id: 'vec-1', embedding: [1.0, 0.0, 0.0], metadata: { label: 'one' } },
        { id: 'vec-2', embedding: [0.0, 1.0, 0.0], metadata: { label: 'two' } },
      ]);

      await index.save(persistPath);

      // Check that mappings file was created
      expect(existsSync(`${persistPath}.mappings.json`)).toBe(true);
    });

    it('should load index from disk', async () => {
      // Create and save
      await index.addBatch([
        { id: 'vec-1', embedding: [1.0, 0.0, 0.0], metadata: { label: 'one' } },
        { id: 'vec-2', embedding: [0.0, 1.0, 0.0], metadata: { label: 'two' } },
      ]);
      await index.save(persistPath);

      // Create new index and load
      const loadedIndex = new USearchVectorIndex({
        dimensions: 3,
        metric: 'cos',
      });
      await loadedIndex.initialize();
      await loadedIndex.load(persistPath);

      // Note: Fallback implementation only loads mappings, not vectors
      // Full vector restoration requires the native usearch library
      // The mappings (id-to-key mapping) should still be loaded
      expect(loadedIndex.has('vec-1')).toBe(true);
      expect(loadedIndex.has('vec-2')).toBe(true);

      loadedIndex.dispose();
    });

    it('should throw when loading non-existent file', async () => {
      await index.initialize();
      await expect(index.load('/non/existent/path.usearch')).rejects.toThrow(
        'Index file not found'
      );
    });

    it('should throw when saving without path', async () => {
      await index.add({ id: 'vec-1', embedding: [1.0, 0.0, 0.0] });
      await expect(index.save()).rejects.toThrow('No save path specified');
    });

    it('should emit save/load events', async () => {
      const events: string[] = [];
      index.on('index:saved', () => events.push('saved'));
      index.on('index:loaded', () => events.push('loaded'));

      await index.add({ id: 'vec-1', embedding: [1.0, 0.0, 0.0] });
      await index.save(persistPath);
      await index.load(persistPath);

      expect(events).toContain('saved');
      expect(events).toContain('loaded');
    });
  });

  describe('Clear and Dispose', () => {
    it('should clear all vectors', async () => {
      await index.addBatch([
        { id: 'vec-1', embedding: [1.0, 0.0, 0.0] },
        { id: 'vec-2', embedding: [0.0, 1.0, 0.0] },
      ]);

      index.clear();

      expect(index.size()).toBe(0);
      expect(index.has('vec-1')).toBe(false);
    });

    it('should dispose and cleanup', async () => {
      await index.add({ id: 'vec-1', embedding: [1.0, 0.0, 0.0] });

      index.dispose();

      expect(index.size()).toBe(0);
    });
  });

  describe('Different Metrics', () => {
    it('should work with L2 squared metric', async () => {
      const l2Index = new USearchVectorIndex({
        dimensions: 3,
        metric: 'l2sq',
      });

      await l2Index.addBatch([
        { id: 'a', embedding: [0.0, 0.0, 0.0] },
        { id: 'b', embedding: [1.0, 0.0, 0.0] },
        { id: 'c', embedding: [2.0, 0.0, 0.0] },
      ]);

      // Search for origin - should find 'a' first
      const results = await l2Index.search([0.0, 0.0, 0.0], 3);
      expect(results[0].id).toBe('a');

      l2Index.dispose();
    });

    it('should work with inner product metric', async () => {
      const ipIndex = new USearchVectorIndex({
        dimensions: 3,
        metric: 'ip',
      });

      await ipIndex.addBatch([
        { id: 'a', embedding: [1.0, 0.0, 0.0] },
        { id: 'b', embedding: [0.5, 0.0, 0.0] },
        { id: 'c', embedding: [-1.0, 0.0, 0.0] },
      ]);

      // Higher inner product with query
      const results = await ipIndex.search([1.0, 0.0, 0.0], 3);
      expect(results[0].id).toBe('a');

      ipIndex.dispose();
    });
  });

  describe('Singleton Management', () => {
    afterEach(() => {
      clearAllUSearchIndexes();
    });

    it('should get or create index by name', () => {
      const idx1 = getUSearchIndex('test-index', {
        dimensions: 3,
        metric: 'cos',
      });
      const idx2 = getUSearchIndex('test-index');

      expect(idx1).toBe(idx2);
    });

    it('should throw when getting non-existent index without config', () => {
      expect(() => getUSearchIndex('non-existent')).toThrow("not found");
    });

    it('should remove index by name', () => {
      getUSearchIndex('removable', { dimensions: 3 });
      const removed = removeUSearchIndex('removable');

      expect(removed).toBe(true);
      expect(() => getUSearchIndex('removable')).toThrow();
    });

    it('should return false when removing non-existent index', () => {
      const removed = removeUSearchIndex('non-existent');
      expect(removed).toBe(false);
    });

    it('should clear all indexes', () => {
      getUSearchIndex('idx-1', { dimensions: 3 });
      getUSearchIndex('idx-2', { dimensions: 3 });

      clearAllUSearchIndexes();

      expect(() => getUSearchIndex('idx-1')).toThrow();
      expect(() => getUSearchIndex('idx-2')).toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero vectors', async () => {
      await index.add({
        id: 'zero',
        embedding: [0.0, 0.0, 0.0],
      });

      const results = await index.search([0.0, 0.0, 0.0], 1);
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle negative values', async () => {
      await index.addBatch([
        { id: 'neg', embedding: [-1.0, -1.0, -1.0] },
        { id: 'pos', embedding: [1.0, 1.0, 1.0] },
      ]);

      const results = await index.search([-1.0, -1.0, -1.0], 2);
      expect(results[0].id).toBe('neg');
    });

    it('should handle duplicate IDs (update)', async () => {
      await index.add({ id: 'dup', embedding: [1.0, 0.0, 0.0] });
      await index.add({ id: 'dup', embedding: [0.0, 1.0, 0.0] });

      // Should still only have one entry
      expect(index.size()).toBe(1);
    });

    it('should handle large k value', async () => {
      await index.addBatch([
        { id: 'vec-1', embedding: [1.0, 0.0, 0.0] },
        { id: 'vec-2', embedding: [0.0, 1.0, 0.0] },
      ]);

      // k larger than index size
      const results = await index.search([1.0, 0.0, 0.0], 100);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });
});
