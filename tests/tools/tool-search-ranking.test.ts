import { describe, it, expect } from 'vitest';
import { BM25Index, ToolSearchTool, initToolSearchIndex } from '../../src/tools/tool-search.js';

describe('tool discovery contracts', () => {
  it('finds compound names, accented words, non-Latin names and exact identifiers', () => {
    const index = new BM25Index();
    index.index([
      { name: 'mcp__repo__readFile', description: 'Lire un fichier accentué' },
      { name: 'mémoire_検索', description: 'Retrouver les décisions' },
      { name: 'other', description: 'read file read file read file' },
    ]);
    expect(index.search('read file')[0]?.name).toBe('mcp__repo__readFile');
    expect(index.search('lire fichier')[0]?.name).toBe('mcp__repo__readFile');
    expect(index.search('accentue')[0]?.name).toBe('mcp__repo__readFile');
    expect(index.search('検索')[0]?.name).toBe('mémoire_検索');
    expect(index.search('mémoire_検索')[0]?.name).toBe('mémoire_検索');
  });
  it('rebuilds without stale terms or duplicate tools and uses a bounded limit', () => {
    const index = new BM25Index();
    index.index([{ name: 'old', description: 'obsolete' }]);
    index.index([{ name: 'new', description: 'read' }, { name: 'new', description: 'read file' }]);
    expect(index.search('obsolete')).toEqual([]);
    expect(index.search('read', Infinity)).toHaveLength(1);
    expect(index.search('read read')).toEqual(index.search('read'));
  });
  it('returns executable schemas as structured data and rejects malformed arguments', async () => {
    const parameters = { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] };
    initToolSearchIndex([{ name: 'view_file', description: 'Read a file', parameters }]);
    const tool = new ToolSearchTool();
    const result = await tool.execute({ query: 'view file' });
    expect(result.data).toMatchObject({ names: ['view_file'], tools: [{ name: 'view_file', parameters }] });
    expect((await tool.execute({ query: 9 })).success).toBe(false);
    expect((await tool.execute({ query: 'file', max_results: -1 })).success).toBe(false);
  });
  it('uses a request-scoped catalog instead of another agent singleton index', async () => {
    initToolSearchIndex([{ name: 'private_other_agent', description: 'secret tool' }]);
    const result = await new ToolSearchTool().execute({ query: 'secret' }, { cwd: '/tmp', extra: { toolSearchCatalog: [{ name: 'local_secret', description: 'secret reader' }] } });
    expect(result.data).toMatchObject({ names: ['local_secret'] });
    expect(result.output).not.toContain('private_other_agent');
  });

});
