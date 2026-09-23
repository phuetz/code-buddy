/**
 * Tests for Graph Embeddings — Hybrid Structural + Semantic Search
 * All embedding infrastructure is mocked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KnowledgeGraph } from '@/knowledge/knowledge-graph.js';

// Mock the embedding provider
vi.mock('@/embeddings/embedding-provider.js', () => ({
  EmbeddingProvider: class MockEmbeddingProvider {
    async initialize() {}
    async embed(text: string): Promise<number[]> {
      // Simple deterministic embedding: hash string to 4-dim vector
      const hash = [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xffff, 0);
      return [
        Math.sin(hash),
        Math.cos(hash),
        Math.sin(hash * 2),
        Math.cos(hash * 2),
      ];
    }
    async embedBatch(texts: string[]): Promise<number[][]> {
      return Promise.all(texts.map(t => this.embed(t)));
    }
  },
}));

// Faux index vectoriel. Il respecte l'interface RÉELLE (`add({id, embedding})`,
// identifiants en chaîne, `initialize`, `getStats`) : le mock précédent imitait
// une signature `add(id, vector)` qu'aucun index du dépôt n'expose, et c'est
// cette fiction qui justifiait une branche « legacy-usearch » en production.
vi.mock('@/search/usearch-index.js', () => ({
  USearchVectorIndex: class MockUSearch {
    private vectors = new Map<string, number[]>();
    private dim: number;
    constructor(config: { dimensions: number } | number) {
      this.dim = typeof config === 'number' ? config : config.dimensions;
    }
    async initialize() {}
    async add(v: { id: string; embedding: number[] }) { this.vectors.set(v.id, v.embedding); }
    async addBatch(vs: Array<{ id: string; embedding: number[] }>) {
      for (const v of vs) await this.add(v);
    }
    async search(query: number[], k: number) {
      const scores: Array<{ id: string; score: number }> = [];
      for (const [id, vec] of this.vectors) {
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < this.dim; i++) {
          dot += (query[i] ?? 0) * (vec[i] ?? 0);
          normA += (query[i] ?? 0) ** 2;
          normB += (vec[i] ?? 0) ** 2;
        }
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        scores.push({ id, score: denom > 0 ? dot / denom : 0 });
      }
      scores.sort((a, b) => b.score - a.score);
      return scores.slice(0, k);
    }
    remove(id: string) { return this.vectors.delete(id); }
    size() { return this.vectors.size; }
    clear() { this.vectors.clear(); }
    dispose() { this.vectors.clear(); }
    getStats() {
      return {
        size: this.vectors.size,
        capacity: this.vectors.size,
        dimensions: this.dim,
        connectivity: 16,
        memoryUsage: 0,
        memoryMapped: false,
      };
    }
  },
}));

describe('GraphEmbeddingIndex', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    KnowledgeGraph.resetInstance();
    graph = KnowledgeGraph.getInstance();
  });

  it('starts as not ready', async () => {
    const { createGraphEmbeddingIndex } = await import('@/knowledge/graph-embeddings.js');
    const index = createGraphEmbeddingIndex(graph);
    expect(index.isReady()).toBe(false);
  });

  it('builds index and becomes ready', async () => {
    graph.add('mod:src/agent/executor', 'imports', 'mod:src/agent/context');
    graph.add('mod:src/agent/executor', 'containsFunction', 'fn:executePlan');

    const { createGraphEmbeddingIndex } = await import('@/knowledge/graph-embeddings.js');
    const index = createGraphEmbeddingIndex(graph);
    await index.rebuild();

    expect(index.isReady()).toBe(true);
  });

  it('search returns results after build', async () => {
    graph.add('mod:src/agent/executor', 'imports', 'mod:src/agent/context');
    graph.add('mod:src/tools/registry', 'imports', 'mod:src/tools/types');

    const { createGraphEmbeddingIndex } = await import('@/knowledge/graph-embeddings.js');
    const index = createGraphEmbeddingIndex(graph);
    await index.rebuild();

    const results = await index.search('agent executor');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entityId).toBeDefined();
    expect(results[0].score).toBeDefined();
  });

  it('auto-builds on first search', async () => {
    graph.add('mod:src/foo', 'imports', 'mod:src/bar');

    const { createGraphEmbeddingIndex } = await import('@/knowledge/graph-embeddings.js');
    const index = createGraphEmbeddingIndex(graph);

    expect(index.isReady()).toBe(false);
    const results = await index.search('foo');
    expect(index.isReady()).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns empty for empty graph', async () => {
    const { createGraphEmbeddingIndex } = await import('@/knowledge/graph-embeddings.js');
    const index = createGraphEmbeddingIndex(graph);
    const results = await index.search('anything');
    expect(results).toEqual([]);
  });

  it('respects k parameter', async () => {
    for (let i = 0; i < 10; i++) {
      graph.add(`mod:src/m${i}`, 'imports', `mod:src/m${(i + 1) % 10}`);
    }

    const { createGraphEmbeddingIndex } = await import('@/knowledge/graph-embeddings.js');
    const index = createGraphEmbeddingIndex(graph);
    await index.rebuild();

    const results = await index.search('module', 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('respects maxEntities config', async () => {
    for (let i = 0; i < 20; i++) {
      graph.add(`mod:m${i}`, 'imports', `mod:m${(i + 1) % 20}`);
    }

    const { createGraphEmbeddingIndex } = await import('@/knowledge/graph-embeddings.js');
    const index = createGraphEmbeddingIndex(graph, { maxEntities: 5 });
    await index.rebuild();

    expect(index.isReady()).toBe(true);
    const results = await index.search('m0', 20);
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('scores are between -1 and 1 (cosine)', async () => {
    graph.add('mod:src/agent', 'imports', 'mod:src/tools');

    const { createGraphEmbeddingIndex } = await import('@/knowledge/graph-embeddings.js');
    const index = createGraphEmbeddingIndex(graph);
    await index.rebuild();

    const results = await index.search('agent');
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(-1);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it('rebuild can be called multiple times', async () => {
    graph.add('mod:a', 'imports', 'mod:b');

    const { createGraphEmbeddingIndex } = await import('@/knowledge/graph-embeddings.js');
    const index = createGraphEmbeddingIndex(graph);
    await index.rebuild();
    expect(index.isReady()).toBe(true);

    graph.add('mod:c', 'imports', 'mod:d');
    await index.rebuild();
    expect(index.isReady()).toBe(true);

    const results = await index.search('c');
    expect(results.length).toBeGreaterThan(0);
  });

  it('includes function names in entity text', async () => {
    graph.add('mod:src/utils/helper', 'containsFunction', 'fn:formatDate');
    graph.add('mod:src/utils/helper', 'containsFunction', 'fn:parseTime');
    graph.add('mod:src/utils/other', 'imports', 'mod:src/utils/helper');

    const { createGraphEmbeddingIndex } = await import('@/knowledge/graph-embeddings.js');
    const index = createGraphEmbeddingIndex(graph);
    await index.rebuild();

    const results = await index.search('date time helper');
    expect(results.length).toBeGreaterThan(0);
  });

  it('includes class names in entity text', async () => {
    graph.add('cls:UserService', 'definedIn', 'mod:src/services/user');
    graph.add('mod:src/services/user', 'imports', 'mod:src/db');

    const { createGraphEmbeddingIndex } = await import('@/knowledge/graph-embeddings.js');
    const index = createGraphEmbeddingIndex(graph);
    await index.rebuild();

    const results = await index.search('UserService');
    expect(results.length).toBeGreaterThan(0);
  });
});
