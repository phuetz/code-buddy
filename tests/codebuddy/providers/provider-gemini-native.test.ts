import { describe, expect, it } from 'vitest';
import { GeminiNativeProvider } from '../../../src/codebuddy/providers/provider-gemini-native.js';


describe('sanitizeSchemaForGemini — mots-clés JSON-Schema refusés par Gemini (06/09/2026)', () => {
  it("retire additionalProperties, $schema, default… à tous les niveaux (400 « Unknown name » sinon)", () => {
    const provider = new (GeminiNativeProvider as unknown as new (...a: unknown[]) => { sanitizeSchemaForGemini: (s: Record<string, unknown>) => Record<string, unknown> })('k', 'gemini-3.7-flash', 'https://generativelanguage.googleapis.com');
    const out = provider.sanitizeSchemaForGemini({
      type: 'object', $schema: 'x', additionalProperties: false, title: 't',
      properties: { a: { type: 'string', default: 'z', examples: ['q'] }, b: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { c: { type: 'number', const: 1 } } } } },
      required: ['a', 'b'],
    });
    const json = JSON.stringify(out);
    for (const k of ['additionalProperties', '$schema', 'default', 'examples', 'title', 'const']) expect(json).not.toContain(`"${k}"`);
    expect(out.type).toBe('OBJECT');
    expect((out.properties as Record<string, Record<string, unknown>>).a.type).toBe('STRING');
  });
});
