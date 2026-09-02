import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('context_expand metadata readers', () => {
  it('tools.ts and tools-md-generator.ts read getActiveToolMetadata instead of TOOL_METADATA', () => {
    const tools = readFileSync(new URL('../../src/codebuddy/tools.ts', import.meta.url), 'utf8');
    const generator = readFileSync(
      new URL('../../src/tools/tools-md-generator.ts', import.meta.url),
      'utf8',
    );
    expect(tools).toContain('getActiveToolMetadata');
    expect(tools).not.toMatch(/new Map\(TOOL_METADATA\.map/);
    expect(generator).toContain('getActiveToolMetadata');
    expect(generator).not.toMatch(/TOOL_METADATA\.map\(m => \[m\.name, m\]\)/);
  });
});
