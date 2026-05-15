import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const graph = {
    getStats: vi.fn(),
    query: vi.fn(),
    findEntity: vi.fn(),
    formatEgoGraph: vi.fn(),
  };

  return {
    graph,
    getKnowledgeGraph: vi.fn(() => graph),
    getSnapshotInfo: vi.fn(),
    detectDrift: vi.fn(),
    formatDrift: vi.fn(),
    saveSnapshot: vi.fn(),
    createGraphEmbeddingIndex: vi.fn(),
    populateDeepCodeGraph: vi.fn(),
  };
});

vi.mock('../../src/knowledge/knowledge-graph.js', () => ({
  getKnowledgeGraph: mocks.getKnowledgeGraph,
}));

vi.mock('../../src/knowledge/graph-drift.js', () => ({
  getSnapshotInfo: mocks.getSnapshotInfo,
  detectDrift: mocks.detectDrift,
  formatDrift: mocks.formatDrift,
  saveSnapshot: mocks.saveSnapshot,
}));

vi.mock('../../src/knowledge/graph-embeddings.js', () => ({
  createGraphEmbeddingIndex: mocks.createGraphEmbeddingIndex,
}));

vi.mock('../../src/knowledge/code-graph-deep-populator.js', () => ({
  populateDeepCodeGraph: mocks.populateDeepCodeGraph,
}));

import { CodeGraphTool } from '../../src/tools/registry/code-graph-tools.js';

describe('CodeGraphTool drift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.graph.getStats.mockReturnValue({ tripleCount: 1 });
    mocks.graph.query.mockReturnValue([]);
    mocks.graph.findEntity.mockReturnValue(undefined);
    mocks.graph.formatEgoGraph.mockReturnValue('');
    mocks.getSnapshotInfo.mockReturnValue({ path: 'code-graph-snapshot.json' });
    mocks.detectDrift.mockReturnValue(null);
    mocks.formatDrift.mockReturnValue('formatted drift');
    mocks.populateDeepCodeGraph.mockReturnValue(0);
    mocks.createGraphEmbeddingIndex.mockReturnValue({
      search: vi.fn().mockResolvedValue([]),
      isReady: vi.fn().mockReturnValue(false),
      rebuild: vi.fn(),
    });
  });

  it('should keep missing snapshot as an actionable no-baseline result', async () => {
    mocks.getSnapshotInfo.mockReturnValue(null);

    const result = await new CodeGraphTool().execute({ operation: 'drift' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('No snapshot found');
    expect(mocks.detectDrift).not.toHaveBeenCalled();
  });

  it('should fail when an existing snapshot cannot produce drift data', async () => {
    const result = await new CodeGraphTool().execute({ operation: 'drift' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to compute drift');
  });

  it('should return formatted drift when computation succeeds', async () => {
    mocks.detectDrift.mockReturnValue({ summary: {} });

    const result = await new CodeGraphTool().execute({ operation: 'drift' });

    expect(result.success).toBe(true);
    expect(result.output).toBe('formatted drift');
  });

  it('should fail semantic search when the embedding index is unavailable', async () => {
    const result = await new CodeGraphTool().execute({
      operation: 'semantic_search',
      query: 'routing middleware',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Semantic search index is unavailable');
  });

  it('should report no semantic matches only when the index is ready', async () => {
    mocks.createGraphEmbeddingIndex.mockReturnValue({
      search: vi.fn().mockResolvedValue([]),
      isReady: vi.fn().mockReturnValue(true),
      rebuild: vi.fn(),
    });

    const result = await new CodeGraphTool().execute({
      operation: 'semantic_search',
      query: 'routing middleware',
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe('No semantic matches found for "routing middleware".');
  });

  it('should fail call-graph operations when deep population finds no call data', async () => {
    const result = await new CodeGraphTool().execute({
      operation: 'who_calls',
      query: 'runTurnLoop',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Call graph data is unavailable');
  });
});
