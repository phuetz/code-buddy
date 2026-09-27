import { describe, expect, it } from 'vitest';
import { buildResearchQuery, fuseResearchRanks, isResearchArticle } from '../../../../src/agent/self-improvement/evolution/research-retrieval.js';
import type { CkgRecallResult } from '../../../../src/memory/collective-knowledge-graph.js';

const hit = (id: string): CkgRecallResult => ({ id, name: id, text: id, type: 'discovery',
  salience: 1, mentions: 1, confidence: 1, corroborations: 1, relations: [] });

describe('research retrieval', () => {
  it('RRF rewards agreement between BM25 and semantic retrieval', () => {
    const fused = fuseResearchRanks([hit('semantic'), hit('both')], [hit('lexical'), hit('both')], 3);
    expect(fused.map((row) => row.hit.id)).toEqual(['both', 'lexical', 'semantic']);
    expect(fused[0]!.score).toBeGreaterThan(fused[1]!.score);
  });

  it('does not count duplicate CKG nodes twice within one leg', () => {
    const fused = fuseResearchRanks([hit('a'), hit('a')], [], 5);
    expect(fused).toHaveLength(1);
    expect(fused[0]!.score).toBeCloseTo(1 / 61);
  });

  it('collapses arXiv versions after fusion and excludes non-publication discoveries', () => {
    const first = { ...hit('first'), name: 'arxiv:2501.01234v1', source: 'arxiv' };
    const second = { ...hit('second'), name: 'arxiv:2501.01234v2', source: 'arxiv' };
    expect(fuseResearchRanks([first, second], [], 20)).toHaveLength(1);
    expect(isResearchArticle(first)).toBe(true);
    expect(isResearchArticle({ ...first, source: 'chat' })).toBe(false);
  });

  it('adds the component description and implementation paths to the need', () => {
    expect(buildResearchQuery('Find a paper', { name: 'Voice', description: 'Streaming speech turn taking', paths: ['src/voice.ts'] }))
      .toContain('Streaming speech turn taking\nImplementation: src/voice.ts');
  });
});
