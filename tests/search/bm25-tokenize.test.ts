/**
 * BM25 tokenizer must preserve Unicode letters. `\w` is ASCII-only, so the old
 * `[^\w\s']` punctuation strip DELETED accented characters — "créer" → "cr"+"er"
 * — mangling French (and any non-ASCII) content and wrecking BM25 ranking for
 * it. Code Buddy is used in French, so this silently degraded lesson/tool recall.
 */
import { describe, it, expect } from 'vitest';
import { tokenize, BM25Index } from '../../src/search/bm25.js';

describe('BM25 tokenize — Unicode safety', () => {
  it('keeps accented French words intact', () => {
    const tokens = tokenize('Créer une fonction déployée en français');
    expect(tokens).toContain('créer');
    expect(tokens).toContain('fonction');
    expect(tokens).toContain('déployée');
    expect(tokens).toContain('français');
    // The old tokenizer produced these fragments; they must NOT appear.
    expect(tokens).not.toContain('cr');
    expect(tokens).not.toContain('ploy');
  });

  it('still strips punctuation and lowercases', () => {
    expect(tokenize('Hello, WORLD! (test)')).toEqual(['hello', 'world', 'test']);
  });

  it('ranks a document by an accented query term', () => {
    const idx = new BM25Index();
    idx.addDocument({ id: 'fr', content: 'Comment déployer une application en production' });
    idx.addDocument({ id: 'en', content: 'How to cook pasta with tomato sauce' });

    const results = idx.search('déployer', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.id).toBe('fr'); // the accented term must actually match
  });
});
