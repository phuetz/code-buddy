import { describe, expect, it } from 'vitest';
import {
  measureMCPPromptFootprint,
  serializeMCPToolForPrompt,
} from '../../src/mcp/prompt-footprint.js';
import type { MCPTool } from '../../src/mcp/types.js';

const tool: MCPTool = {
  name: 'mcp__pubcommander__create_draft_post',
  description: 'Create a draft without publishing it.',
  serverName: 'pubcommander',
  inputSchema: {
    type: 'object',
    properties: { content: { type: 'string' } },
    required: ['content'],
  },
};

describe('MCP prompt footprint', () => {
  it('measures the provider-facing function definition', () => {
    const serialized = serializeMCPToolForPrompt(tool);

    expect(JSON.parse(serialized)).toEqual({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    });
  });

  it('reports exact characters/bytes and a deterministic token estimate', () => {
    const result = measureMCPPromptFootprint([tool, { ...tool, name: 'mcp__pubcommander__list_posts' }]);
    const serialized = result.tools.map((entry) => entry.characters);

    expect(result.toolCount).toBe(2);
    expect(result.characters).toBe(serialized.reduce((sum, count) => sum + count, 0));
    expect(result.bytes).toBeGreaterThanOrEqual(result.characters);
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it('returns zero totals for an empty catalog', () => {
    expect(measureMCPPromptFootprint([])).toEqual({
      toolCount: 0,
      characters: 0,
      bytes: 0,
      estimatedTokens: 0,
      tools: [],
    });
  });
});
