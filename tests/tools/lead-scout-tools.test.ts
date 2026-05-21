import { AGENT_TOOLS } from '../../src/codebuddy/tool-definitions/agent-tools.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LeadScoutEnrichmentPlanTool,
  LeadScoutLessonCandidatesTool,
  LeadScoutPlanTool,
  LeadScoutRunTool,
  createLeadScoutTools,
} from '../../src/tools/registry/lead-scout-tools.js';

describe('LeadScoutPlanTool', () => {
  it('exposes a lead_scout_plan schema', () => {
    const tool = new LeadScoutPlanTool();
    const schema = tool.getSchema();

    expect(tool.name).toBe('lead_scout_plan');
    expect(schema.name).toBe('lead_scout_plan');
    expect(schema.parameters.required).toEqual(['goal']);
    expect(schema.parameters.properties?.target.enum).toContain('architectes');
    expect(schema.parameters.properties?.sources.items?.enum).toContain('sirene');
  });

  it('is included in the LLM-facing agent tool definitions', () => {
    expect(AGENT_TOOLS.map((tool) => tool.function.name)).toContain('lead_scout_plan');
  });

  it('registers through the tool factory', () => {
    expect(createLeadScoutTools().map((tool) => tool.name)).toEqual([
      'lead_scout_plan',
      'lead_scout_run',
      'lead_scout_enrichment_plan',
      'lead_scout_lesson_candidates',
    ]);
  });

  it('validates required goal and bounded prospect budget', () => {
    const tool = new LeadScoutPlanTool();

    expect(tool.validate?.({ goal: 'find architects', maxProspects: 50 })).toEqual({ valid: true });
    expect(tool.validate?.({ goal: '   ' })).toMatchObject({
      valid: false,
      errors: ['goal must be a non-empty string'],
    });
    expect(tool.validate?.({ goal: 'find architects', maxProspects: 501 })).toMatchObject({
      valid: false,
      errors: ['maxProspects must be between 1 and 500'],
    });
  });

  it('validates target, sources, export formats, and local dataset paths', () => {
    const tool = new LeadScoutPlanTool();

    expect(tool.validate?.({ goal: 'x', target: 'private_people' })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([expect.stringContaining('target must be one of')]),
    });
    expect(tool.validate?.({ goal: 'x', sources: ['shadow_scrape'] })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([expect.stringContaining('sources must contain only')]),
    });
    expect(tool.validate?.({ goal: 'x', exportFormats: ['xlsx'] })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([expect.stringContaining('exportFormats must contain only')]),
    });
    expect(tool.validate?.({ goal: 'x', localDatasetPaths: [42] })).toMatchObject({
      valid: false,
      errors: ['localDatasetPaths must be an array of strings'],
    });
  });

  it('returns a structured Lead Scout plan for execution', async () => {
    const tool = new LeadScoutPlanTool();

    const result = await tool.execute({
      goal: 'trouver des architectes proches pour une offre BTP',
      target: 'architectes',
      zone: 'Epinay-sur-Seine',
      offer: 'controle acces et renovation electrique',
      maxProspects: 20,
      localDatasetPaths: ['/home/patrice/claude/elec/public/architectes-idf.json'],
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('# Lead Scout Plan: trouver des architectes proches pour une offre BTP');
    expect(result.output).toContain('Structured result:');
    expect(result.output).toContain('"leadSchema"');
    expect(result.output).toContain('"workflowTemplate"');
    expect(result.output).toContain('Public data only: yes');
    expect(result.output).toContain('human-approval-gate');
    expect(result.output).toContain('internet_scout_run');
  });
});

describe('LeadScoutLessonCandidatesTool', () => {
  it('exposes a lead_scout_lesson_candidates schema and LLM-facing definition', () => {
    const tool = new LeadScoutLessonCandidatesTool();
    const schema = tool.getSchema();

    expect(tool.name).toBe('lead_scout_lesson_candidates');
    expect(schema.name).toBe('lead_scout_lesson_candidates');
    expect(schema.parameters.required).toEqual(['goal']);
    expect(schema.parameters.properties?.contactPathsThatWorked.items?.type).toBe('string');
    expect(AGENT_TOOLS.map((toolDefinition) => toolDefinition.function.name)).toContain('lead_scout_lesson_candidates');
  });

  it('validates array-shaped observations', () => {
    const tool = new LeadScoutLessonCandidatesTool();

    expect(tool.validate?.({ goal: 'learn', blockers: ['captcha'] })).toEqual({ valid: true });
    expect(tool.validate?.({ goal: 'learn', blockers: [403] })).toMatchObject({
      valid: false,
      errors: ['blockers must be an array of strings'],
    });
    expect(tool.validate?.({ goal: 'learn', stats: [] })).toMatchObject({
      valid: false,
      errors: ['stats must be an object'],
    });
  });

  it('returns structured lesson candidates without persisting them', async () => {
    const tool = new LeadScoutLessonCandidatesTool();

    const result = await tool.execute({
      goal: 'enrichir architectes',
      context: 'Lead Scout',
      contactPathsThatWorked: ['/contact'],
      blockers: ['captcha', 'HTTP 429'],
      stats: {
        selectedLeads: 10,
        needsPublicEnrichment: 4,
      },
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('# Lead Scout Lesson Candidates: enrichir architectes');
    expect(result.output).toContain('Structured result:');
    expect(result.output).toContain('"lessonsAddInput"');
    expect(result.output).toContain('/contact');
  });
});

describe('LeadScoutEnrichmentPlanTool', () => {
  it('exposes a lead_scout_enrichment_plan schema and LLM-facing definition', () => {
    const tool = new LeadScoutEnrichmentPlanTool();
    const schema = tool.getSchema();

    expect(tool.name).toBe('lead_scout_enrichment_plan');
    expect(schema.name).toBe('lead_scout_enrichment_plan');
    expect(schema.parameters.required).toEqual(['goal']);
    expect(schema.parameters.properties?.missingFields.items?.enum).toContain('telephone');
    expect(AGENT_TOOLS.map((toolDefinition) => toolDefinition.function.name)).toContain('lead_scout_enrichment_plan');
  });

  it('validates bounded multi-hop controls', () => {
    const tool = new LeadScoutEnrichmentPlanTool();

    expect(tool.validate?.({
      goal: 'enrichir les telephones',
      missingFields: ['telephone'],
      pageBudget: 10,
      delayMs: 1000,
    })).toEqual({ valid: true });

    expect(tool.validate?.({ goal: 'x', missingFields: ['private_phone'] })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([expect.stringContaining('missingFields must contain only')]),
    });
    expect(tool.validate?.({ goal: 'x', pageBudget: 80 })).toMatchObject({
      valid: false,
      errors: ['pageBudget must be between 1 and 30'],
    });
    expect(tool.validate?.({ goal: 'x', allowedDomains: [42] })).toMatchObject({
      valid: false,
      errors: ['allowedDomains must be an array of strings'],
    });
  });

  it('returns a structured enrichment plan with a generated sandbox script', async () => {
    const tool = new LeadScoutEnrichmentPlanTool();

    const result = await tool.execute({
      goal: 'suivre fiche architecte vers site officiel puis page contact',
      target: 'architectes',
      missingFields: ['site_web', 'telephone', 'email'],
      pageBudget: 6,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('# Lead Scout Enrichment Plan');
    expect(result.output).toContain('## Principles');
    expect(result.output).toContain('run_script');
    expect(result.output).toContain('"protectedScript"');
    expect(result.output).toContain('LEADS_JSON');
  });
});

describe('LeadScoutRunTool', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lead-scout-tool-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('exposes a lead_scout_run schema and LLM-facing definition', () => {
    const tool = new LeadScoutRunTool();
    const schema = tool.getSchema();

    expect(tool.name).toBe('lead_scout_run');
    expect(schema.name).toBe('lead_scout_run');
    expect(schema.parameters.required).toEqual(['goal', 'localDatasetPaths']);
    expect(schema.parameters.properties?.outputFormat.enum).toContain('markdown');
    expect(AGENT_TOOLS.map((toolDefinition) => toolDefinition.function.name)).toContain('lead_scout_run');
  });

  it('validates local dataset input and score bounds', () => {
    const tool = new LeadScoutRunTool();

    expect(tool.validate?.({ goal: 'rank', localDatasetPaths: ['leads.json'], minScore: 50 })).toEqual({
      valid: true,
    });
    expect(tool.validate?.({ goal: 'rank', localDatasetPaths: [] })).toMatchObject({
      valid: false,
      errors: ['localDatasetPaths must be a non-empty array of strings'],
    });
    expect(tool.validate?.({ goal: 'rank', localDatasetPaths: ['leads.json'], minScore: 120 })).toMatchObject({
      valid: false,
      errors: ['minScore must be between 0 and 100'],
    });
    expect(tool.validate?.({ goal: 'rank', localDatasetPaths: ['leads.json'], outputFormat: 'xlsx' })).toMatchObject({
      valid: false,
      errors: ['outputFormat must be one of: csv, json, markdown'],
    });
  });

  it('returns a structured run result from a real local dataset', async () => {
    const datasetPath = join(tempDir, 'architectes.json');
    await writeFile(datasetPath, JSON.stringify([
      {
        nom: 'Atelier Nord',
        type: 'architecte',
        email: 'contact@nord.example',
        ville: 'Epinay-sur-Seine',
        evidence: 'renovation controle acces',
        source_url: 'https://nord.example',
      },
    ]), 'utf8');

    const tool = new LeadScoutRunTool();
    const result = await tool.execute({
      goal: 'classer les architectes locaux',
      target: 'architectes',
      zone: 'Epinay-sur-Seine',
      offer: 'controle acces renovation',
      localDatasetPaths: [datasetPath],
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('# Lead Scout Run: classer les architectes locaux');
    expect(result.output).toContain('Structured result:');
    expect(result.output).toContain('"reviewQueue"');
    expect(result.output).toContain('Atelier Nord');
  });
});
