import { RelationshipContextTool } from '../../src/tools/registry/relationship-intelligence-tools.js';
import { AGENT_TOOLS } from '../../src/codebuddy/tool-definitions/agent-tools.js';

describe('RelationshipContextTool', () => {
  it('exposes a relationship_context schema', () => {
    const tool = new RelationshipContextTool();
    const schema = tool.getSchema();

    expect(tool.name).toBe('relationship_context');
    expect(schema.name).toBe('relationship_context');
    expect(schema.parameters.required).toEqual(['subject']);
    expect(schema.parameters.properties?.subjectType.enum).toContain('public_person');
  });

  it('is included in the LLM-facing agent tool definitions', () => {
    expect(AGENT_TOOLS.map((tool) => tool.function.name)).toContain('relationship_context');
  });

  it('validates required subject input', () => {
    const tool = new RelationshipContextTool();

    expect(tool.validate?.({ subject: 'Patrice' })).toEqual({ valid: true });
    expect(tool.validate?.({ subject: '   ' })).toMatchObject({
      valid: false,
      errors: ['subject must be a non-empty string'],
    });
  });

  it('returns a structured context card for execution', async () => {
    const tool = new RelationshipContextTool();

    const result = await tool.execute({
      subject: 'Bill Gates',
      subjectType: 'public_person',
      confidence: 0.94,
      publicFacts: ['Cofounder of Microsoft'],
      evidence: [{ sourceType: 'public_web', label: 'Public source' }],
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('# Relationship Context: Bill Gates');
    expect(result.output).toContain('Structured result:');
    expect(result.output).toContain('"contextLevel": "public_context"');
  });
});
