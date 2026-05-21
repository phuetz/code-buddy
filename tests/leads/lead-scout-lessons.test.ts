import {
  buildLeadScoutLessonCandidates,
  renderLeadScoutLessonCandidates,
} from '../../src/leads/lead-scout-lessons.js';

describe('buildLeadScoutLessonCandidates', () => {
  it('generates reviewable lesson candidates from run stats', () => {
    const result = buildLeadScoutLessonCandidates({
      goal: 'classer architectes IDF',
      context: 'Lead Scout architect enrichment',
      stats: {
        selectedLeads: 10,
        needsPublicEnrichment: 5,
        leadsWithEmail: 2,
        leadsWithPhone: 3,
        leadsWithWebsite: 7,
      },
    });

    expect(result.reviewRequired).toBe(true);
    expect(result.persistenceTool).toBe('lessons_add');
    expect(result.candidates.map((candidate) => candidate.category)).toContain('INSIGHT');
    expect(result.candidates.map((candidate) => candidate.category)).toContain('CONTEXT');
    expect(result.candidates[0].lessonsAddInput.source).toBe('self_observed');
  });

  it('turns reusable paths, domains, blockers, and script changes into candidates', () => {
    const result = buildLeadScoutLessonCandidates({
      goal: 'enrichir telephones architectes',
      contactPathsThatWorked: ['/contact', '/mentions-legales'],
      domainsToIgnore: ['annuaire.architectes.org', 'pagesjaunes.fr'],
      blockers: ['captcha', 'HTTP 429'],
      scriptChanges: ['prefer tel: links before text regex'],
    });

    const content = result.candidates.map((candidate) => candidate.content).join('\n');

    expect(content).toContain('/contact');
    expect(content).toContain('annuaire.architectes.org');
    expect(content).toContain('Stop generated enrichment scripts on blockers');
    expect(content).toContain('prefer tel: links before text regex');
  });

  it('adds schema warning candidates when rows are skipped', () => {
    const result = buildLeadScoutLessonCandidates({
      goal: 'import dataset',
      stats: {
        processed: 100,
        skipped: 18,
      },
      warnings: ['18 records were skipped because no business name was found.'],
    });

    expect(result.candidates.some((candidate) => candidate.content.includes('name-field aliases'))).toBe(true);
    expect(result.candidates.some((candidate) => candidate.content.includes('schema warning'))).toBe(true);
  });

  it('deduplicates repeated candidates', () => {
    const result = buildLeadScoutLessonCandidates({
      goal: 'dedupe lessons',
      contactPathsThatWorked: ['/contact', '/contact'],
    });

    expect(result.candidates).toHaveLength(1);
  });

  it('renders candidates and guidance', () => {
    const rendered = renderLeadScoutLessonCandidates(buildLeadScoutLessonCandidates({
      goal: 'render lessons',
      successfulPatterns: ['same-domain contact page yielded phone'],
    }));

    expect(rendered).toContain('# Lead Scout Lesson Candidates: render lessons');
    expect(rendered).toContain('lessons_add');
    expect(rendered).toContain('same-domain contact page yielded phone');
    expect(rendered).toContain('Review candidates before persisting');
  });

  it('rejects an empty goal', () => {
    expect(() => buildLeadScoutLessonCandidates({ goal: '   ' })).toThrow('goal is required');
  });
});
