import { describe, expect, it } from 'vitest';
import { getActiveToolMetadata } from '../../src/tools/metadata.js';
import { BM25Index } from '../../src/tools/tool-search.js';
import { ToolSelector } from '../../src/tools/tool-selector.js';
import type { CodeBuddyTool } from '../../src/codebuddy/client.js';

function catalogTools(): CodeBuddyTool[] {
  return getActiveToolMetadata().map((m) => ({
    type: 'function',
    function: {
      name: m.name,
      description: m.description,
      parameters: { type: 'object', properties: {} },
    },
  }));
}

function bm25Top(query: string, k = 5): string[] {
  const idx = new BM25Index();
  const meta = getActiveToolMetadata();
  idx.index(meta.map((e) => ({ name: e.name, description: e.description, keywords: e.keywords })));
  return idx.search(query, k).map((r) => r.name);
}

function ragTop(query: string, k = 5): string[] {
  const selector = new ToolSelector();
  const result = selector.selectTools(query, catalogTools(), { maxTools: 15, alwaysInclude: [] });
  return [...result.scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([name]) => name);
}

describe('CB-OUTILS-PRECISION-1005 — métadonnées ranking FR/EN', () => {
  it('BM25: « rappelle-toi » surface remember avant remind', () => {
    const top = bm25Top("rappelle-toi que j'habite à Lyon", 5);
    expect(top).toContain('remember');
    expect(top.indexOf('remember')).toBeLessThan(top.indexOf('remind') === -1 ? 99 : top.indexOf('remind'));
  });

  it('BM25: « pousser la branche » / git push surface git', () => {
    expect(bm25Top('pousser la branche sur le remote', 5)).toContain('git');
    expect(bm25Top('git commit with a message', 3)[0]).toBe('git');
  });

  it('BM25: naviguer / cliquer browser FR', () => {
    expect(bm25Top('naviguer vers un site web', 5).some((n) =>
      ['browser_navigate', 'browser', 'browser_operator'].includes(n),
    )).toBe(true);
    expect(bm25Top('cliquer sur le bouton Connexion', 5).some((n) =>
      ['browser_click', 'browser', 'browser_operator'].includes(n),
    )).toBe(true);
  });

  it('BM25: OCR image vs convert PDF', () => {
    expect(bm25Top('extraire le texte d\'une image par OCR', 3)[0]).toBe('ocr');
    expect(bm25Top('OCR extract text from this image', 3)[0]).toBe('ocr');
  });

  it('RAG: lecture fichier FR ne laisse pas self_describe en tête', () => {
    const top = ragTop('voir le contenu du fichier README', 5);
    expect(top.some((n) => ['view_file', 'read_file'].includes(n))).toBe(true);
    expect(top[0]).not.toBe('self_describe');
  });

  it('RAG: generate an image préfère image_generate à scaffold_app', () => {
    const top = ragTop('generate an image of a cat', 5);
    expect(top[0]).toBe('image_generate');
    expect(top.indexOf('image_generate')).toBeLessThan(
      top.indexOf('scaffold_app') === -1 ? 99 : top.indexOf('scaffold_app'),
    );
  });

  it('RAG: git commit préfère git à git_summary / env_doctor', () => {
    const top = ragTop('git commit with a message', 5);
    expect(top[0]).toBe('git');
  });

  it('RAG: remember / recall EN', () => {
    expect(ragTop('remember my preference for dark mode', 5)).toContain('remember');
    expect(ragTop('recall what you know about me', 5).some((n) =>
      ['recall', 'relationship_context', 'user_model_recall'].includes(n),
    )).toBe(true);
  });

  it('priorités gonflées normalisées (évite domination TF-IDF)', () => {
    const meta = getActiveToolMetadata();
    const by = (n: string) => meta.find((m) => m.name === n)!.priority;
    expect(by('scaffold_app')).toBeLessThanOrEqual(20);
    expect(by('env_doctor')).toBeLessThanOrEqual(20);
    expect(by('git_summary')).toBeLessThan(by('git'));
    expect(by('self_describe')).toBeLessThanOrEqual(20);
  });
});
