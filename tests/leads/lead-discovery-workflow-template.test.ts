import {
  LEAD_DISCOVERY_WORKFLOW_TEMPLATE_SCHEMA_VERSION,
  buildLeadDiscoveryWorkflowTemplate,
  renderLeadDiscoveryWorkflowTemplate,
} from '../../src/leads/lead-discovery-workflow-template.js';

describe('buildLeadDiscoveryWorkflowTemplate', () => {
  it('creates a public-data-only workflow template for local B2B lead discovery', () => {
    const template = buildLeadDiscoveryWorkflowTemplate({
      goal: 'trouver des architectes proches pour un entrepreneur du batiment',
      targetLabel: 'architectes',
      zone: 'Epinay-sur-Seine, 15 km',
      offer: 'renovation electrique',
      maxProspects: 30,
      allowedSources: ['official_directory', 'public_website', 'web_search'],
      exportFormats: ['json', 'csv', 'markdown'],
      requireHumanApprovalBeforeContact: true,
    });

    expect(template).toMatchObject({
      schemaVersion: LEAD_DISCOVERY_WORKFLOW_TEMPLATE_SCHEMA_VERSION,
      title: 'Public-data lead discovery for architectes',
      publicDataOnly: true,
      allowedSources: ['official_directory', 'public_website', 'web_search'],
      contactPolicy: {
        mode: 'review_queue_only',
        automaticContactAllowed: false,
        requiresHumanApproval: true,
      },
    });
    expect(template.inputs.map((input) => input.name)).toEqual([
      'publicSearchQuery',
      'region',
      'targetRole',
      'allowedSources',
      'fieldsToExtract',
      'contactPolicy',
    ]);
    expect(template.stages.map((stage) => stage.id)).toEqual([
      'search',
      'site-discovery',
      'page-extraction',
      'contact-field-extraction',
      'dedupe',
      'evidence',
      'export',
    ]);
    expect(template.guardrails.join('\n')).toContain('Never contact leads automatically');
    expect(template.expectedArtifacts.map((artifact) => artifact.path)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/review-queue.json'),
        expect.stringContaining('/review-queue.csv'),
        expect.stringContaining('/review-queue.md'),
      ]),
    );
  });

  it('wires the workflow to the research-script job artifact contract', () => {
    const template = buildLeadDiscoveryWorkflowTemplate({
      goal: 'qualifier des syndics publics',
      targetLabel: 'syndics',
      zone: 'Lyon',
      offer: 'maintenance immeuble',
      maxProspects: 12,
      allowedSources: ['rnc', 'public_website'],
      exportFormats: ['json'],
      localDatasetPaths: ['syndics.json'],
    });

    expect(template.inputs.map((input) => input.name)).toContain('localDatasetPaths');
    expect(template.scriptJobArtifact).toMatchObject({
      title: 'syndics public lead discovery script',
      language: 'python',
      command: {
        executable: 'python',
        args: ['discover-public-leads.py'],
        env: {
          SEARCH_QUERY: 'syndics Lyon',
          OUTPUT_JSON: 'output.json',
          LIMIT: '12',
        },
      },
      sandboxPolicy: {
        network: 'https_only_public_web',
        writes: 'artifact_dir_only',
      },
      agentRunArtifact: {
        kind: 'script',
      },
    });
    expect(template.scriptJobArtifact.agentRunArtifact.path).toBe(template.scriptJobArtifact.files.manifest);
  });

  it('renders a compact Markdown handoff for agents and Cowork', () => {
    const rendered = renderLeadDiscoveryWorkflowTemplate(buildLeadDiscoveryWorkflowTemplate({
      goal: 'public leads',
      targetLabel: 'bureaux d etudes',
      zone: 'Nantes',
      offer: 'audit energie',
      maxProspects: 10,
      allowedSources: ['sirene', 'public_website'],
      exportFormats: ['json'],
    }));

    expect(rendered).toContain('# Public-data lead discovery for bureaux d etudes');
    expect(rendered).toContain('Public data only: yes');
    expect(rendered).toContain('## Stages');
    expect(rendered).toContain('Search public candidates');
    expect(rendered).toContain('## Script Job');
    expect(rendered).toContain('discover-public-leads.py');
  });
});
