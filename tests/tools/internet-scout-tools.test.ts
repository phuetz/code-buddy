import { BROWSER_TOOLS } from '../../src/codebuddy/tool-definitions/browser-tools.js';
import {
  InternetScoutPlanTool,
  InternetScoutRunTool,
} from '../../src/tools/registry/internet-scout-tools.js';

describe('InternetScoutPlanTool', () => {
  it('exposes an internet_scout_plan schema', () => {
    const tool = new InternetScoutPlanTool();
    const schema = tool.getSchema();

    expect(tool.name).toBe('internet_scout_plan');
    expect(schema.name).toBe('internet_scout_plan');
    expect(schema.parameters.required).toEqual(['goal']);
    expect(schema.parameters.properties?.intent.enum).toContain('profile_enrichment');
  });

  it('is included in the LLM-facing browser tool definitions', () => {
    expect(BROWSER_TOOLS.map((tool) => tool.function.name)).toContain('internet_scout_plan');
    expect(BROWSER_TOOLS.map((tool) => tool.function.name)).toContain('internet_scout_run');
  });

  it('validates required goal and bounded page budget', () => {
    const tool = new InternetScoutPlanTool();

    expect(tool.validate?.({ goal: 'research public sources', maxPages: 5 })).toEqual({ valid: true });
    expect(tool.validate?.({ goal: '   ' })).toMatchObject({
      valid: false,
      errors: ['goal must be a non-empty string'],
    });
    expect(tool.validate?.({ goal: 'research', maxPages: 30 })).toMatchObject({
      valid: false,
      errors: ['maxPages must be between 1 and 20'],
    });
  });

  it('returns a structured scout plan for execution', async () => {
    const tool = new InternetScoutPlanTool();

    const result = await tool.execute({
      goal: 'enrichir un prospect depuis sources publiques',
      intent: 'prospecting',
      sourceUrl: 'https://example.com',
      expectedText: 'Example Domain',
      persistWhenProven: true,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('# Internet Scout Plan: enrichir un prospect depuis sources publiques');
    expect(result.output).toContain('browser.assert_text');
    expect(result.output).toContain('relationship_context');
    expect(result.output).toContain('Structured result:');
    expect(result.output).toContain('"stopConditions"');
  });

  it('exposes an internet_scout_run schema', () => {
    const tool = new InternetScoutRunTool();
    const schema = tool.getSchema();

    expect(tool.name).toBe('internet_scout_run');
    expect(schema.name).toBe('internet_scout_run');
    expect(schema.parameters.required).toEqual(['goal']);
    expect(schema.parameters.properties?.useBrowser.type).toBe('boolean');
  });

  it('validates run-only browser controls', () => {
    const tool = new InternetScoutRunTool();

    expect(tool.validate?.({ goal: 'research', browserPageLimit: 1, scrollCount: 2 })).toEqual({ valid: true });
    expect(tool.validate?.({ goal: 'research', browserPageLimit: 9 })).toMatchObject({
      valid: false,
      errors: ['browserPageLimit must be between 0 and 5'],
    });
    expect(tool.validate?.({ goal: 'research', waitUntil: 'forever' })).toMatchObject({
      valid: false,
      errors: ['waitUntil must be one of: load, domcontentloaded, networkidle'],
    });
  });
});
