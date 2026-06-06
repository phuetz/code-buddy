import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTestToolRegistry } from '../../src/tools/registry/tool-registry.js';
import { registerBuiltinTools } from '../../src/tools/registry/index.js';

describe('document generator tool registration', () => {
  it('registers generate_document in the executable built-in registry', () => {
    const registry = createTestToolRegistry();

    registerBuiltinTools(registry);

    const entry = registry.get('generate_document');
    expect(entry).toBeDefined();
    expect(entry?.metadata.category).toBe('document');
    expect(entry?.tool.getSchema().parameters.required).toContain('outputPath');
  });

  it('keeps ToolHandler wired to the generate_document adapter', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/agent/tool-handler.ts'),
      'utf8'
    );

    expect(source).toContain('createDocumentGeneratorTools');
  });
});
