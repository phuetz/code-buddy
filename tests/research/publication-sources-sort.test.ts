import { describe, expect, it } from 'vitest';
import { arxivQueryUrl, europePmcQueryUrl } from '../../src/research/publication-sources.js';

describe('tri des requêtes de publications', () => {
  it('garde l’ordre par pertinence par défaut (URL inchangée)', () => {
    expect(arxivQueryUrl('agent memory', 6, {})).toBe(
      'https://export.arxiv.org/api/query?search_query=all:agent%20memory&start=0&max_results=6',
    );
    expect(europePmcQueryUrl('agent memory', 6, {})).toBe(
      'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=agent%20memory&format=json&pageSize=6&resultType=core',
    );
  });

  it('demande les plus récentes d’abord avec CODEBUDDY_RESEARCH_SORT=recent', () => {
    const env = { CODEBUDDY_RESEARCH_SORT: 'recent' };
    expect(arxivQueryUrl('agent memory', 6, env)).toContain('&sortBy=submittedDate&sortOrder=descending');
    expect(europePmcQueryUrl('agent memory', 6, env)).toContain('&sort=P_PDATE_D%20desc');
  });
});
