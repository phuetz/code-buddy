import { describe, expect, it } from 'vitest';

import { docSectionsToMarkdown, draftDocOutline, estimateReadingTime } from '../src/renderer/utils/doc-outline';

describe('draftDocOutline', () => {
  it('creates a structured long-form outline', () => {
    const outline = draftDocOutline('Stratégie agentique pour Cowork');

    expect(outline).toHaveLength(5);
    expect(outline[0]?.title).toBe('Résumé exécutif');
    expect(outline[0]?.summary).toContain('Stratégie agentique pour Cowork');
  });

  it('uses a fallback topic for blank prompts', () => {
    expect(draftDocOutline('')[0]?.summary).toContain('Document sans titre');
  });
});

describe('estimateReadingTime', () => {
  it('uses estimated words when present', () => {
    expect(estimateReadingTime([{ id: 'a', title: 'A', summary: 'short', estimatedWords: 221 }])).toBe(2);
  });

  it('falls back to summary word count', () => {
    expect(estimateReadingTime([{ id: 'a', title: 'A', summary: 'one two three four five' }])).toBe(1);
  });
});

describe('docSectionsToMarkdown', () => {
  it('falls back to Sans titre for a blank document title', () => {
    const md = docSectionsToMarkdown('  ', [{ id: 'a', title: '', summary: 'Hello' }]);
    expect(md.startsWith('# Sans titre')).toBe(true);
    expect(md).toContain('## Sans titre');
  });

  it('inserts --- separators before each outline section', () => {
    const md = docSectionsToMarkdown('Mon Titre', [
      { id: '1', title: 'Partie 1', summary: 'Texte 1' },
      { id: '2', title: 'Partie 2', summary: 'Texte 2' },
    ]);
    expect(md).toBe('# Mon Titre\n\n---\n\n## Partie 1\n\nTexte 1\n\n---\n\n## Partie 2\n\nTexte 2\n');
  });
});
