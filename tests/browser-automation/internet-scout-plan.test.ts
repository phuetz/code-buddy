import {
  buildInternetScoutPlan,
  renderInternetScoutPlan,
} from '../../src/browser-automation/internet-scout-plan.js';

describe('buildInternetScoutPlan', () => {
  it('plans search discovery before static reading when no URL is known', () => {
    const plan = buildInternetScoutPlan({
      goal: 'trouver des entreprises qui recrutent des agents IA',
      intent: 'lead_discovery',
      maxPages: 3,
    });

    expect(plan.query).toBe('trouver des entreprises qui recrutent des agents IA');
    expect(plan.maxPages).toBe(3);
    expect(plan.steps.map((step) => step.id)).toEqual([
      'discover',
      'static-read',
      'extract',
      'relationship-context',
    ]);
    expect(plan.steps[0]).toMatchObject({
      tool: 'web_search',
      evidence: 'source-candidates',
      required: true,
    });
  });

  it('uses a known URL without adding a redundant discovery step', () => {
    const plan = buildInternetScoutPlan({
      goal: 'verifier une page produit',
      sourceUrl: ' https://example.com/product ',
      query: ' product docs ',
    });

    expect(plan.sourceUrl).toBe('https://example.com/product');
    expect(plan.query).toBe('product docs');
    expect(plan.steps.map((step) => step.id)).toEqual(['static-read', 'extract']);
    expect(plan.steps[0]).toMatchObject({
      tool: 'web_fetch',
      inputs: { url: 'https://example.com/product' },
    });
  });

  it('adds observe, interaction, and assertion steps for dynamic page checks', () => {
    const plan = buildInternetScoutPlan({
      goal: 'tester un formulaire',
      sourceUrl: 'https://example.com/login',
      requiresInteraction: true,
      expectedText: 'Dashboard',
    });

    expect(plan.steps.map((step) => step.id)).toEqual([
      'static-read',
      'observe',
      'interaction-plan',
      'reviewed-interaction',
      'extract',
      'assert',
    ]);
    expect(plan.steps.find((step) => step.id === 'observe')).toMatchObject({
      tool: 'browser',
      action: 'observe',
      evidence: 'visible-state',
    });
    expect(plan.steps.find((step) => step.id === 'assert')).toMatchObject({
      tool: 'browser',
      action: 'assert_text',
      required: true,
    });
    expect(plan.steps.find((step) => step.id === 'reviewed-interaction')).toMatchObject({
      action: 'act',
      required: true,
      inputs: { instruction: 'tester un formulaire', maxActions: 1 },
    });
  });

  it('adds relationship context for prospecting and profile enrichment intents', () => {
    const plan = buildInternetScoutPlan({
      goal: 'enrichir un prospect depuis sources publiques',
      intent: 'profile_enrichment',
      sourceUrl: 'https://example.com/about',
    });

    expect(plan.steps.map((step) => step.id)).toContain('relationship-context');
    expect(plan.steps.find((step) => step.id === 'relationship-context')).toMatchObject({
      tool: 'relationship_context',
      required: false,
    });
    expect(plan.evidenceChecklist).toContain(
      'Public facts separated from private memory, guesses, and sensitive facts.',
    );
  });

  it('includes hard stop conditions for captcha, rate limits, and access walls', () => {
    const plan = buildInternetScoutPlan({ goal: 'inspecter une page publique' });

    expect(plan.stopConditions.join('\n')).toContain('Captcha');
    expect(plan.stopConditions.join('\n')).toContain('429');
    expect(plan.stopConditions.join('\n')).toContain('login wall');
    expect(plan.safetyRules.join('\n')).toContain('Do not bypass captcha');
  });

  it('adds persistence steps only when requested', () => {
    const plan = buildInternetScoutPlan({
      goal: 'verifier une source',
      sourceUrl: 'https://example.com',
      persistWhenProven: true,
    });

    expect(plan.steps.map((step) => step.id)).toEqual([
      'static-read',
      'extract',
      'persist',
      'lesson',
    ]);
  });

  it('renders a compact plan for LLM-visible output', () => {
    const plan = buildInternetScoutPlan({
      goal: 'verifier PostCommander',
      expectedText: 'PostCommander',
    });

    const rendered = renderInternetScoutPlan(plan);

    expect(rendered).toContain('# Internet Scout Plan: verifier PostCommander');
    expect(rendered).toContain('browser.assert_text');
    expect(rendered).toContain('## Stop Conditions');
  });

  it('rejects an empty goal', () => {
    expect(() => buildInternetScoutPlan({ goal: '   ' })).toThrow('goal is required');
  });

  it('rejects an unknown intent when called directly', () => {
    expect(() =>
      buildInternetScoutPlan({
        goal: 'inspecter une source',
        intent: 'stealth_scrape' as never,
      }),
    ).toThrow('intent must be one of');
  });
});
