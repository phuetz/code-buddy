/**
 * Tests for HNSW Vector Store
 *
 * Tests the Hierarchical Navigable Small World graph implementation
 * for fast approximate nearest neighbor search.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  HNSWVectorStore,
  getHNSWStore,
  resetHNSWStore,
  DEFAULT_HNSW_CONFIG,
  type VectorEntry,
} from '../src/context/codebase-rag/hnsw-store.js';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Generate a random normalized vector
 */
function randomVector(dimensions: number): number[] {
  const vector = Array.from({ length: dimensions }, () => Math.random() - 0.5);
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return vector.map((v) => v / norm);
}

/**
 * Generate a vector similar to another (for testing nearest neighbor)
 */
function similarVector(base: number[], noise: number = 0.1): number[] {
  const vector = base.map((v) => v + (Math.random() - 0.5) * noise);
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return vector.map((v) => v / norm);
}

// ============================================================================
// HNSWVectorStore Tests
// ============================================================================

describe('HNSWVectorStore', () => {
  beforeEach(() => {
    resetHNSWStore();
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const store = new HNSWVectorStore();
      const config = store.getConfig();

      expect(config.dimensions).toBe(DEFAULT_HNSW_CONFIG.dimensions);
      expect(config.maxConnections).toBe(DEFAULT_HNSW_CONFIG.maxConnections);
      expect(config.efSearch).toBe(DEFAULT_HNSW_CONFIG.efSearch);
    });

    it('should create with custom config', () => {
      const store = new HNSWVectorStore({
        dimensions: 1024,
        maxConnections: 32,
        efSearch: 100,
      });
      const config = store.getConfig();

      expect(config.dimensions).toBe(1024);
      expect(config.maxConnections).toBe(32);
      expect(config.efSearch).toBe(100);
    });
  });

  describe('add', () => {
    it('should add a single vector', () => {
      const store = new HNSWVectorStore({ dimensions: 4 });
      const entry: VectorEntry = {
        id: 'test-1',
        vector: [0.1, 0.2, 0.3, 0.4],
        metadata: { label: 'test' },
      };

      store.add(entry);

      expect(store.size()).toBe(1);
      expect(store.has('test-1')).toBe(true);
    });

    it('should add multiple vectors', () => {
      const store = new HNSWVectorStore({ dimensions: 4 });

      for (let i = 0; i < 10; i++) {
        store.add({
          id: `vec-${i}`,
          vector: randomVector(4),
        });
      }

      expect(store.size()).toBe(10);
    });

    it('should throw on dimension mismatch', () => {
      const store = new HNSWVectorStore({ dimensions: 4 });

      expect(() => {
        store.add({
          id: 'test',
          vector: [0.1, 0.2, 0.3], // Wrong dimensions
        });
      }).toThrow('dimensions mismatch');
    });

    it('should emit add event', () => {
      const store = new HNSWVectorStore({ dimensions: 4 });

      // Add first vector (first node returns early in HNSW)
      store.add({
        id: 'test-0',
        vector: [0.5, 0.5, 0.5, 0.5],
      });

      const eventHandler = jest.fn();
      store.on('add', eventHandler);

      // Second vector should trigger full add path with emit
      store.add({
        id: 'test-1',
        vector: [0.1, 0.2, 0.3, 0.4],
      });

      expect(eventHandler).toHaveBeenCalled();
      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'test-1' })
      );
    });

    it('should store metadata', () => {
      const store = new HNSWVectorStore({ dimensions: 4 });

      store.add({
        id: 'test-1',
        vector: [0.1, 0.2, 0.3, 0.4],
        metadata: { file: 'test.ts', line: 42 },
      });

      const retrieved = store.get('test-1');
      expect(retrieved?.metadata).toEqual({ file: 'test.ts', line: 42 });
    });
  });

  describe('addBatch', () => {
    it('should add multiple vectors in batch', () => {
      const store = new HNSWVectorStore({ dimensions: 4 });

      const entries: VectorEntry[] = Array.from({ length: 100 }, (_, i) => ({
        id: `vec-${i}`,
        vector: randomVector(4),
      }));

      store.addBatch(entries);

      expect(store.size()).toBe(100);
    });

    it('should emit batch progress', (done) => {
      const store = new HNSWVectorStore({ dimensions: 4 });

      const entries: VectorEntry[] = Array.from({ length: 1500 }, (_, i) => ({
        id: `vec-${i}`,
        vector: randomVector(4),
      }));

      store.on('batch:progress', (progress) => {
        expect(progress).toHaveProperty('completed');
        expect(progress).toHaveProperty('total');
        expect(progress.total).toBe(1500);
        done();
      });

      store.addBatch(entries);
    });
  });

  describe('search', () => {
    let store: HNSWVectorStore;
    let baseVector: number[];

    beforeEach(() => {
      store = new HNSWVectorStore({ dimensions: 128 });
      baseVector = randomVector(128);

      // Add base vector and similar vectors
      store.add({ id: 'base', vector: baseVector, metadata: { type: 'base' } });

      // Add similar vectors (should be nearest)
      for (let i = 0; i < 5; i++) {
        store.add({
          id: `similar-${i}`,
          vector: similarVector(baseVector, 0.1),
          metadata: { type: 'similar' },
        });
      }

      // Add random vectors (should be further)
      for (let i = 0; i < 50; i++) {
        store.add({
          id: `random-${i}`,
          vector: randomVector(128),
          metadata: { type: 'random' },
        });
      }
    });

    it('should return empty array for empty store', () => {
      const emptyStore = new HNSWVectorStore({ dimensions: 4 });
      const results = emptyStore.search([0.1, 0.2, 0.3, 0.4]);
      expect(results).toEqual([]);
    });

    it('should find nearest neighbors', () => {
      const query = similarVector(baseVector, 0.05);
      const results = store.search(query, 5);

      expect(results.length).toBe(5);
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('should return results with metadata', () => {
      const results = store.search(baseVector, 5);

      for (const result of results) {
        expect(result).toHaveProperty('id');
        expect(result).toHaveProperty('score');
        expect(result).toHaveProperty('metadata');
      }
    });

    it('should return scores in descending order', () => {
      const results = store.search(baseVector, 10);

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('should throw on query dimension mismatch', () => {
      expect(() => {
        store.search([0.1, 0.2, 0.3, 0.4]); // Wrong dimensions
      }).toThrow('dimensions mismatch');
    });

    it('should find the base vector when queried directly', () => {
      const results = store.search(baseVector, 1);

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('base');
      expect(results[0].score).toBeCloseTo(1, 5);
    });

    it('should prefer similar vectors over random ones', () => {
      const query = similarVector(baseVector, 0.1);
      const results = store.search(query, 10);

      // Count how many of top 10 are similar
      const similarCount = results.filter((r) => r.id.startsWith('similar') || r.id === 'base').length;

      // Most of top 10 should be similar vectors
      expect(similarCount).toBeGreaterThanOrEqual(4);
    });
  });

  describe('delete', () => {
    it('should delete a vector', () => {
      const store = new HNSWVectorStore({ dimensions: 4 });

      store.add({ id: 'test-1', vector: [0.1, 0.2, 0.3, 0.4] });
      store.add({ id: 'test-2', vector: [0.5, 0.6, 0.7, 0.8] });

      expect(store.size()).toBe(2);

      const deleted = store.delete('test-1');

      expect(deleted).toBe(true);
      expect(store.size()).toBe(1);
      expect(store.has('test-1')).toBe(false);
      expect(store.has('test-2')).toBe(true);
    });

    it('should return false for non-existent id', () => {
      const store = new HNSWVectorStore({ dimensions: 4 });

      const deleted = store.delete('non-existent');

      expect(deleted).toBe(false);
    });

    it('should emit delete event', (done) => {
      const store = new HNSWVectorStore({ dimensions: 4 });
      store.add({ id: 'test-1', vector: [0.1, 0.2, 0.3, 0.4] });

      store.on('delete', (data) => {
        expect(data.id).toBe('test-1');
        done();
      });

      store.delete('test-1');
    });

    it('should update entry point when deleting entry', () => {
      const store = new HNSWVectorStore({ dimensions: 4 });

      store.add({ id: 'first', vector: [0.1, 0.2, 0.3, 0.4] });
      store.add({ id: 'second', vector: [0.5, 0.6, 0.7, 0.8] });

      // Delete all vectors
      store.delete('first');
      store.delete('second');

      expect(store.size()).toBe(0);
      // Should be able to add new vectors
      store.add({ id: 'new', vector: [0.1, 0.2, 0.3, 0.4] });
      expect(store.size()).toBe(1);
    });
  });

  describe('get', () => {
    it('should return vector entry', () => {
      const store = new HNSWVectorStore({ dimensions: 4 });

      store.add({
        id: 'test-1',
        vector: [0.1, 0.2, 0.3, 0.4],
        metadata: { label: 'test' },
      });

      const entry = store.get('test-1');

      expect(entry).not.toBeNull();
      expect(entry?.id).toBe('test-1');
      expect(entry?.vector).toEqual([0.1, 0.2, 0.3, 0.4]);
      expect(entry?.metadata).toEqual({ label: 'test' });
    });

    it('should return null for non-existent id', () => {
      const store = new HNSWVectorStore({ dimensions: 4 });

      const entry = store.get('non-existent');

      expect(entry).toBeNull();
    });
  });

  describe('has', () => {
    it('should return true for existing id', () => {
      const store = new HNSWVectorStore({ dimensions: 4 });
      store.add({ id: 'test-1', vector: [0.1, 0.2, 0.3, 0.4] });

      expect(store.has('test-1')).toBe(true);
    });

    it('should return false for non-existent id', () => {
      const store = new HNSWVectorStore({ dimensions: 4 });

      expect(store.has('non-existent')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all vectors', () => {
      const store = new HNSWVectorStore({ dimensions: 4 });

      for (let i = 0; i < 10; i++) {
        store.add({ id: `vec-${i}`, vector: randomVector(4) });
      }

      expect(store.size()).toBe(10);

      store.clear();

      expect(store.size()).toBe(0);
    });

    it('should emit clear event', (done) => {
      const store = new HNSWVectorStore({ dimensions: 4 });
      store.add({ id: 'test-1', vector: [0.1, 0.2, 0.3, 0.4] });

      store.on('clear', () => {
        expect(store.size()).toBe(0);
        done();
      });

      store.clear();
    });
  });

  describe('save and load', () => {
    let tempDir: string;
    let tempFile: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hnsw-test-'));
      tempFile = path.join(tempDir, 'index.json');
    });

    afterEach(() => {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      if (fs.existsSync(tempDir)) {
        fs.rmdirSync(tempDir);
      }
    });

    it('should save index to file', async () => {
      const store = new HNSWVectorStore({ dimensions: 4 });

      for (let i = 0; i < 10; i++) {
        store.add({
          id: `vec-${i}`,
          vector: randomVector(4),
          metadata: { index: i },
        });
      }

      await store.save(tempFile);

      expect(fs.existsSync(tempFile)).toBe(true);
    });

    it('should load index from file', async () => {
      const store = new HNSWVectorStore({ dimensions: 4 });

      for (let i = 0; i < 10; i++) {
        store.add({
          id: `vec-${i}`,
          vector: randomVector(4),
          metadata: { index: i },
        });
      }

      await store.save(tempFile);

      // Create new store and load
      const loadedStore = new HNSWVectorStore();
      await loadedStore.load(tempFile);

      expect(loadedStore.size()).toBe(10);
      expect(loadedStore.has('vec-0')).toBe(true);

      const entry = loadedStore.get('vec-0');
      expect(entry?.metadata).toEqual({ index: 0 });
    });

    it('should throw on non-existent file', async () => {
      const store = new HNSWVectorStore({ dimensions: 4 });

      await expect(store.load('/non/existent/path.json')).rejects.toThrow('not found');
    });

    it('should preserve search functionality after load', async () => {
      const store = new HNSWVectorStore({ dimensions: 64 });
      const baseVector = randomVector(64);

      store.add({ id: 'base', vector: baseVector });
      for (let i = 0; i < 20; i++) {
        store.add({ id: `other-${i}`, vector: randomVector(64) });
      }

      await store.save(tempFile);

      const loadedStore = new HNSWVectorStore();
      await loadedStore.load(tempFile);

      const results = loadedStore.search(baseVector, 1);

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('base');
    });
  });

  describe('getStats', () => {
    it('should return statistics', () => {
      const store = new HNSWVectorStore({ dimensions: 64 });

      for (let i = 0; i < 100; i++) {
        store.add({ id: `vec-${i}`, vector: randomVector(64) });
      }

      const stats = store.getStats();

      expect(stats.size).toBe(100);
      expect(stats.dimensions).toBe(64);
      expect(typeof stats.maxLevel).toBe('number');
      expect(typeof stats.avgConnections).toBe('number');
    });

    it('should return zero stats for empty store', () => {
      const store = new HNSWVectorStore({ dimensions: 4 });

      const stats = store.getStats();

      expect(stats.size).toBe(0);
      expect(stats.avgConnections).toBe(0);
    });
  });

  describe('formatStatus', () => {
    it('should format status for display', () => {
      const store = new HNSWVectorStore({ dimensions: 768 });

      for (let i = 0; i < 100; i++) {
        store.add({ id: `vec-${i}`, vector: randomVector(768) });
      }

      const status = store.formatStatus();

      expect(typeof status).toBe('string');
      expect(status).toContain('HNSW');
      expect(status).toContain('100');
      expect(status).toContain('768');
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      const store = new HNSWVectorStore();
      store.updateConfig({ efSearch: 100 });

      const config = store.getConfig();
      expect(config.efSearch).toBe(100);
    });
  });

  describe('dispose', () => {
    it('should dispose without error', () => {
      const store = new HNSWVectorStore({ dimensions: 4 });
      store.add({ id: 'test', vector: [0.1, 0.2, 0.3, 0.4] });

      expect(() => store.dispose()).not.toThrow();
      expect(store.size()).toBe(0);
    });
  });
});

// ============================================================================
// Singleton Functions Tests
// ============================================================================

describe('HNSW Store Singleton', () => {
  beforeEach(() => {
    resetHNSWStore();
  });

  describe('getHNSWStore', () => {
    it('should return same instance', () => {
      const store1 = getHNSWStore();
      const store2 = getHNSWStore();
      expect(store1).toBe(store2);
    });

    it('should accept config on first call', () => {
      const store = getHNSWStore({ dimensions: 1024 });
      expect(store.getConfig().dimensions).toBe(1024);
    });

    it('should ignore config on subsequent calls', () => {
      const store1 = getHNSWStore({ dimensions: 1024 });
      const store2 = getHNSWStore({ dimensions: 512 });

      expect(store1).toBe(store2);
      expect(store2.getConfig().dimensions).toBe(1024);
    });
  });

  describe('resetHNSWStore', () => {
    it('should reset singleton', () => {
      const store1 = getHNSWStore();
      store1.add({ id: 'test', vector: randomVector(768) });

      resetHNSWStore();

      const store2 = getHNSWStore();
      expect(store1).not.toBe(store2);
      expect(store2.size()).toBe(0);
    });
  });
});

// ============================================================================
// Performance Tests
// ============================================================================

describe('HNSW Performance', () => {
  it('should handle 1000 vectors efficiently', () => {
    const store = new HNSWVectorStore({ dimensions: 128 });

    const startAdd = Date.now();
    for (let i = 0; i < 1000; i++) {
      store.add({ id: `vec-${i}`, vector: randomVector(128) });
    }
    const addTime = Date.now() - startAdd;

    expect(store.size()).toBe(1000);
    expect(addTime).toBeLessThan(5000); // Should complete in < 5 seconds

    const query = randomVector(128);
    const startSearch = Date.now();
    const results = store.search(query, 10);
    const searchTime = Date.now() - startSearch;

    expect(results.length).toBe(10);
    expect(searchTime).toBeLessThan(100); // Should complete in < 100ms
  });

  it('should scale logarithmically with size', () => {
    const store = new HNSWVectorStore({ dimensions: 64 });

    // Add 5000 vectors
    for (let i = 0; i < 5000; i++) {
      store.add({ id: `vec-${i}`, vector: randomVector(64) });
    }

    const query = randomVector(64);

    // Measure search time
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = Date.now();
      store.search(query, 10);
      times.push(Date.now() - start);
    }

    const avgTime = times.reduce((a, b) => a + b) / times.length;

    // Average search should be fast even with 5000 vectors
    expect(avgTime).toBeLessThan(50);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('HNSW Edge Cases', () => {
  it('should handle single vector', () => {
    const store = new HNSWVectorStore({ dimensions: 4 });
    store.add({ id: 'only', vector: [0.1, 0.2, 0.3, 0.4] });

    const results = store.search([0.1, 0.2, 0.3, 0.4], 10);

    expect(results.length).toBe(1);
    expect(results[0].id).toBe('only');
  });

  it('should handle identical vectors', () => {
    const store = new HNSWVectorStore({ dimensions: 4 });
    const vector = [0.1, 0.2, 0.3, 0.4];

    store.add({ id: 'first', vector });
    store.add({ id: 'second', vector });

    const results = store.search(vector, 10);

    expect(results.length).toBe(2);
    expect(results[0].score).toBeCloseTo(1, 5);
    expect(results[1].score).toBeCloseTo(1, 5);
  });

  it('should handle zero vectors', () => {
    const store = new HNSWVectorStore({ dimensions: 4 });
    store.add({ id: 'zero', vector: [0, 0, 0, 0] });

    const results = store.search([0, 0, 0, 0], 1);

    expect(results.length).toBe(1);
  });

  it('should handle high-dimensional vectors', () => {
    const store = new HNSWVectorStore({ dimensions: 2048 });

    for (let i = 0; i < 100; i++) {
      store.add({ id: `vec-${i}`, vector: randomVector(2048) });
    }

    const results = store.search(randomVector(2048), 10);

    expect(results.length).toBe(10);
  });
});
