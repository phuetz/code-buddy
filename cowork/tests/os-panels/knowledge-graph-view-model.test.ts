import { describe, expect, it } from 'vitest';
import { countEdgesForNode, formatConfidence, summarizeKnowledgeGraph } from '../../src/renderer/components/os-panels/knowledge-graph-view-model.js';

describe('knowledge graph view model', () => {
  it('groups nodes by type and computes confidence', () => {
    const nodes = [
      { id: 'b', type: 'lesson' as const, label: 'Beta', confidence: 0.8 },
      { id: 'a', type: 'lesson' as const, label: 'Alpha', confidence: 1.2 },
      { id: 'd', type: 'decision' as const, label: 'Delta', confidence: 0.4 },
      { id: 'f', type: 'fact' as const, label: 'Fact' },
    ];
    const edges = [{ from: 'a', to: 'd', kind: 'supports' }, { from: 'b', to: 'a', kind: 'related' }];

    const summary = summarizeKnowledgeGraph(nodes, edges);

    expect(summary.totalNodes).toBe(4);
    expect(summary.totalEdges).toBe(2);
    expect(summary.groups[0].nodes.map((node) => node.label)).toEqual(['Alpha', 'Beta']);
    expect(formatConfidence(summary.groups[0].averageConfidence)).toBe('90 %');
    expect(countEdgesForNode('a', edges)).toBe(2);
  });

  it('formats empty confidence honestly', () => {
    const summary = summarizeKnowledgeGraph([], []);

    expect(summary.averageConfidence).toBeNull();
    expect(formatConfidence(summary.averageConfidence)).toBe('—');
  });
});
