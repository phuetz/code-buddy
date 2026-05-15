import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CodeGraphTool } from '../../src/tools/registry/code-graph-tools.js';
import { KnowledgeGraph } from '../../src/knowledge/knowledge-graph.js';

describe('CodeGraphTool', () => {
  beforeEach(() => {
    KnowledgeGraph.resetInstance();
  });

  afterEach(() => {
    KnowledgeGraph.resetInstance();
  });

  it('fails query operations when the code graph is empty', async () => {
    const tool = new CodeGraphTool();

    const result = await tool.execute({ operation: 'who_calls', query: 'runTurnLoop' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Code graph is empty');
  });

  it('allows stats on an empty code graph', async () => {
    const tool = new CodeGraphTool();

    const result = await tool.execute({ operation: 'stats' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Total triples: 0');
  });
});
