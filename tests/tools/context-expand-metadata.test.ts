import { afterEach, describe, expect, it } from 'vitest';

import { getActiveToolMetadata, TOOL_METADATA } from '../../src/tools/metadata.js';

describe('context_expand metadata gate', () => {
  const previous = process.env.CODEBUDDY_CONTEXT_ZOOM;

  afterEach(() => {
    if (previous === undefined) delete process.env.CODEBUDDY_CONTEXT_ZOOM;
    else process.env.CODEBUDDY_CONTEXT_ZOOM = previous;
  });

  it('keeps context_expand in the catalog but hides it from RAG unless zoom is on', () => {
    expect(TOOL_METADATA.some((tool) => tool.name === 'context_expand')).toBe(true);

    delete process.env.CODEBUDDY_CONTEXT_ZOOM;
    expect(getActiveToolMetadata().some((tool) => tool.name === 'context_expand')).toBe(false);

    process.env.CODEBUDDY_CONTEXT_ZOOM = 'true';
    expect(getActiveToolMetadata().some((tool) => tool.name === 'context_expand')).toBe(true);
  });
});
