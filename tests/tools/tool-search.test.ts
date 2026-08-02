import {
  BM25Index,
  getToolSearchIndex,
  initToolSearchIndex,
} from '../../src/tools/tool-search.js';

describe('BM25 tool search index', () => {
  it('should skip rebuilding when tool definitions are unchanged', () => {
    const indexSpy = vi.spyOn(BM25Index.prototype, 'index');
    const tools = [
      { name: 'audit_alpha', description: 'Alpha audit tool', keywords: ['audit', 'alpha'] },
      { name: 'audit_beta', description: 'Beta audit tool', keywords: ['audit', 'beta'] },
    ];

    initToolSearchIndex(tools);
    const initialIndex = getToolSearchIndex();
    initToolSearchIndex([...tools].reverse());

    expect(indexSpy).toHaveBeenCalledTimes(1);
    expect(getToolSearchIndex()).toBe(initialIndex);
    indexSpy.mockRestore();
  });

  it('should rebuild when a definition changes without a name change', () => {
    const indexSpy = vi.spyOn(BM25Index.prototype, 'index');
    const tools = [
      { name: 'audit_mutable', description: 'Original description', keywords: ['original'] },
    ];

    initToolSearchIndex(tools);
    const initialIndex = getToolSearchIndex();
    initToolSearchIndex([
      { name: 'audit_mutable', description: 'Updated description', keywords: ['updated'] },
    ]);

    expect(indexSpy).toHaveBeenCalledTimes(2);
    expect(getToolSearchIndex()).not.toBe(initialIndex);
    expect(getToolSearchIndex().search('updated')[0]?.name).toBe('audit_mutable');
    indexSpy.mockRestore();
  });

  it('should discard stale IDF terms when a BM25 instance is reindexed', () => {
    const index = new BM25Index();
    index.index([{ name: 'legacy_tool', description: 'obsolete quasar operation' }]);
    expect(index.search('quasar')).toHaveLength(1);

    index.index([{ name: 'current_tool', description: 'current nebula operation' }]);

    expect(index.search('quasar')).toHaveLength(0);
    expect(index.search('nebula')[0]?.name).toBe('current_tool');
  });
});
