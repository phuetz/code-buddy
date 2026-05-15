import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const graph = {
    getStats: vi.fn(),
    query: vi.fn(),
    findEntity: vi.fn(),
  };

  return {
    graph,
    getKnowledgeGraph: vi.fn(() => graph),
    getSnapshotInfo: vi.fn(),
    detectDrift: vi.fn(),
    formatDrift: vi.fn(),
    saveSnapshot: vi.fn(),
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

import { CodeGraphTool } from '../../src/tools/registry/code-graph-tools.js';

describe('CodeGraphTool drift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.graph.getStats.mockReturnValue({ tripleCount: 1 });
    mocks.graph.query.mockReturnValue([]);
    mocks.graph.findEntity.mockReturnValue(undefined);
    mocks.getSnapshotInfo.mockReturnValue({ path: 'code-graph-snapshot.json' });
    mocks.detectDrift.mockReturnValue(null);
    mocks.formatDrift.mockReturnValue('formatted drift');
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
});
