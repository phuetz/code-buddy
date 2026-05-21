import {
  buildLeadScoutEnrichmentPlan,
  renderLeadScoutEnrichmentPlan,
} from '../../src/leads/lead-scout-enrichment-plan.js';

describe('buildLeadScoutEnrichmentPlan', () => {
  it('models lead enrichment as a multi-hop evidence chain', () => {
    const plan = buildLeadScoutEnrichmentPlan({
      goal: 'trouver telephone et site web depuis les fiches architectes',
      target: 'architectes',
      missingFields: ['site_web', 'telephone', 'email'],
      pageBudget: 6,
      delayMs: 1000,
    });

    expect(plan.hops.map((hop) => hop.id)).toEqual([
      'seed-profile',
      'official-site',
      'contact-pages',
      'verify-and-merge',
    ]);
    expect(plan.principles).toContain('Model the task as a graph of evidence, not a single-page extraction.');
    expect(plan.extractionRules.join('\n')).toContain('Extract phone from tel links first');
    expect(plan.safetyRules.join('\n')).toContain('Do not send emails');
  });

  it('generates a protected Python script contract for run_script', () => {
    const plan = buildLeadScoutEnrichmentPlan({
      goal: 'enrichir un batch local',
      missingFields: ['telephone', 'contact_url'],
      allowedDomains: ['atelier.example'],
      ignoredDomains: ['annuaire.example'],
    });

    expect(plan.protectedScript.language).toBe('python');
    expect(plan.protectedScript.dependencies).toEqual(['requests', 'beautifulsoup4']);
    expect(plan.protectedScript.sandboxPolicy).toMatchObject({
      network: 'https_only_public_web',
      writes: 'output_path_only',
      pageBudget: 8,
    });
    expect(plan.protectedScript.script).toContain('LEADS_JSON');
    expect(plan.protectedScript.script).toContain('OUTPUT_JSON');
    expect(plan.protectedScript.script).toContain('evidence_chain');
    expect(plan.protectedScript.jobArtifact).toMatchObject({
      title: 'Lead Scout custom public enrichment script',
      language: 'python',
      files: {
        manifest: expect.stringContaining('/manifest.json'),
        script: expect.stringContaining('/enrich-leads.py'),
        output: expect.stringContaining('/output.json'),
      },
      command: {
        executable: 'python',
        args: ['enrich-leads.py'],
        env: {
          LEADS_JSON: 'input.json',
          OUTPUT_JSON: 'output.json',
          LIMIT: 'optional integer limit',
        },
      },
      sandboxPolicy: {
        network: 'https_only_public_web',
        writes: 'output_path_only',
        allowedDomains: ['atelier.example'],
        ignoredDomains: expect.arrayContaining(['annuaire.example']),
      },
      agentRunArtifact: {
        kind: 'script',
      },
    });
    expect(plan.protectedScript.jobArtifact.agentRunArtifact.path).toBe(
      plan.protectedScript.jobArtifact.files.manifest,
    );
    expect(plan.ignoredDomains).toContain('annuaire.example');
  });

  it('can omit the generated script when only principles and contract are needed', () => {
    const plan = buildLeadScoutEnrichmentPlan({
      goal: 'plan sans code',
      allowGeneratedScript: false,
    });

    expect(plan.protectedScript.script).toBeUndefined();
    expect(plan.protectedScript.inputContract.LEADS_JSON).toContain('input JSON');
  });

  it('renders the principles and sandbox policy for the agent', () => {
    const rendered = renderLeadScoutEnrichmentPlan(buildLeadScoutEnrichmentPlan({
      goal: 'comprendre la chaine annuaire site contact',
      missingFields: ['site_web', 'telephone'],
    }));

    expect(rendered).toContain('# Lead Scout Enrichment Plan: comprendre la chaine annuaire site contact');
    expect(rendered).toContain('## Principles');
    expect(rendered).toContain('## Multi-hop Chain');
    expect(rendered).toContain('Network: https_only_public_web');
    expect(rendered).toContain('captcha');
  });

  it('rejects unsupported missing fields and targets', () => {
    expect(() =>
      buildLeadScoutEnrichmentPlan({
        goal: 'bad target',
        target: 'private_people' as never,
      }),
    ).toThrow('target must be one of');

    expect(() =>
      buildLeadScoutEnrichmentPlan({
        goal: 'bad field',
        missingFields: ['private_phone' as never],
      }),
    ).toThrow('missingFields must contain only');
  });
});
