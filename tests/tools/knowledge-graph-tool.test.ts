import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KnowledgeGraph } from '../../src/knowledge/knowledge-graph.js';
import { KnowledgeGraphQueryTool } from '../../src/tools/registry/misc-tools.js';

describe('KnowledgeGraphQueryTool', () => {
  beforeEach(() => {
    KnowledgeGraph.resetInstance();
  });

  afterEach(() => {
    KnowledgeGraph.resetInstance();
  });

  it('fails read operations when the graph is empty', async () => {
    const tool = new KnowledgeGraphQueryTool();

    const result = await tool.execute({ action: 'query', subject: 'runTurnLoop' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Knowledge graph is empty');
  });

  it('still allows stats and add on an empty graph', async () => {
    const tool = new KnowledgeGraphQueryTool();

    const emptyStats = await tool.execute({ action: 'stats' });
    expect(emptyStats.success).toBe(true);
    expect(emptyStats.output).toContain('Triples: 0');

    const added = await tool.execute({
      action: 'add',
      subject: 'a',
      predicate: 'calls',
      object: 'b',
    });
    expect(added.success).toBe(true);

    const query = await tool.execute({ action: 'query', subject: 'a' });
    expect(query.success).toBe(true);
    expect(query.output).toContain('a --calls--> b');
  });
});
