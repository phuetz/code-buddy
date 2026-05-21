import {
  buildLeadScoutPlan,
  renderLeadScoutPlan,
} from '../../src/leads/lead-scout-plan.js';

describe('buildLeadScoutPlan', () => {
  it('creates a B2B prospecting plan for architects with public source defaults', () => {
    const plan = buildLeadScoutPlan({
      goal: 'trouver des architectes autour de Saint-Denis',
      target: 'architectes',
      zone: 'Saint-Denis, 15 km',
      offer: 'renovation electrique pour chantiers tertiaires',
      maxProspects: 25,
    });

    expect(plan.targetLabel).toBe('architectes');
    expect(plan.zone).toBe('Saint-Denis, 15 km');
    expect(plan.maxProspects).toBe(25);
    expect(plan.sources.map((source) => source.source)).toEqual([
      'local_dataset',
      'official_directory',
      'public_website',
      'web_search',
    ]);
    expect(plan.pipelineSteps.map((step) => step.id)).toContain('human-approval-gate');
    expect(plan.safetyRules.join('\n')).toContain('public or user-provided B2B data');
    expect(plan.workflowTemplate).toMatchObject({
      publicDataOnly: true,
      targetLabel: 'architectes',
      contactPolicy: {
        automaticContactAllowed: false,
        requiresHumanApproval: true,
      },
    });
    expect(plan.workflowTemplate.stages.map((stage) => stage.id)).toEqual([
      'search',
      'site-discovery',
      'page-extraction',
      'contact-field-extraction',
      'dedupe',
      'evidence',
      'export',
    ]);
    expect(plan.workflowTemplate.scriptJobArtifact.agentRunArtifact.kind).toBe('script');
  });

  it('uses target-specific public registry defaults for syndics and real estate agencies', () => {
    const syndicsPlan = buildLeadScoutPlan({
      goal: 'qualifier des syndics locaux',
      target: 'syndics',
    });
    const agencyPlan = buildLeadScoutPlan({
      goal: 'qualifier des agences immobilieres locales',
      target: 'agences_immobilieres',
    });

    expect(syndicsPlan.sources.map((source) => source.source)).toContain('rnc');
    expect(agencyPlan.sources.map((source) => source.source)).toContain('sirene');
  });

  it('adds local dataset import when existing files are provided', () => {
    const plan = buildLeadScoutPlan({
      goal: 'reprendre les donnees Elec existantes',
      target: 'architectes',
      localDatasetPaths: [
        '/home/patrice/claude/elec/public/architectes-france.json',
        '   ',
      ],
    });

    expect(plan.localDatasetPaths).toEqual(['/home/patrice/claude/elec/public/architectes-france.json']);
    expect(plan.pipelineSteps[0]).toMatchObject({
      id: 'import-local-datasets',
      required: true,
    });
  });

  it('deduplicates explicit sources and export formats', () => {
    const plan = buildLeadScoutPlan({
      goal: 'creer une liste propre',
      sources: ['web_search', 'public_website', 'web_search'],
      exportFormats: ['csv', 'json', 'csv'],
    });

    expect(plan.sources.map((source) => source.source)).toEqual(['web_search', 'public_website']);
    expect(plan.exportFormats).toEqual(['csv', 'json']);
  });

  it('clamps the direct builder prospect budget while the tool validates strict input', () => {
    expect(buildLeadScoutPlan({ goal: 'minimum', maxProspects: -10 }).maxProspects).toBe(1);
    expect(buildLeadScoutPlan({ goal: 'maximum', maxProspects: 9000 }).maxProspects).toBe(500);
  });

  it('renders a compact plan with scoring, safety, tools, and script recipe', () => {
    const plan = buildLeadScoutPlan({
      goal: 'contacter des architectes proches',
      target: 'architectes',
      zone: 'Epinay-sur-Seine',
      offer: 'electricite renovation',
    });

    const rendered = renderLeadScoutPlan(plan);

    expect(rendered).toContain('# Lead Scout Plan: contacter des architectes proches');
    expect(rendered).toContain('## Scoring');
    expect(rendered).toContain('internet_scout_run');
    expect(rendered).toContain('## Script Recipe');
    expect(rendered).toContain('## Public-Data Workflow Template');
    expect(rendered).toContain('Public data only: yes');
    expect(rendered).toContain('discover-public-leads.py');
    expect(rendered).toContain('Require human validation before any contact attempt');
  });

  it('rejects unsupported targets, sources, and export formats when called directly', () => {
    expect(() =>
      buildLeadScoutPlan({
        goal: 'invalid target',
        target: 'private_people' as never,
      }),
    ).toThrow('target must be one of');

    expect(() =>
      buildLeadScoutPlan({
        goal: 'invalid source',
        sources: ['shadow_scrape' as never],
      }),
    ).toThrow('sources must contain only');

    expect(() =>
      buildLeadScoutPlan({
        goal: 'invalid export',
        exportFormats: ['xlsx' as never],
      }),
    ).toThrow('exportFormats must contain only');
  });
});
