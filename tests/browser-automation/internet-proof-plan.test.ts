import {
  buildInternetProofPersistenceSuggestions,
  buildInternetProofPlan,
} from '../../src/browser-automation/internet-proof-plan.js';

describe('buildInternetProofPlan', () => {
  it('plans discovery before static read when no URL is known', () => {
    const plan = buildInternetProofPlan({
      goal: 'etudier Stagehand Browserbase',
      persistWhenProven: true,
    });

    expect(plan.query).toBe('etudier Stagehand Browserbase');
    expect(plan.steps.map((step) => step.id)).toEqual([
      'discover',
      'static-read',
      'extract',
      'persist',
      'lesson',
    ]);
    expect(plan.steps[0]).toMatchObject({
      tool: 'web_search',
      evidence: 'discovery',
      required: true,
    });
  });

  it('uses a known URL without adding a redundant search step', () => {
    const plan = buildInternetProofPlan({
      goal: 'verifier la doc Mem0',
      sourceUrl: ' https://docs.mem0.ai/open-source/overview ',
      query: ' memory agent ',
    });

    expect(plan.sourceUrl).toBe('https://docs.mem0.ai/open-source/overview');
    expect(plan.query).toBe('memory agent');
    expect(plan.steps.map((step) => step.tool)).toEqual(['web_fetch', 'browser']);
    expect(plan.steps[0].id).toBe('static-read');
    expect(plan.steps[1]).toMatchObject({ id: 'extract', action: 'extract' });
  });

  it('adds observe and assert steps when an expected page state is provided', () => {
    const plan = buildInternetProofPlan({
      goal: 'tester une page de login',
      sourceUrl: 'https://example.com/login',
      expectedText: 'Se connecter',
    });

    expect(plan.steps.map((step) => step.id)).toEqual([
      'static-read',
      'observe',
      'extract',
      'assert',
    ]);
    expect(plan.steps.find((step) => step.id === 'assert')).toMatchObject({
      tool: 'browser',
      action: 'assert_text',
      evidence: 'assertion',
      required: true,
    });
  });

  it('adds an observe step for browser-only flows even without expected text', () => {
    const plan = buildInternetProofPlan({
      goal: 'prospecter un site',
      sourceUrl: 'https://example.com',
      requiresBrowser: true,
    });

    expect(plan.steps.map((step) => step.id)).toEqual(['static-read', 'observe', 'extract']);
  });

  it('rejects an empty goal', () => {
    expect(() => buildInternetProofPlan({ goal: '   ' })).toThrow('goal is required');
  });

  it('builds memory and lesson payloads after a successful proof loop', () => {
    const plan = buildInternetProofPlan({
      goal: 'verifier Stagehand',
      sourceUrl: 'https://docs.browserbase.com/stagehand',
      expectedText: 'AI web browsing',
      persistWhenProven: true,
    });

    const suggestions = buildInternetProofPersistenceSuggestions({
      plan,
      evidence: {
        url: 'https://docs.browserbase.com/stagehand',
        title: 'Stagehand',
        query: 'Stagehand Browserbase',
        headings: ['Automate browsers', 'AI web browsing'],
        matches: ['AI web browsing'],
        expectedText: 'AI web browsing',
        assertionPassed: true,
        snippet: 'Stagehand lets agents observe, extract, and act on browser pages.',
      },
    });

    expect(suggestions.map((suggestion) => suggestion.tool)).toEqual([
      'remember',
      'lessons_add',
    ]);
    expect(suggestions[0].input).toMatchObject({
      key: 'web-proof:stagehand',
      scope: 'project',
      category: 'patterns',
    });
    expect(suggestions[0].input.value).toContain('Assertion: passed for "AI web browsing"');
    expect(suggestions[1].input).toMatchObject({
      category: 'INSIGHT',
      context: 'Internet automation proof loop',
      source: 'self_observed',
    });
    expect(suggestions[1].input.content).toContain('browser.assert_text');
  });

  it('does not suggest persistence when a required assertion failed', () => {
    const plan = buildInternetProofPlan({
      goal: 'verifier une page',
      sourceUrl: 'https://example.com',
      expectedText: 'Ready',
      persistWhenProven: true,
    });

    expect(
      buildInternetProofPersistenceSuggestions({
        plan,
        evidence: {
          url: 'https://example.com',
          expectedText: 'Ready',
          assertionPassed: false,
          snippet: 'Missing expected text.',
        },
      }),
    ).toEqual([]);
  });

  it('does not suggest persistence for plans without persistence steps', () => {
    const plan = buildInternetProofPlan({
      goal: 'extraire une page',
      sourceUrl: 'https://example.com',
    });

    expect(
      buildInternetProofPersistenceSuggestions({
        plan,
        evidence: {
          url: 'https://example.com',
          title: 'Example Domain',
          headings: ['Example Domain'],
        },
      }),
    ).toEqual([]);
  });
});
